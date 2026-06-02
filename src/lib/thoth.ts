import { redis } from './redis';
import { runInNewContext } from 'vm';
import { logOrchestratorAction, createApprovalRequest } from './orchestrator';
import { writeProof } from './omk';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFilePromise = promisify(execFile);

// ============================================================
// THOTH: Mapa de herramientas ejecutables por agentes
// ============================================================

export type ToolResult = { success: boolean; output: any; error?: string };

type ToolFn = (params: any) => Promise<ToolResult>;

const toolRegistry: Record<string, ToolFn> = {};

export function registerTool(name: string, fn: ToolFn): void {
  toolRegistry[name] = fn;
}

export function getRegisteredTools(): string[] {
  return Object.keys(toolRegistry);
}

export async function executeTool(name: string, params: any, agentId = 'unknown', companyId = 'unknown'): Promise<ToolResult> {
  const tool = toolRegistry[name];
  if (!tool) return { success: false, output: null, error: 'Tool not found: ' + name };
  const start = Date.now();
  try {
    await logOrchestratorAction('thoth:exec:' + name + ':' + agentId);
    const result = await tool(params);
    const durationMs = Date.now() - start;
    await logOrchestratorAction('thoth:done:' + name + ':' + (result.success ? 'ok' : 'fail'));
    const { recordAgentEvent } = await import('@/lib/agentMonitor');
    if (result.success) {
      await recordAgentEvent(agentId, companyId, 'success', name + ':ok', { durationMs });
    } else {
      await recordAgentEvent(agentId, companyId, 'error', name + ':' + (result.error ?? 'fail'), { durationMs });
    }
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const { recordAgentEvent } = await import('@/lib/agentMonitor');
    await recordAgentEvent(agentId, companyId, 'error', name + ':' + err.message.slice(0, 80), { durationMs });
    return { success: false, output: null, error: err.message };
  }
}

// --- Herramienta: sandbox JS ---
registerTool('sandbox_js', async ({ code, context = {} }) => {
  try {
    const sandbox = { result: undefined, console: { log: () => {} }, ...context };
    runInNewContext(code, sandbox, { timeout: 3000 });
    return { success: true, output: sandbox.result };
  } catch (err: any) {
    return { success: false, output: null, error: err.message };
  }
});

// --- Herramienta: leer/escribir Redis ---
registerTool('redis_get', async ({ key }) => {
  const val = await redis.get<string>(key);
  return { success: true, output: val };
});

registerTool('redis_set', async ({ key, value, ttl = 3600 }) => {
  await redis.set(key, value, { ex: ttl });
  return { success: true, output: 'saved' };
});

// --- Herramienta: HTTP fetch externo ---
registerTool('http_fetch', async ({ url, method = 'GET', body, headers = {} }) => {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch {}
    return { success: res.ok, output: data };
  } catch (err: any) {
    return { success: false, output: null, error: err.message };
  }
});

// --- Herramienta: Telegram notify ---
registerTool('telegram_notify', async ({ message }) => {
  const raw = await redis.get<string>('empire:settings:telegram');
  const telegram = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
  const token = telegram.token;
  const chatId = telegram.chatId;
  if (!token || !chatId) return { success: false, output: null, error: 'Telegram not configured' };
  const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
  });
  const data = await res.json();
  return { success: res.ok, output: data };
});

// --- Herramienta: buscar web con Tavily (CORREGIDO Fix #6) ---
registerTool('web_search', async ({ query }) => {
  // Leer de empire:tavily:accounts (mismo formato que Settings UI)
  const tavilyRaw = await redis.lrange('empire:tavily:accounts', 0, -1) as string[];
  const tavilyAccounts = tavilyRaw.map(acc => {
    try { return typeof acc === 'string' ? JSON.parse(acc) : acc; }
    catch { return null; }
  }).filter(Boolean);

  let apiKey = '';
  for (const acc of tavilyAccounts) {
    const limited = await redis.get(`empire:ratelimit:tavily:${acc.id}`);
    if (!limited && acc.apiKey) {
      apiKey = acc.apiKey;
      break;
    }
  }
  if (!apiKey) apiKey = process.env.TAVILY_API_KEY ?? '';

  if (!apiKey) return { success: false, output: null, error: 'No Tavily key configured' };
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: 3 }),
  });
  const data = await res.json();
  return { success: res.ok, output: data.results ?? [] };
});

