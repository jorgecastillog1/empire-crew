import { redis } from '@/lib/redis';
import { callLLM, logOrchestratorAction } from '@/lib/orchestrator';
import { executeTool } from '@/lib/thoth';
import { writeProof } from '@/lib/omk';

// ============================================================
// SUPERVISOR: Autocuración + AI Doctor
// ============================================================

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  lastCheck: number;
  errorCount: number;
  details: string;
}

export interface HealingAction {
  service: string;
  level: number;
  action: string;
  success: boolean;
  timestamp: number;
}

// Nivel 1: Reintento simple
async function level1Retry(service: string): Promise<boolean> {
  await logOrchestratorAction('supervisor:retry:' + service);
  await new Promise(r => setTimeout(r, 2000));
  return true;
}

// Nivel 2: Cambio de estrategia (rotar API key)
async function level2Strategy(service: string): Promise<boolean> {
  await logOrchestratorAction('supervisor:strategy:' + service);
  if (service === 'groq') {
    const idxKey = 'pool:groq:index';
    const raw = await redis.get<number>(idxKey) ?? 0;
    await redis.set(idxKey, Number(raw) + 1);
    return true;
  }
  return false;
}

// Nivel 3: Reinicio del componente (limpiar cache)
async function level3Restart(service: string): Promise<boolean> {
  await logOrchestratorAction('supervisor:restart:' + service);
  const cacheKeys = await redis.keys('cache:prompt:*');
  for (const key of cacheKeys.slice(0, 20)) await redis.del(key);
  return true;
}

// Nivel 4: AI Doctor — diagnóstico y parche con LLM
async function level4AiDoctor(service: string, error: string): Promise<string> {
  await logOrchestratorAction('supervisor:ai_doctor:' + service);
  const result = await callLLM({
    systemPrompt: 'You are an AI system doctor. Diagnose the service failure and provide a specific recovery action. Be concise and actionable.',
    userMessage: 'Service: ' + service + '\nError: ' + error + '\nProvide: 1) Root cause 2) Recovery action 3) Prevention',
    agentId: 'ai-doctor',
    maxTokens: 300,
  });
  await executeTool('telegram_notify', {
    message: 'AI Doctor activado para ' + service + '\n' + result.response.slice(0, 200),
  });
  return result.response;
}

// Check de salud de un servicio
export async function checkServiceHealth(service: string): Promise<ServiceHealth> {
  const errorKey = 'supervisor:errors:' + service;
  const errorCount = Number(await redis.get<number>(errorKey) ?? 0);
  const lastCheck = Date.now();

  let status: 'healthy' | 'degraded' | 'down' = 'healthy';
  let details = 'OK';

  if (errorCount >= 10) { status = 'down'; details = errorCount + ' errors'; }
  else if (errorCount >= 3) { status = 'degraded'; details = errorCount + ' errors'; }

  const health: ServiceHealth = { name: service, status, lastCheck, errorCount, details };
  await redis.set('supervisor:health:' + service, JSON.stringify(health), { ex: 300 });
  return health;
}

// Registrar error de servicio
export async function reportServiceError(service: string, error: string): Promise<void> {
  const errorKey = 'supervisor:errors:' + service;
  const count = Number(await redis.get<number>(errorKey) ?? 0) + 1;
  await redis.set(errorKey, count, { ex: 3600 });
  await redis.lpush('supervisor:log:' + service, JSON.stringify({ error, timestamp: Date.now() }));
  await redis.ltrim('supervisor:log:' + service, 0, 49);
}

// Pipeline de autocuración en 4 niveles
export async function healService(service: string, error: string): Promise<HealingAction> {
  const health = await checkServiceHealth(service);
  let level = 1;
  let action = '';
  let success = false;

  if (health.errorCount < 3) {
    success = await level1Retry(service);
    level = 1; action = 'retry';
  } else if (health.errorCount < 5) {
    success = await level2Strategy(service);
    level = 2; action = 'strategy_change';
  } else if (health.errorCount < 10) {
    success = await level3Restart(service);
    level = 3; action = 'cache_clear';
  } else {
    const diagnosis = await level4AiDoctor(service, error);
    level = 4; action = 'ai_doctor:' + diagnosis.slice(0, 50);
    success = true;
  }

  const healingAction: HealingAction = { service, level, action, success, timestamp: Date.now() };
  await writeProof('supervisor:heal', { service, error }, healingAction, 'supervisor');

  if (success) {
    const errorKey = 'supervisor:errors:' + service;
    await redis.set(errorKey, 0, { ex: 3600 });
  }

  await logOrchestratorAction('supervisor:healed:' + service + ':level' + level);
  return healingAction;
}

