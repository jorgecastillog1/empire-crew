import { redis } from '@/lib/redis';
import { logOrchestratorAction } from '@/lib/orchestrator';

// ============================================================
// AGENT MONITOR — Ventana deslizante + RiskScore
// ============================================================

export type AgentEventType =
  | 'success'
  | 'error'
  | 'missed_opportunity'
  | 'high_cost'
  | 'slow_response';

export interface AgentEvent {
  agentId: string;
  companyId: string;
  eventType: AgentEventType;
  details: string;
  timestamp: number;
  cost?: number;
  durationMs?: number;
}

export type AgentDecision = 'continue' | 'warning' | 'probation' | 'terminate';

export interface QuickEvalResult {
  agentId: string;
  companyId: string;
  quickScore: number;
  riskScore: number;
  decision: AgentDecision;
  reason: string;
  timestamp: number;
}

// ─── Keys Redis ───────────────────────────────────────────────
const MON = {
  events: (agentId: string) => `empire:monitor:events:${agentId}`,
  risk: (agentId: string) => `empire:monitor:risk:${agentId}`,
  eval: (agentId: string) => `empire:monitor:eval:${agentId}`,
  allAgents: 'empire:monitor:agents',
};

// ─── Registrar evento ─────────────────────────────────────────
export async function recordAgentEvent(
  agentId: string,
  companyId: string,
  eventType: AgentEventType,
  details: string,
  extras: { cost?: number; durationMs?: number } = {}
): Promise<void> {
  const event: AgentEvent = {
    agentId,
    companyId,
    eventType,
    details,
    timestamp: Date.now(),
    ...extras,
  };

  await redis.lpush(MON.events(agentId), JSON.stringify(event));
  await redis.ltrim(MON.events(agentId), 0, 99); // ventana de 100 eventos
  await redis.expire(MON.events(agentId), 86400 * 7);
  await redis.sadd(MON.allAgents, agentId + ':' + companyId);

  // Actualizar riskScore en tiempo real
  await updateRiskScore(agentId, eventType);
  await logOrchestratorAction('monitor:event:' + eventType + ':' + agentId);
}

// ─── Actualizar riskScore dinámico ────────────────────────────
async function updateRiskScore(agentId: string, eventType: AgentEventType): Promise<void> {
  const raw = await redis.get<number>(MON.risk(agentId)) ?? 0;
  let risk = Number(raw);

  // Eventos negativos suman riesgo, positivos lo reducen
  switch (eventType) {
    case 'error':             risk += 15; break;
    case 'missed_opportunity': risk += 10; break;
    case 'high_cost':         risk += 8;  break;
    case 'slow_response':     risk += 3;  break;
    case 'success':           risk = Math.max(0, risk - 5); break;
  }

  risk = Math.min(100, Math.max(0, risk));
  await redis.set(MON.risk(agentId), risk, { ex: 86400 * 7 });
}

// ─── Obtener riskScore ────────────────────────────────────────
export async function getAgentRiskScore(agentId: string): Promise<number> {
  return Number(await redis.get<number>(MON.risk(agentId)) ?? 0);
}

// ─── Evaluación rápida (cada 6 horas) ────────────────────────
export async function quickEvaluateAgent(
  agentId: string,
  companyId: string
): Promise<QuickEvalResult> {
  const rawEvents = await redis.lrange(MON.events(agentId), 0, 99) as string[];
  const events: AgentEvent[] = rawEvents.map(e => {
    try { return typeof e === 'string' ? JSON.parse(e) : e; }
    catch { return null; }
  }).filter(Boolean);

  const now = Date.now();
  const last6h = events.filter(e => now - e.timestamp < 6 * 3600 * 1000);
  const last1h  = events.filter(e => now - e.timestamp < 3600 * 1000);
  const last24h = events.filter(e => now - e.timestamp < 24 * 3600 * 1000);

  const errors1h        = last1h.filter(e => e.eventType === 'error').length;
  const missed1h        = last1h.filter(e => e.eventType === 'missed_opportunity').length;
  const missed6h        = last6h.filter(e => e.eventType === 'missed_opportunity').length;
  const errors24h       = last24h.filter(e => e.eventType === 'error').length;
  const successes24h    = last24h.filter(e => e.eventType === 'success').length;
  const total24h        = errors24h + successes24h;
  const errorRatio24h   = total24h > 0 ? errors24h / total24h : 0;

  const riskScore = await getAgentRiskScore(agentId);

  // Calcular quickScore (0-100)
  let quickScore = 100;
  quickScore -= errors1h * 10;
  quickScore -= missed1h * 8;
  quickScore -= missed6h * 4;
  quickScore -= errorRatio24h * 30;
  quickScore -= riskScore * 0.2;
  quickScore = Math.min(100, Math.max(0, Math.round(quickScore)));

  // Decisión según umbrales
  let decision: AgentDecision = 'continue';
  let reason = 'Agente operando normalmente';

  if (errors1h >= 5 || quickScore < 20 || errorRatio24h > 0.7) {
    decision = 'terminate';
    reason = `Score crítico: ${quickScore}. Ratio error 24h: ${(errorRatio24h * 100).toFixed(0)}%`;
  } else if (errors1h >= 3 || quickScore < 40 || errorRatio24h > 0.4 || missed6h >= 5) {
    decision = 'probation';
    reason = `Score bajo: ${quickScore}. Errores 1h: ${errors1h}. Oportunidades perdidas 6h: ${missed6h}`;
  } else if (missed1h >= 2 || riskScore > 40) {
    decision = 'warning';
    reason = `RiskScore elevado: ${riskScore}. Oportunidades perdidas 1h: ${missed1h}`;
  }

  const result: QuickEvalResult = {
    agentId,
    companyId,
    quickScore,
    riskScore,
    decision,
    reason,
    timestamp: now,
  };

  await redis.set(MON.eval(agentId), JSON.stringify(result), { ex: 86400 });
  await logOrchestratorAction('monitor:eval:' + decision + ':' + agentId + ':score' + quickScore);

  return result;
}

// ─── Evaluar todos los agentes registrados ────────────────────
export async function evaluateAllAgents(): Promise<QuickEvalResult[]> {
  const members = await redis.smembers(MON.allAgents) as string[];
  const results: QuickEvalResult[] = [];

  for (const member of members) {
    const [agentId, companyId] = member.split(':');
    if (!agentId) continue;
    try {
      results.push(await quickEvaluateAgent(agentId, companyId ?? ''));
    } catch {}
  }

  await logOrchestratorAction('monitor:evalAll:' + results.length + '_agents');
  return results;
}

// ─── Obtener última evaluación ────────────────────────────────
export async function getAgentEval(agentId: string): Promise<QuickEvalResult | null> {
  const raw = await redis.get<string>(MON.eval(agentId));
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
}

// ─── Obtener eventos recientes ────────────────────────────────
export async function getAgentEvents(agentId: string, limit = 20): Promise<AgentEvent[]> {
  const raw = await redis.lrange(MON.events(agentId), 0, limit - 1) as string[];
  return raw.map(e => {
    try { return typeof e === 'string' ? JSON.parse(e) : e; }
    catch { return null; }
  }).filter(Boolean);
}