// --- Herramienta: generar imagen con FAL.AI (CORREGIDO Fix #6) ---
registerTool('generate_image', async ({ prompt, model = 'fal-ai/flux/schnell' }) => {
  // Leer de empire:settings:services (formato: [{ label: "FAL.AI", apiKey: "..." }])
  const servicesRaw = await redis.get<string>('empire:settings:services');
  let apiKey = '';
  if (servicesRaw) {
    try {
      const services = typeof servicesRaw === 'string' ? JSON.parse(servicesRaw) : servicesRaw;
      const falService = services.find((s: any) => s.label?.toLowerCase() === 'fal.ai');
      if (falService) apiKey = falService.apiKey;
    } catch {}
  }
  if (!apiKey) apiKey = process.env.FAL_API_KEY ?? '';
  if (!apiKey) return { success: false, output: null, error: 'FAL.AI key not configured' };
  const res = await fetch('https://fal.run/' + model, {
    method: 'POST',
    headers: { 'Authorization': 'Key ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  return { success: res.ok, output: data };
});

// --- Herramienta: generar video con Replicate (CORREGIDO Fix #6) ---
registerTool('generate_video', async ({ prompt, imageUrl }) => {
  // Leer de empire:settings:services (formato: [{ label: "Replicate", apiKey: "..." }])
  const servicesRaw = await redis.get<string>('empire:settings:services');
  let apiKey = '';
  if (servicesRaw) {
    try {
      const services = typeof servicesRaw === 'string' ? JSON.parse(servicesRaw) : servicesRaw;
      const repService = services.find((s: any) => s.label?.toLowerCase() === 'replicate');
      if (repService) apiKey = repService.apiKey;
    } catch {}
  }
  if (!apiKey) apiKey = process.env.REPLICATE_API_KEY ?? '';
  if (!apiKey) return { success: false, output: null, error: 'Replicate key not configured' };
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 'minimax/video-01',
      input: { prompt, first_frame_image: imageUrl },
    }),
  });
  const data = await res.json();
  return { success: res.ok, output: data };
});

// --- Executor remoto (LiteVLA-Edge / physical) ---
registerTool('physical_executor', async ({ command, endpoint }) => {
  if (!endpoint) return { success: false, output: null, error: 'No edge endpoint configured' };
  try {
    const res = await fetch(endpoint + '/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();
    return { success: res.ok, output: data };
  } catch (err: any) {
    return { success: false, output: null, error: err.message };
  }
});

// ============================================================
// HERRAMIENTA: shell_exec
// Ejecución de comandos del sistema con sandbox, lista blanca,
// clasificación de riesgo, aprobación humana y trazabilidad OMK.
// ============================================================

// Directorio raíz del sandbox. Todo path de trabajo se resuelve
// relativo a este directorio. Nunca se permite salir de él.
const WORKSPACE_ROOT: string =
  process.env.WORKSPACE_ROOT ?? path.join(process.cwd(), 'workspace');

// Lista blanca de comandos permitidos.
// Incluye comandos Unix/Linux/macOS + Windows nativos + herramientas de desarrollo.
const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  // Unix / Linux / macOS / WSL
  'ls', 'cat', 'echo', 'mkdir', 'rmdir', 'rm', 'mv', 'cp',
  'touch', 'chmod', 'grep', 'find', 'head', 'tail', 'wc',
  'sort', 'uniq', 'bash', 'sh', 'zsh',
  // Windows nativos
  'dir', 'type', 'copy', 'move', 'del', 'ren', 'xcopy',
  'robocopy', 'attrib', 'where', 'cmd', 'powershell',
  // Herramientas de desarrollo
  'python', 'python3', 'node', 'npm', 'npx',
  'git', 'make', 'gcc',
]);

// Clasificación de riesgo por comando.
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

