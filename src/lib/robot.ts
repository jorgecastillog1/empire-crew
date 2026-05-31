import { redis, KEY } from '@/lib/redis';
import { logOrchestratorAction } from '@/lib/orchestrator';
import { writeProof } from '@/lib/omk';

// ============================================================
// ROBOT — Automatización de procesos + Web Scraping
// ============================================================

export type RobotJobType =
  | 'scrape_news'
  | 'scrape_prices'
  | 'scrape_trends'
  | 'publish_content'
  | 'send_report'
  | 'analyze_market';

export interface RobotJob {
  id: string;
  type: RobotJobType;
  companyId: string;
  companyType: string;
  payload: Record<string, any>;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTask {
  jobType: RobotJobType;
  companyId: string;
  companyType: string;
  intervalMs: number;
  payload?: Record<string, any>;
}

// ─── Keys Redis ───────────────────────────────────────────────────────────────

const ROBOT_KEY = {
  job: (id: string) => `empire:robot:job:${id}`,
  queue: 'empire:robot:queue',
  log: 'empire:robot:log',
  schedule: (companyId: string) => `empire:robot:schedule:${companyId}`,
  lastRun: (companyId: string, jobType: string) => `empire:robot:lastrun:${companyId}:${jobType}`,
};

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Registra una tarea programada para una empresa.
 * El scheduler verifica si debe correr comparando lastRun con intervalMs.
 */
export async function scheduleTask(task: ScheduledTask): Promise<void> {
  await redis.set(
    ROBOT_KEY.schedule(task.companyId + ':' + task.jobType),
    JSON.stringify(task),
    { ex: 86400 * 30 }
  );
  await logOrchestratorAction('robot:scheduled:' + task.jobType + ':' + task.companyId);
}

/**
 * Verifica y dispara todas las tareas programadas que tienen intervalos vencidos.
 * Llamar desde un endpoint de cron o desde el orquestador.
 */
export async function runScheduler(): Promise<{ triggered: string[]; skipped: string[] }> {
  const triggered: string[] = [];
  const skipped: string[] = [];

  const keys = await redis.keys('empire:robot:schedule:*');

  for (const key of keys) {
    const raw = await redis.get<string>(key);
    if (!raw) continue;

    try {
      const task: ScheduledTask = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const lastRunKey = ROBOT_KEY.lastRun(task.companyId, task.jobType);
      const lastRun = Number(await redis.get<number>(lastRunKey) ?? 0);
      const now = Date.now();

      if (now - lastRun >= task.intervalMs) {
        await redis.set(lastRunKey, now, { ex: 86400 * 7 });
        const job = await dispatchRobotJob(task.jobType, task.companyId, task.companyType, task.payload ?? {});
        triggered.push(task.jobType + ':' + task.companyId + ':' + job.id);
      } else {
        skipped.push(task.jobType + ':' + task.companyId);
      }
    } catch (e: any) {
      skipped.push(key + ':error:' + e.message);
    }
  }

  await logOrchestratorAction('robot:scheduler:triggered:' + triggered.length);
  return { triggered, skipped };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Crea y encola un RobotJob. Retorna el job creado.
 */
export async function dispatchRobotJob(
  type: RobotJobType,
  companyId: string,
  companyType: string,
  payload: Record<string, any> = {}
): Promise<RobotJob> {
  const id = 'rjob:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 6);
  const job: RobotJob = {
    id,
    type,
    companyId,
    companyType,
    payload,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await redis.set(ROBOT_KEY.job(id), JSON.stringify(job), { ex: 86400 * 3 });
  await redis.lpush(ROBOT_KEY.queue, id);
  await redis.ltrim(ROBOT_KEY.queue, 0, 99);
  await logOrchestratorAction('robot:dispatched:' + type + ':' + companyId);

  return job;
}

/**
 * Ejecuta un job específico por ID.
 */
export async function executeRobotJob(jobId: string): Promise<RobotJob> {
  const raw = await redis.get<string>(ROBOT_KEY.job(jobId));
  if (!raw) throw new Error('Job no encontrado: ' + jobId);

  const job: RobotJob = typeof raw === 'string' ? JSON.parse(raw) : raw;
  job.status = 'running';
  job.updatedAt = Date.now();
  await redis.set(ROBOT_KEY.job(jobId), JSON.stringify(job), { ex: 86400 * 3 });

  try {
    let result: any;

    switch (job.type) {
      case 'scrape_news':
        result = await robotScrapeNews(job.payload.url ?? 'https://cryptopanic.com', job.payload.selector ?? 'article');
        break;
      case 'scrape_prices':
        result = await robotScrapePrices(job.payload.url ?? 'https://coinmarketcap.com', job.payload.selector ?? '.sc-4984dd93-0');
        break;
      case 'scrape_trends':
        result = await robotScrapeTrends(job.payload.url ?? 'https://trends.google.com/trending', job.payload.selector ?? 'td');
        break;
      case 'publish_content':
        result = await robotPublishContent(job.companyId, job.payload);
        break;
      case 'send_report':
        result = await robotSendReport(job.companyId, job.companyType, job.payload);
        break;
      case 'analyze_market':
        result = await robotAnalyzeMarket(job.companyId, job.payload);
        break;
      default:
        throw new Error('Tipo de job desconocido: ' + job.type);
    }

    job.status = 'done';
    job.result = result;
    await writeProof('robot:execute', { jobId, type: job.type }, result, 'robot', job.companyId);
  } catch (e: any) {
    job.status = 'failed';
    job.error = e.message;
    await logOrchestratorAction('robot:failed:' + job.type + ':' + e.message.slice(0, 50));
  }

  job.updatedAt = Date.now();
  await redis.set(ROBOT_KEY.job(jobId), JSON.stringify(job), { ex: 86400 * 3 });
  await redis.lpush(ROBOT_KEY.log, JSON.stringify({ jobId, type: job.type, status: job.status, timestamp: Date.now() }));
  await redis.ltrim(ROBOT_KEY.log, 0, 199);

  return job;
}

// ─── Robots de scraping (Playwright vía API interna) ─────────────────────────

/**
 * Scraping genérico usando el módulo browser.ts existente.
 * Delega a /api/browser para no bloquear el servidor principal.
 */
async function scrapeWithBrowser(url: string, selector: string): Promise<string[]> {
  try {
    const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    const res = await fetch(baseUrl + '/api/browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'scrape', url, selector }),
    });
    if (!res.ok) throw new Error('Browser API error: ' + res.status);
    const data = await res.json();
    return data.results ?? data.texts ?? [];
  } catch (e: any) {
    throw new Error('Scraping fallido: ' + e.message);
  }
}

async function robotScrapeNews(url: string, selector: string): Promise<{ items: string[]; url: string; timestamp: number }> {
  const items = await scrapeWithBrowser(url, selector);
  await logOrchestratorAction('robot:scrape_news:done:' + items.length + '_items');
  return { items: items.slice(0, 20), url, timestamp: Date.now() };
}

async function robotScrapePrices(url: string, selector: string): Promise<{ prices: string[]; url: string; timestamp: number }> {
  const prices = await scrapeWithBrowser(url, selector);
  await logOrchestratorAction('robot:scrape_prices:done:' + prices.length + '_items');
  return { prices: prices.slice(0, 20), url, timestamp: Date.now() };
}

async function robotScrapeTrends(url: string, selector: string): Promise<{ trends: string[]; url: string; timestamp: number }> {
  const trends = await scrapeWithBrowser(url, selector);
  await logOrchestratorAction('robot:scrape_trends:done:' + trends.length + '_items');
  return { trends: trends.slice(0, 20), url, timestamp: Date.now() };
}

// ─── Robots de automatización ─────────────────────────────────────────────────

async function robotPublishContent(
  companyId: string,
  payload: { message?: string; platform?: string }
): Promise<{ published: boolean; platform: string; timestamp: number }> {
  const message = payload.message ?? 'Reporte automático de ' + companyId;
  const platform = payload.platform ?? 'telegram';

  if (platform === 'telegram') {
    const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    await fetch(baseUrl + '/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', message: '[ROBOT] ' + message }),
    });
  }

  await logOrchestratorAction('robot:publish:' + platform + ':' + companyId);
  return { published: true, platform, timestamp: Date.now() };
}