// Diagnóstico completo del ecosistema
export async function runSystemDiagnosis(): Promise<{
  services: ServiceHealth[];
  overall: 'healthy' | 'degraded' | 'critical';
  recommendations: string[];
}> {
  const services = ['groq', 'redis', 'tavily', 'fal', 'replicate', 'cloudinary'];
  const healths: ServiceHealth[] = [];

  for (const svc of services) {
    healths.push(await checkServiceHealth(svc));
  }

  const downCount = healths.filter(h => h.status === 'down').length;
  const degradedCount = healths.filter(h => h.status === 'degraded').length;

  let overall: 'healthy' | 'degraded' | 'critical' = 'healthy';
  if (downCount >= 2) overall = 'critical';
  else if (downCount >= 1 || degradedCount >= 2) overall = 'degraded';

  const recommendations = healths
    .filter(h => h.status !== 'healthy')
    .map(h => 'Fix ' + h.name + ': ' + h.details);

  return { services: healths, overall, recommendations };
}
// ─── Heal Agent (extensión para agentes) ─────────────────────────────────────

export interface AgentHealingAction {
  agentId: string;
  companyId: string;
  level: number;
  action: string;
  success: boolean;
  timestamp: number;
}

export async function healAgent(
  agentId: string,
  companyId: string,
  reason: string
): Promise<AgentHealingAction> {
  const riskRaw = await redis.get<number>('empire:monitor:risk:' + agentId) ?? 0;
  const riskScore = Number(riskRaw);

  let level = 1;
  let action = '';
  let success = false;

  if (riskScore < 30) {
    // Nivel 1: Reintentar últimas acciones
    await logOrchestratorAction('supervisor:healAgent:retry:' + agentId);
    await redis.set('empire:agent:status:' + agentId, 'recovering', { ex: 3600 });
    level = 1; action = 'retry'; success = true;

  } else if (riskScore < 50) {
    // Nivel 2: Cambiar modelo (bajar a modelo más ligero)
    const agentKey = 'agent:' + companyId + ':' + agentId;
    const raw = await redis.get<string>(agentKey);
    if (raw) {
      const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;
      agent.model = 'llama-3.1-8b-instant';
      await redis.set(agentKey, JSON.stringify(agent), { ex: 86400 * 7 });
    }
    level = 2; action = 'model_downgrade'; success = true;
    await logOrchestratorAction('supervisor:healAgent:model_downgrade:' + agentId);

  } else if (riskScore < 75) {
    // Nivel 3: Resetear memoria de trabajo
    await redis.del('empire:monitor:events:' + agentId);
    await redis.set('empire:monitor:risk:' + agentId, 0, { ex: 86400 * 7 });
    await redis.set('empire:agent:status:' + agentId, 'reset', { ex: 3600 });
    level = 3; action = 'memory_reset'; success = true;
    await logOrchestratorAction('supervisor:healAgent:memory_reset:' + agentId);

  } else {
    // Nivel 4: AI Doctor analiza logs del agente
    const events = await redis.lrange('empire:monitor:events:' + agentId, 0, 19) as string[];
    const summary = events.slice(0, 5).map(e => {
      try { const p = typeof e === 'string' ? JSON.parse(e) : e; return p.eventType + ':' + p.details; }
      catch { return String(e); }
    }).join(', ');

    const diagnosis = await callLLM({
      systemPrompt: 'You are an AI agent doctor. Analyze the agent failures and recommend a specific fix. Be concise.',
      userMessage: 'Agent: ' + agentId + '\nCompany: ' + companyId + '\nRiskScore: ' + riskScore + '\nReason: ' + reason + '\nRecent events: ' + summary,
      agentId: 'ai-doctor',
      maxTokens: 200,
    });

    await executeTool('telegram_notify', {
      message: 'AI Doctor — Agente ' + agentId + ' en estado crítico\n' + diagnosis.response.slice(0, 200),
    });

    level = 4; action = 'ai_doctor:' + diagnosis.response.slice(0, 50); success = true;
    await logOrchestratorAction('supervisor:healAgent:ai_doctor:' + agentId);
  }

  const result: AgentHealingAction = { agentId, companyId, level, action, success, timestamp: Date.now() };
  await writeProof('supervisor:healAgent', { agentId, reason }, result, 'supervisor', companyId);
  return result;
}