function classifyRisk(command: string): RiskLevel {
  const cmd = command.toLowerCase();

  // Crítico: cualquier comando fuera de la lista blanca
  if (!ALLOWED_COMMANDS.has(cmd)) return 'critical';

  // Alto: comandos destructivos del sistema (ninguno está en la lista blanca,
  // pero se deja explícito por si se agrega en el futuro)
  const highRisk = new Set(['sudo', 'dd', 'mkfs', 'fdisk', 'shutdown', 'reboot']);
  if (highRisk.has(cmd)) return 'high';

  // Medio: comandos que modifican archivos o ejecutan shells
  const mediumRisk = new Set([
    'rm', 'mv', 'cp', 'mkdir', 'rmdir', 'chmod', 'touch',
    'del', 'copy', 'move', 'ren', 'xcopy', 'robocopy', 'attrib',
    'bash', 'sh', 'zsh', 'cmd', 'powershell',
    'python', 'python3', 'node', 'npm', 'npx',
    'git', 'make', 'gcc',
  ]);
  if (mediumRisk.has(cmd)) return 'medium';

  // Bajo: solo lectura
  return 'low';
}

// Necesita aprobación humana si el riesgo es medio o alto
function requiresApproval(risk: RiskLevel): boolean {
  return risk === 'medium' || risk === 'high';
}