async function robotSendReport(
  companyId: string,
  companyType: string,
  payload: { email?: string }
): Promise<{ sent: boolean; to: string; timestamp: number }> {
  const to = payload.email ?? process.env.ADMIN_EMAIL ?? '';
  if (!to) throw new Error('No hay email destino configurado');

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  await fetch(baseUrl + '/api/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      subject: '[Empire] Reporte automático — ' + companyId,
      body: 'Reporte generado automáticamente por el Robot de ' + companyType + ' para ' + companyId + ' a las ' + new Date().toISOString(),
    }),
  });

  await logOrchestratorAction('robot:send_report:' + companyId);
  return { sent: true, to, timestamp: Date.now() };
}

async function robotAnalyzeMarket(
  companyId: string,
  payload: { pairs?: string[] }
): Promise<{ analysis: Record<string, string>; timestamp: number }> {
  const pairs = payload.pairs ?? ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
  const analysis: Record<string, string> = {};

  for (const pair of pairs) {
    // Placeholder para análisis real — conectar con agente de trading cuando esté listo
    analysis[pair] = 'NEUTRAL — sin señal activa';
  }

  await logOrchestratorAction('robot:analyze_market:' + companyId + ':' + pairs.length + '_pairs');
  return { analysis, timestamp: Date.now() };
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export async function getRobotJob(jobId: string): Promise<RobotJob | null> {
  const raw = await redis.get<string>(ROBOT_KEY.job(jobId));
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
}

export async function getRobotQueue(): Promise<string[]> {
  return await redis.lrange(ROBOT_KEY.queue, 0, 19) as string[];
}

export async function getRobotLog(): Promise<{ jobId: string; type: string; status: string; timestamp: number }[]> {
  const raw = await redis.lrange(ROBOT_KEY.log, 0, 49) as string[];
  return raw.map(l => {
    try { return typeof l === 'string' ? JSON.parse(l) : l; }
    catch { return { jobId: '', type: '', status: 'error', timestamp: Date.now() }; }
  });
}

export async function getScheduledTasks(companyId: string): Promise<ScheduledTask[]> {
  const keys = await redis.keys('empire:robot:schedule:' + companyId + ':*');
  const tasks: ScheduledTask[] = [];
  for (const key of keys) {
    const raw = await redis.get<string>(key);
    if (!raw) continue;
    try { tasks.push(typeof raw === 'string' ? JSON.parse(raw) : raw); }
    catch {}
  }
  return tasks;
}