registerTool('shell_exec', async ({
  command,
  args = [],
  cwd = '.',
  approved = false,
  timeoutMs = 30_000,
  maxBufferBytes = 10 * 1024 * 1024,
  agentId,
  companyId,
}: {
  command: string;
  args?: string[];
  cwd?: string;
  approved?: boolean;
  timeoutMs?: number;
  maxBufferBytes?: number;
  agentId?: string;
  companyId?: string;
}): Promise<ToolResult> => {

  // ── 1. Validar que command es un string limpio (no un string con espacios
  //       que oculte argumentos extra — eso sería bypass de lista blanca).
  if (typeof command !== 'string' || command.trim() === '') {
    return {
      success: false,
      output: null,
      error: 'El parámetro "command" debe ser un string no vacío con el nombre del ejecutable solamente. ' +
             'Los argumentos van en el array "args". Ejemplo: { command: "ls", args: ["-la"] }',
    };
  }

  // Rechazar si command contiene espacios (señal de que se intentó pasar
  // "ls -la" como string completo en lugar de separar args correctamente).
  if (command.includes(' ')) {
    return {
      success: false,
      output: null,
      error: 'El campo "command" no puede contener espacios. ' +
             'Separa los argumentos: { command: "ls", args: ["-la"] } en vez de { command: "ls -la" }.',
    };
  }

  const cmd = command.toLowerCase().trim();

  // ── 2. Clasificar riesgo ANTES de cualquier operación de sistema de archivos.
  const risk: RiskLevel = classifyRisk(cmd);

  if (risk === 'critical') {
    // Registrar intento con OMK y rechazar.
    try {
      await writeProof(
        'shell_exec:blocked:critical',
        { command, args, cwd, risk },
        { blocked: true, reason: 'Comando no está en la lista blanca' },
        agentId,
        companyId,
      );
    } catch { /* no bloquear el flujo por fallo de trazabilidad */ }

    return {
      success: false,
      output: null,
      error: `Comando "${command}" rechazado — no está en la lista blanca de comandos permitidos. ` +
             `Comandos permitidos: ${[...ALLOWED_COMMANDS].join(', ')}`,
    };
  }

  // ── 3. Verificar y crear WORKSPACE_ROOT si no existe.
  try {
    await fs.promises.mkdir(WORKSPACE_ROOT, { recursive: true });
  } catch (err: any) {
    return {
      success: false,
      output: null,
      error: `No se pudo crear el directorio workspace en "${WORKSPACE_ROOT}": ${err.message}`,
    };
  }

  // ── 4. Resolver el cwd dentro del workspace y verificar path traversal.
  //       path.resolve con dos argumentos resuelve el segundo relativo al primero.
  const resolvedCwd = path.resolve(WORKSPACE_ROOT, cwd);

  // El path resuelto debe empezar con WORKSPACE_ROOT + separador (o ser exactamente WORKSPACE_ROOT).
  // Esto previene "../../../etc" y similares.
  const workspaceNormalized = path.normalize(WORKSPACE_ROOT);
  const cwdNormalized = path.normalize(resolvedCwd);

  if (cwdNormalized !== workspaceNormalized && !cwdNormalized.startsWith(workspaceNormalized + path.sep)) {
    return {
      success: false,
      output: null,
      error: `Path traversal detectado. El directorio de trabajo "${cwd}" resuelve fuera del workspace. ` +
             `Todo trabajo debe ocurrir dentro de "${WORKSPACE_ROOT}".`,
    };
  }

  // Crear el subdirectorio de trabajo si no existe.
  try {
    await fs.promises.mkdir(resolvedCwd, { recursive: true });
  } catch (err: any) {
    return {
      success: false,
      output: null,
      error: `No se pudo crear el directorio de trabajo "${resolvedCwd}": ${err.message}`,
    };
  }

  // ── 5. Aprobación humana para riesgo medio o alto.
  if (requiresApproval(risk) && !approved) {
    let approvalId = 'unknown';
    try {
      const approvalRequest = await createApprovalRequest(
        'shell_exec',
        { command, args, cwd: resolvedCwd, risk },
        agentId,
        companyId,
      );
      approvalId = approvalRequest.id;
    } catch (err: any) {
      return {
        success: false,
        output: null,
        error: `No se pudo crear la solicitud de aprobación: ${err.message}`,
      };
    }

    return {
      success: false,
      output: { approvalId, pendingApproval: true },
      error: `El comando "${command}" tiene riesgo "${risk}" y requiere aprobación humana. ` +
             `Solicitud creada con ID: ${approvalId}. ` +
             `Re-ejecuta esta herramienta con el parámetro "approved: true" una vez aprobada.`,
    };
  }

  // ── 6. Proof ANTES de ejecutar (trazabilidad pre-ejecución).
  const startTs = Date.now();
  let preProofId = 'unknown';
  try {
    const preProof = await writeProof(
      'shell_exec:start',
      { command, args, cwd: resolvedCwd, risk, approved },
      null,
      agentId,
      companyId,
    );
    preProofId = preProof.id;
  } catch { /* no bloquear ejecución por fallo de trazabilidad */ }

  // ── 7. Log justo antes de ejecutar.
  try {
    await logOrchestratorAction('shell_exec:run:' + command);
  } catch { /* no bloquear */ }

  // ── 8. Ejecutar con execFile (nunca exec, para evitar inyección de shell).
  let stdout = '';
  let stderr = '';
  let execError: string | null = null;

  try {
    const result = await execFilePromise(command, args, {
      cwd: resolvedCwd,
      timeout: timeoutMs,
      maxBuffer: maxBufferBytes,
      // En Windows, algunos comandos internos (dir, type, del, etc.) no son
      // ejecutables directamente — son built-ins de cmd.exe. Para esos casos,
      // los envolvemos en cmd /c. En Unix los dejamos pasar directamente.
      ...(process.platform === 'win32' &&
        ['dir', 'type', 'copy', 'move', 'del', 'ren', 'xcopy', 'robocopy', 'attrib', 'where'].includes(cmd)
        ? { shell: true }   // solo para built-ins de Windows que no tienen .exe propio
        : {}
      ),
    });
    stdout = result.stdout ?? '';
    stderr = result.stderr ?? '';
  } catch (err: any) {
    // execFile rechaza tanto por error de proceso (exit code != 0)
    // como por timeout o maxBuffer.
    execError = err.message ?? String(err);
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }

  const durationMs = Date.now() - startTs;
  const success = execError === null;

  // ── 9. Proof DESPUÉS de ejecutar (trazabilidad post-ejecución).
  try {
    await writeProof(
      success ? 'shell_exec:success' : 'shell_exec:error',
      { command, args, cwd: resolvedCwd, risk, approved, preProofId },
      success
        ? { stdout, stderr }
        : { stdout, stderr, error: execError },
      agentId,
      companyId,
      durationMs,
    );
  } catch { /* no bloquear el retorno */ }

  // ── 10. Retornar resultado.
  if (!success) {
    return {
      success: false,
      output: { stdout, stderr, durationMs },
      error: execError ?? 'Error desconocido al ejecutar el comando.',
    };
  }

  return {
    success: true,
    output: { stdout, stderr, durationMs },
  };
});