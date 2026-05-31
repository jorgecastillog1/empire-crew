import { redis } from './redis';
import { Company, Agent } from './db';
import { z } from 'zod';

// ============================================================
// BLOQUE 1: Interfaces + Zod schemas
// ============================================================

export interface GroqAccount {
  id: string; apiKey: string; active: boolean; label?: string;
}

export interface CLEARMetrics {
  cost: number; latency: number; efficiency: number;
  assurance: number; reliability: number;
  costNormalizedAccuracy: number;
  policyAdherenceScore: number;
  slaComplianceRate: number;
}

export interface AgentMemory {
  episodic: { event: string; outcome: string; timestamp: number }[];
  semantic: { concept: string; knowledge: string; confidence: number }[];
  working: string;
  procedural: { workflow: string; successRate: number; usageCount: number; steps: string[] }[];
}

export interface WeeklyEvaluation {
  week: number;
  clearMetrics: CLEARMetrics;
  revenueImpact: number;
  correctAnalysis: number;
  totalAnalysis: number;
  decision: 'continue' | 'probation' | 'terminate';
  reasoning: string;
  traceability: string[];
  timestamp: number;
  capabilityScores?: Record<string, number>;
}

export interface SuperAgent {
  id: string; companyId: string; name: string; role: string;
  status: 'idle' | 'executing' | 'analyzing' | 'deliberating' | 'vetoed';
  model: string; systemPrompt: string; capabilities: string[];
  connectedAPIs: string[];
  metrics: { primary: string; secondary: string[]; targets: Record<string, number> };
  memory: AgentMemory;
  hasVeto: boolean; vetoConditions: string[]; voteWeight: number;
  clearMetrics: CLEARMetrics;
  weeklyEvaluations: WeeklyEvaluation[];
  revenueGenerated: number; createdAt: number; lastEvaluatedAt: number;
  generation: number; inheritedKnowledge: string[]; errors: string[]; wins: string[];
  status_lifecycle: 'alive' | 'probation' | 'dead';
  promptCacheKey?: string;
  tokenUsage: number; weeklyTokenBudget: number;
  version: number; parentVersion?: number; lastCheckpoint?: string;
  allowedDomains?: string[];
  minPrivilegeRole?: 'reader' | 'analyst' | 'executor';
  delegatedUser?: string;
}

export interface ConsensusSession {
  id: string; companyId: string;
  architecture: 'consensus' | 'pipeline' | 'hierarchical' | 'competitive';
  trigger: string; context: any;
  votes: { agentId: string; vote: string; reasoning: string; weight: number }[];
  vetoes: { agentId: string; reason: string }[];
  conflicts: { agentA: string; agentB: string; conflict: string }[];
  status: 'open' | 'approved' | 'rejected' | 'vetoed' | 'conflict';
  result: string; reasoning: string; timestamp: number;
  cost: number; latency: number; priority: number;
}

export interface OrchestratorReport {
  timestamp: number; ecosystemHealth: number;
  totalCompanies: number; totalAgents: number;
  agentsOnProbation: string[]; agentsDead: string[];
  opportunities: string[]; alerts: string[]; actions: string[];
  weeklyInsights: string[]; totalRevenue: number; costThisWeek: number;
}

export interface ApprovalRequest {
  id: string; action: string; agentId?: string; companyId?: string;
  details: any; status: 'pending' | 'approved' | 'rejected';
  requestedAt: number; approvedBy?: string; reasoning?: string;
}

export interface HTNTask {
  id: string; name: string; description: string;
  subtasks?: HTNTask[]; primitive?: boolean;
  action?: string; parameters?: any;
}

export interface TaskPrioritization {
  taskId: string; priority: number; estimatedCost: number;
  deadline: number; dependencies: string[];
}

export const CLEARMetricsSchema = z.object({
  cost: z.number().min(0).max(100),
  latency: z.number().min(0).max(100),
  efficiency: z.number().min(0).max(100),
  assurance: z.number().min(0).max(100),
  reliability: z.number().min(0).max(100),
  costNormalizedAccuracy: z.number().min(0).max(100),
  policyAdherenceScore: z.number().min(0).max(100),
  slaComplianceRate: z.number().min(0).max(100),
});

export const SuperAgentSchema = z.object({
  id: z.string(), companyId: z.string(), name: z.string(), role: z.string(),
  status: z.enum(['idle','executing','analyzing','deliberating','vetoed']),
  model: z.string(), systemPrompt: z.string(), capabilities: z.array(z.string()),
  connectedAPIs: z.array(z.string()),
  metrics: z.object({
    primary: z.string(),
    secondary: z.array(z.string()),
    targets: z.record(z.string(), z.number())
  }),
  memory: z.any(),
  hasVeto: z.boolean(), vetoConditions: z.array(z.string()), voteWeight: z.number(),
  clearMetrics: CLEARMetricsSchema,
  weeklyEvaluations: z.array(z.any()),
  revenueGenerated: z.number(), createdAt: z.number(), lastEvaluatedAt: z.number(),
  generation: z.number(), inheritedKnowledge: z.array(z.string()),
  errors: z.array(z.string()), wins: z.array(z.string()),
  status_lifecycle: z.enum(['alive','probation','dead']),
  promptCacheKey: z.string().optional(),
  tokenUsage: z.number(), weeklyTokenBudget: z.number(),
  version: z.number().default(1),
  parentVersion: z.number().optional(),
  lastCheckpoint: z.string().optional(),
  allowedDomains: z.array(z.string()).optional(),
  minPrivilegeRole: z.enum(['reader','analyst','executor']).optional(),
  delegatedUser: z.string().optional(),
});

export const DEFAULT_CLEAR: CLEARMetrics = {
  cost: 0, latency: 0, efficiency: 0,
  assurance: 100, reliability: 100,
  costNormalizedAccuracy: 0,
  policyAdherenceScore: 100,
  slaComplianceRate: 100,
};

export async function logOrchestratorAction(action: string): Promise<void> {
  try {
    await redis.lpush('empire:orchestrator:log', JSON.stringify({ action, timestamp: Date.now() }));
    await redis.ltrim('empire:orchestrator:log', 0, 99);
  } catch {}
}

export async function getOrchestratorLog(): Promise<{ action: string; timestamp: number }[]> {
  const logs = await redis.lrange('empire:orchestrator:log', 0, 49) as string[];
  return logs.map(l => {
    try { return typeof l === 'string' ? JSON.parse(l) : l; }
    catch { return { action: String(l), timestamp: Date.now() }; }
  });
}

// ============================================================
// BLOQUE 2: Cache + Semantic cache + Rate limiting + Keys pool
// ============================================================

export async function getNextApiKey(provider: 'groq' | 'openai' | 'anthropic'): Promise<string> {
  if (provider === 'groq') {
    const raw = await redis.lrange('empire:groq:accounts', 0, -1) as string[];
    const accounts = raw.map(a => typeof a === 'string' ? JSON.parse(a) : a).filter((a: any) => a.apiKey);
    if (accounts.length === 0) return process.env.GROQ_API_KEY ?? '';
    const idxKey = 'pool:groq:index';
    const idx = Number(await redis.get<number>(idxKey) ?? 0) % accounts.length;
    await redis.set(idxKey, (idx + 1) % accounts.length);
    return accounts[idx].apiKey;
  }
  const settingsRaw = await redis.get<string>('settings:credentials');
  const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
  if (provider === 'openai') return settings.openaiApiKey ?? '';
  if (provider === 'anthropic') return settings.anthropicApiKey ?? '';
  return '';
}

export function hashPrompt(systemPrompt: string, userMessage: string, model: string): string {
  const raw = model + '||' + systemPrompt + '||' + userMessage;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export async function getCachedResponse(promptHash: string): Promise<string | null> {
  return redis.get<string>('cache:prompt:' + promptHash);
}

export async function setCachedResponse(
  promptHash: string,
  response: string,
  ttlSeconds = 3600
): Promise<void> {
  await redis.set('cache:prompt:' + promptHash, response, { ex: ttlSeconds });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

export async function getSemanticCachedResponse(
  embedding: number[],
  threshold = 0.92
): Promise<{ response: string; similarity: number } | null> {
  const keys = await redis.keys('cache:semantic:*');
  let bestMatch: { response: string; similarity: number } | null = null;
  for (const key of keys.slice(0, 200)) {
    const entry = await redis.get<{ embedding: number[]; response: string }>(key);
    if (!entry) continue;
    const sim = cosineSimilarity(embedding, entry.embedding);
    if (sim >= threshold && (!bestMatch || sim > bestMatch.similarity)) {
      bestMatch = { response: entry.response, similarity: sim };
    }
  }
  return bestMatch;
}

export async function setSemanticCache(
  embedding: number[],
  response: string,
  ttlSeconds = 7200
): Promise<void> {
  const id = Date.now().toString(36);
  await redis.set('cache:semantic:' + id, { embedding, response }, { ex: ttlSeconds });
}

function getWeekStart(): number {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
  return Math.floor(monday.getTime() / 1000);
}

export async function checkRateLimit(
  agentId: string,
  tokensRequested: number,
  weeklyBudget = 500000
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const weekStart = getWeekStart();
  const key = 'ratelimit:' + agentId + ':' + weekStart;
  const used = Number(await redis.get<number>(key) ?? 0);
  const remaining = weeklyBudget - used;
  if (used + tokensRequested > weeklyBudget) {
    return { allowed: false, remaining: Math.max(0, remaining), resetAt: weekStart + 7 * 86400 };
  }
  const newUsed = used + tokensRequested;
  const ttl = (weekStart + 7 * 86400) - Math.floor(Date.now() / 1000);
  await redis.set(key, newUsed, { ex: Math.max(ttl, 1) });
  return { allowed: true, remaining: weeklyBudget - newUsed, resetAt: weekStart + 7 * 86400 };
}

export async function getTokenUsageStats(agentId: string): Promise<{
  used: number; budget: number; resetAt: number; percentUsed: number;
}> {
  const weekStart = getWeekStart();
  const key = 'ratelimit:' + agentId + ':' + weekStart;
  const used = Number(await redis.get<number>(key) ?? 0);
  const budget = 500000;
  return {
    used,
    budget,
    resetAt: weekStart + 7 * 86400,
    percentUsed: Math.round((used / budget) * 100),
  };
}
// ============================================================
// BLOQUE 3: callLLM con cache + rate limit + fallback + tracing
// ============================================================

interface LLMOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  agentId?: string;
  maxTokens?: number;
  useCache?: boolean;
}

interface LLMResult {
  response: string;
  model: string;
  tokensUsed: number;
  fromCache: boolean;
  latencyMs: number;
  traceId: string;
}

export async function callLLM(opts: LLMOptions & { companyId?: string }): Promise<LLMResult> {
  const {
    systemPrompt,
    userMessage,
    model = 'llama-3.3-70b-versatile',
    agentId = 'default',
    companyId = 'unknown',
    maxTokens = 1000,
    useCache = true,
  } = opts;

  const traceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const start = Date.now();

  // Check exact cache
  if (useCache) {
    const hash = hashPrompt(systemPrompt, userMessage, model);
    const cached = await getCachedResponse(hash);
    if (cached) {
      return { response: cached, model, tokensUsed: 0, fromCache: true, latencyMs: 0, traceId };
    }
  }

  // Rate limit check
  const rl = await checkRateLimit(agentId, maxTokens);
  if (!rl.allowed) {
    throw new Error('Rate limit exceeded for agent ' + agentId + '. Resets at ' + new Date(rl.resetAt * 1000).toISOString());
  }

  // Tracing: span start
  await redis.set('trace:' + traceId, JSON.stringify({ agentId, model, start, status: 'running' }), { ex: 3600 });

  const providers = [
    { name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions' },
    { name: 'openai', url: 'https://api.openai.com/v1/chat/completions' },
    { name: 'anthropic', url: '' },
  ];

  let lastError = '';

  for (const provider of providers) {
    try {
      const apiKey = await getNextApiKey(provider.name as 'groq' | 'openai' | 'anthropic');
      if (!apiKey) continue;

      let response = '';

      if (provider.name === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message ?? 'Anthropic error');
        response = data.content?.[0]?.text ?? '';
      } else {
        const res = await fetch(provider.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
          },
          body: JSON.stringify({
            model: provider.name === 'openai' ? 'gpt-4o-mini' : model,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message ?? provider.name + ' error');
        response = data.choices?.[0]?.message?.content ?? '';
      }

      const latencyMs = Date.now() - start;
      const tokensUsed = Math.ceil((systemPrompt.length + userMessage.length + response.length) / 4);

      // Save to cache
      if (useCache) {
        const hash = hashPrompt(systemPrompt, userMessage, model);
        await setCachedResponse(hash, response);
      }

      // Update token usage
      await checkRateLimit(agentId, tokensUsed);

      // Tracing: span end
      await redis.set('trace:' + traceId, JSON.stringify({ agentId, model: provider.name, start, end: Date.now(), latencyMs, tokensUsed, status: 'done' }), { ex: 3600 });

      await logOrchestratorAction('callLLM:' + provider.name + ':' + agentId + ':' + latencyMs + 'ms');

      // Registrar evento en agentMonitor
      const { recordAgentEvent } = await import('@/lib/agentMonitor');
      await recordAgentEvent(agentId, companyId, 'success', 'callLLM:' + provider.name, { durationMs: latencyMs });

      return { response, model: provider.name + '/' + model, tokensUsed, fromCache: false, latencyMs, traceId };

    } catch (err: any) {
      lastError = String(err.message ?? err);
      await logOrchestratorAction('callLLM:fallback:' + provider.name + ':' + lastError.slice(0, 80));
      const { recordAgentEvent } = await import('@/lib/agentMonitor');
      await recordAgentEvent(agentId, companyId, 'error', 'callLLM:' + provider.name + ':' + lastError.slice(0, 80));
      continue;
    }
  }

  throw new Error('All LLM providers failed. Last error: ' + lastError);
}
// ============================================================
// BLOQUE 4: Persistencia multinivel + Checkpoints + Estado compartido
// ============================================================

export async function saveAgentState(agent: SuperAgent): Promise<void> {
  await redis.set('agent:' + agent.companyId + ':' + agent.id, JSON.stringify(agent), { ex: 86400 * 30 });
}

export async function loadAgentState(companyId: string, agentId: string): Promise<SuperAgent | null> {
  const raw = await redis.get<string>('agent:' + companyId + ':' + agentId);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

export async function listAgents(companyId: string): Promise<SuperAgent[]> {
  const keys = await redis.keys('agent:' + companyId + ':*');
  const agents: SuperAgent[] = [];
  for (const key of keys) {
    const raw = await redis.get<string>(key);
    if (!raw) continue;
    try { agents.push(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch {}
  }
  return agents;
}

export async function createCheckpoint(agent: SuperAgent): Promise<string> {
  const checkpointId = 'ckpt:' + agent.id + ':' + Date.now().toString(36);
  await redis.set(checkpointId, JSON.stringify(agent), { ex: 86400 * 7 });
  agent.lastCheckpoint = checkpointId;
  await saveAgentState(agent);
  await logOrchestratorAction('checkpoint:' + agent.id + ':' + checkpointId);
  return checkpointId;
}

export async function rollbackToCheckpoint(checkpointId: string): Promise<SuperAgent | null> {
  const raw = await redis.get<string>(checkpointId);
  if (!raw) return null;
  try {
    const agent: SuperAgent = typeof raw === 'string' ? JSON.parse(raw) : raw;
    await saveAgentState(agent);
    await logOrchestratorAction('rollback:' + agent.id + ':' + checkpointId);
    return agent;
  } catch { return null; }
}

export async function setSharedState(companyId: string, key: string, value: any): Promise<void> {
  await redis.set('shared:' + companyId + ':' + key, JSON.stringify(value), { ex: 86400 });
}

export async function getSharedState<T = any>(companyId: string, key: string): Promise<T | null> {
  const raw = await redis.get<string>('shared:' + companyId + ':' + key);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

export async function saveConsensusSession(session: ConsensusSession): Promise<void> {
  await redis.set('consensus:' + session.id, JSON.stringify(session), { ex: 86400 * 7 });
  await redis.lpush('consensus:list:' + session.companyId, session.id);
  await redis.ltrim('consensus:list:' + session.companyId, 0, 49);
}

export async function getConsensusSession(sessionId: string): Promise<ConsensusSession | null> {
  const raw = await redis.get<string>('consensus:' + sessionId);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}
// ============================================================
// BLOQUE 5: HTN Planning + Enrutamiento semántico + Conflictos
// ============================================================

export async function decomposeHTN(task: HTNTask, depth = 0): Promise<HTNTask[]> {
  if (depth > 5 || task.primitive) return [task];
  if (!task.subtasks || task.subtasks.length === 0) return [task];
  const result: HTNTask[] = [];
  for (const sub of task.subtasks) {
    const decomposed = await decomposeHTN(sub, depth + 1);
    result.push(...decomposed);
  }
  return result;
}

export async function prioritizeTasks(tasks: TaskPrioritization[]): Promise<TaskPrioritization[]> {
  return tasks.sort((a, b) => {
    const urgencyA = a.deadline - Date.now() / 1000;
    const urgencyB = b.deadline - Date.now() / 1000;
    const scoreA = a.priority * 10 - a.estimatedCost * 0.1 - urgencyA * 0.01;
    const scoreB = b.priority * 10 - b.estimatedCost * 0.1 - urgencyB * 0.01;
    return scoreB - scoreA;
  });
}

export async function routeTaskToAgent(
  task: string,
  agents: SuperAgent[],
  companyType: string
): Promise<SuperAgent | null> {
  if (agents.length === 0) return null;
  if (agents.length === 1) return agents[0];

  const agentList = agents.map((a, i) =>
    i + '. ' + a.name + ' (' + a.role + ') capabilities: ' + a.capabilities.join(', ')
  ).join('\n');

  const systemPrompt = 'You are a task router. Given a task and a list of agents, respond with ONLY the index number (0-based) of the best agent for the task. No explanation.';
  const userMessage = 'Task: ' + task + '\n\nAgents:\n' + agentList + '\n\nCompany type: ' + companyType;

  try {
    const result = await callLLM({ systemPrompt, userMessage, model: 'llama-3.1-8b-instant', agentId: 'router', maxTokens: 10 });
    const idx = parseInt(result.response.trim(), 10);
    if (!isNaN(idx) && idx >= 0 && idx < agents.length) return agents[idx];
  } catch {}

  return agents[0];
}

export async function detectConflicts(session: ConsensusSession): Promise<string[]> {
  const conflicts: string[] = [];
  const votes = session.votes;
  if (votes.length < 2) return conflicts;

  for (let i = 0; i < votes.length; i++) {
    for (let j = i + 1; j < votes.length; j++) {
      const a = votes[i];
      const b = votes[j];
      const similarity = a.vote.toLowerCase().split(' ').filter(w =>
        b.vote.toLowerCase().includes(w) && w.length > 4
      ).length;
      if (similarity < 2) {
        conflicts.push('Conflict between ' + a.agentId + ' and ' + b.agentId + ': divergent positions');
      }
    }
  }
  return conflicts;
}

export async function resolveConflict(
  conflict: string,
  votes: ConsensusSession['votes'],
  companyId: string
): Promise<string> {
  const votesSummary = votes.map(v => v.agentId + ' (weight ' + v.weight + '): ' + v.vote).join('\n');
  const systemPrompt = 'You are a conflict resolver for an AI agent system. Given conflicting agent votes, synthesize a balanced resolution that respects the highest-weight agents. Be concise.';
  const userMessage = 'Conflict: ' + conflict + '\n\nVotes:\n' + votesSummary;

  try {
    const result = await callLLM({ systemPrompt, userMessage, agentId: 'resolver:' + companyId, maxTokens: 300 });
    return result.response;
  } catch {
    const topVote = votes.sort((a, b) => b.weight - a.weight)[0];
    return topVote ? topVote.vote : 'No resolution possible';
  }
}

export async function runConsensus(
  session: ConsensusSession,
  agents: SuperAgent[]
): Promise<ConsensusSession> {
  if (session.architecture === 'consensus') {
    const conflicts = await detectConflicts(session);
    session.conflicts = conflicts.map(c => ({
      agentA: '', agentB: '', conflict: c
    }));
    if (conflicts.length > 0) {
      const resolution = await resolveConflict(conflicts[0], session.votes, session.companyId);
      session.result = resolution;
      session.status = 'conflict';
    } else {
      const totalWeight = session.votes.reduce((s, v) => s + v.weight, 0);
      const tally: Record<string, number> = {};
      for (const v of session.votes) {
        const key = v.vote.slice(0, 50);
        tally[key] = (tally[key] ?? 0) + v.weight;
      }
      const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      session.result = winner ? winner[0] : '';
      session.status = session.vetoes.length > 0 ? 'vetoed' : 'approved';
    }
  }
  await saveConsensusSession(session);
  return session;
}
// ============================================================
// BLOQUE 6: Sandboxing + Seguridad + Versionado con rollback
// ============================================================

import { runInNewContext } from 'vm';

export function sandboxedExec(code: string, context: Record<string, any> = {}, timeoutMs = 3000): any {
  const sandbox = { result: undefined, console: { log: () => {} }, ...context };
  try {
    runInNewContext(code, sandbox, { timeout: timeoutMs });
    return { success: true, result: sandbox.result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function checkEgressAllowed(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  try {
    const hostname = new URL(url).hostname;
    return allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

export function enforceMinPrivilege(
  agent: SuperAgent,
  requiredRole: 'reader' | 'analyst' | 'executor'
): boolean {
  const hierarchy = { reader: 0, analyst: 1, executor: 2 };
  const agentLevel = hierarchy[agent.minPrivilegeRole ?? 'reader'];
  const requiredLevel = hierarchy[requiredRole];
  return agentLevel >= requiredLevel;
}

export async function versionAgent(agent: SuperAgent): Promise<SuperAgent> {
  const prevVersion = agent.version ?? 1;
  const versionedCopy = { ...agent, version: prevVersion };
  await redis.set(
    'agent:version:' + agent.id + ':' + prevVersion,
    JSON.stringify(versionedCopy),
    { ex: 86400 * 30 }
  );
  agent.parentVersion = prevVersion;
  agent.version = prevVersion + 1;
  await saveAgentState(agent);
  await logOrchestratorAction('version:' + agent.id + ':v' + agent.version);
  return agent;
}

export async function rollbackAgentVersion(agentId: string, version: number): Promise<SuperAgent | null> {
  const raw = await redis.get<string>('agent:version:' + agentId + ':' + version);
  if (!raw) return null;
  try {
    const agent: SuperAgent = typeof raw === 'string' ? JSON.parse(raw) : raw;
    await saveAgentState(agent);
    await logOrchestratorAction('rollback:version:' + agentId + ':v' + version);
    return agent;
  } catch { return null; }
}

export async function listAgentVersions(agentId: string): Promise<number[]> {
  const keys = await redis.keys('agent:version:' + agentId + ':*');
  return keys.map(k => parseInt(k.split(':').pop() ?? '0', 10)).sort((a, b) => b - a);
}
// ============================================================
// BLOQUE 7: Investigación Tavily + Diseño super agentes + Creación empresa
// ============================================================

export async function researchWithTavily(query: string): Promise<string> {
  const settingsRaw = await redis.get<string>('settings:credentials');
  const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
  const accounts: { apiKey: string; active: boolean }[] = settings.tavilyAccounts ?? [];
  const active = accounts.filter(a => a.active && a.apiKey);
  const apiKey = active.length > 0 ? active[0].apiKey : (process.env.TAVILY_API_KEY ?? '');
  if (!apiKey) return 'No Tavily API key configured.';

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: 'advanced', max_results: 5 }),
    });
    const data = await res.json();
    return (data.results ?? []).map((r: any) => r.title + ': ' + r.content).join('\n\n');
  } catch (err: any) {
    return 'Tavily error: ' + err.message;
  }
}

export async function designSuperAgent(
  role: string,
  companyType: string,
  marketResearch: string
): Promise<Partial<SuperAgent>> {
  const systemPrompt = 'You are an expert AI agent architect. Design a super agent with an extremely detailed system prompt (minimum 800 words). Respond in JSON only with fields: name, role, systemPrompt, capabilities (array), connectedAPIs (array), vetoConditions (array), metrics (object with primary string and secondary array).';
  const userMessage = 'Design a ' + role + ' agent for a ' + companyType + ' company.\n\nMarket research:\n' + marketResearch.slice(0, 2000);

  const result = await callLLM({ systemPrompt, userMessage, agentId: 'designer', maxTokens: 1000 });
  try {
    const clean = result.response.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { name: role, role, systemPrompt: result.response, capabilities: [], connectedAPIs: [] };
  }
}

export async function createCompanyFromDescription(description: string): Promise<{
  company: Partial<Company>;
  agents: Partial<SuperAgent>[];
  plan: string;
}> {
  await logOrchestratorAction('createCompany:start:' + description.slice(0, 60));

  // Fase 1: Investigación de mercado
  const research = await researchWithTavily(description + ' business strategy 2025');

  // Fase 2: Diseño de empresa
  const companySystemPrompt = 'You are a business architect. Given a description and market research, design a digital company. Respond in JSON only with: name (string), type (trading|marketing|cinematography|ecommerce|saas), description (string), goals (array of strings).';
  const companyResult = await callLLM({
    systemPrompt: companySystemPrompt,
    userMessage: 'Description: ' + description + '\n\nResearch:\n' + research.slice(0, 1500),
    agentId: 'company-designer',
    maxTokens: 500,
  });

  let company: any = { description };
  try {
    const clean = companyResult.response.replace(/```json|```/g, '').trim();
    company = { ...company, ...JSON.parse(clean) };
  } catch {}

  // Fase 3: Diseño de agentes
  const roles = ['CEO', 'Revenue Agent', 'Operations Agent'];
  const agents: Partial<SuperAgent>[] = [];
  for (const role of roles) {
    const agent = await designSuperAgent(role, company.type ?? 'marketing', research);
    agents.push(agent);
  }

  // Fase 4: Plan de ejecución
  const planResult = await callLLM({
    systemPrompt: 'You are a strategic planner. Create a 30-day execution plan for the company. Be specific and actionable.',
    userMessage: 'Company: ' + JSON.stringify(company) + '\nAgents: ' + roles.join(', '),
    agentId: 'planner',
    maxTokens: 800,
  });

  await logOrchestratorAction('createCompany:done:' + (company.name ?? description.slice(0, 30)));

  return { company, agents, plan: planResult.response };
}
// ============================================================
// BLOQUE 8: Evaluación CLEAR + Por capacidades + Adaptativa + Reencarnación
// ============================================================

const DOMAIN_WEIGHTS: Record<string, Record<string, number>> = {
  trading: { cost: 0.3, latency: 0.2, efficiency: 0.1, assurance: 0.2, reliability: 0.2 },
  marketing: { cost: 0.15, latency: 0.15, efficiency: 0.25, assurance: 0.2, reliability: 0.25 },
  cinematography: { cost: 0.1, latency: 0.1, efficiency: 0.3, assurance: 0.25, reliability: 0.25 },
  default: { cost: 0.2, latency: 0.2, efficiency: 0.2, assurance: 0.2, reliability: 0.2 },
};

export function computeCLEARScore(metrics: CLEARMetrics, companyType = 'default'): number {
  const w = DOMAIN_WEIGHTS[companyType] ?? DOMAIN_WEIGHTS.default;
  return (
    metrics.cost * w.cost +
    metrics.latency * w.latency +
    metrics.efficiency * w.efficiency +
    metrics.assurance * w.assurance +
    metrics.reliability * w.reliability
  );
}

export function evaluateCapabilities(agent: SuperAgent): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const cap of agent.capabilities) {
    const wins = agent.wins.filter(w => w.toLowerCase().includes(cap.toLowerCase())).length;
    const errors = agent.errors.filter(e => e.toLowerCase().includes(cap.toLowerCase())).length;
    const total = wins + errors;
    scores[cap] = total === 0 ? 50 : Math.round((wins / total) * 100);
  }
  return scores;
}

export async function evaluateAgent(
  agent: SuperAgent,
  companyType: string
): Promise<WeeklyEvaluation> {
  const week = Math.floor(Date.now() / (7 * 86400 * 1000));
  const clearScore = computeCLEARScore(agent.clearMetrics, companyType);
  const capabilityScores = evaluateCapabilities(agent);

  let decision: 'continue' | 'probation' | 'terminate' = 'continue';
  if (clearScore < 30) decision = 'terminate';
  else if (clearScore < 50) decision = 'probation';

  const evaluation: WeeklyEvaluation = {
    week,
    clearMetrics: agent.clearMetrics,
    revenueImpact: agent.revenueGenerated,
    correctAnalysis: agent.wins.length,
    totalAnalysis: agent.wins.length + agent.errors.length,
    decision,
    reasoning: 'CLEAR score: ' + clearScore.toFixed(1) + ' | Decision: ' + decision,
    traceability: agent.wins.slice(-5).concat(agent.errors.slice(-5)),
    timestamp: Date.now(),
    capabilityScores,
  };

  agent.weeklyEvaluations.push(evaluation);
  agent.lastEvaluatedAt = Date.now();
  if (decision === 'probation') agent.status_lifecycle = 'probation';
  if (decision === 'terminate') agent.status_lifecycle = 'dead';
  await saveAgentState(agent);
  await logOrchestratorAction('evaluate:' + agent.id + ':' + decision + ':' + clearScore.toFixed(1));
  return evaluation;
}

export async function reincarnateAgent(deadAgent: SuperAgent, companyType: string): Promise<SuperAgent> {
  const research = await researchWithTavily(deadAgent.role + ' AI agent best practices 2025');
  const design = await designSuperAgent(deadAgent.role, companyType, research);

  const newAgent: SuperAgent = {
    ...deadAgent,
    id: deadAgent.id + '_g' + (deadAgent.generation + 1),
    generation: deadAgent.generation + 1,
    status: 'idle',
    status_lifecycle: 'alive',
    errors: [],
    wins: [],
    tokenUsage: 0,
    revenueGenerated: 0,
    weeklyEvaluations: [],
    createdAt: Date.now(),
    lastEvaluatedAt: Date.now(),
    clearMetrics: { ...DEFAULT_CLEAR },
    inheritedKnowledge: [
      ...deadAgent.inheritedKnowledge,
      ...deadAgent.wins.slice(-10),
      'Avoid: ' + deadAgent.errors.slice(-5).join(', '),
    ],
    systemPrompt: (design.systemPrompt ?? deadAgent.systemPrompt) +
      '\n\nINHERITED KNOWLEDGE:\n' + deadAgent.wins.slice(-5).join('\n'),
    capabilities: design.capabilities ?? deadAgent.capabilities,
    version: 1,
    parentVersion: undefined,
  };

  await saveAgentState(newAgent);
  await logOrchestratorAction('reincarnate:' + deadAgent.id + '->.' + newAgent.id);
  return newAgent;
}
// ============================================================
// BLOQUE 9: Ecosistema + Autodiagnóstico + Human-in-the-loop + judgeAgent
// ============================================================

export async function analyzeEcosystem(): Promise<OrchestratorReport> {
  const { getCompanies } = await import('./db');
  const companies = await getCompanies();

  const allAgents: SuperAgent[] = [];
  for (const company of companies) {
    const agents = await listAgents(company.id ?? '');
    allAgents.push(...agents);
  }

  const agentsOnProbation = allAgents.filter(a => a.status_lifecycle === 'probation').map(a => a.id);
  const agentsDead = allAgents.filter(a => a.status_lifecycle === 'dead').map(a => a.id);
  const totalRevenue = allAgents.reduce((s, a) => s + (a.revenueGenerated ?? 0), 0);
  const ecosystemHealth = allAgents.length === 0 ? 100 :
    Math.round((allAgents.filter(a => a.status_lifecycle === 'alive').length / allAgents.length) * 100);

  const report: OrchestratorReport = {
    timestamp: Date.now(),
    ecosystemHealth,
    totalCompanies: companies.length,
    totalAgents: allAgents.length,
    agentsOnProbation,
    agentsDead,
    opportunities: ecosystemHealth > 80 ? ['Scale operations', 'Expand to new markets'] : ['Focus on agent recovery'],
    alerts: agentsOnProbation.length > 0 ? ['Agents on probation: ' + agentsOnProbation.join(', ')] : [],
    actions: agentsDead.length > 0 ? ['Reincarnate dead agents: ' + agentsDead.join(', ')] : [],
    weeklyInsights: ['Ecosystem health: ' + ecosystemHealth + '%', 'Total revenue: $' + totalRevenue],
    totalRevenue,
    costThisWeek: 0,
  };

  await redis.set('empire:ecosystem:report', JSON.stringify(report), { ex: 3600 });
  await logOrchestratorAction('analyzeEcosystem:health:' + ecosystemHealth);
  return report;
}

export async function selfDiagnose(): Promise<{ status: string; issues: string[]; recommendations: string[] }> {
  const issues: string[] = [];
  const recommendations: string[] = [];

  const redisOk = await redis.ping().then(() => true).catch(() => false);
  if (!redisOk) issues.push('Redis connection failed');

  const settingsRaw = await redis.get<string>('settings:credentials');
  const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
  const groqAccounts: GroqAccount[] = settings.groqAccounts ?? [];
  if (groqAccounts.filter(a => a.active).length === 0) {
    issues.push('No active Groq accounts');
    recommendations.push('Add Groq API keys in Settings');
  }

  const agentKeys = await redis.keys('agent:*:*');
  if (agentKeys.length === 0) {
    issues.push('No agents found');
    recommendations.push('Create companies and agents via the Factory');
  }

  const status = issues.length === 0 ? 'healthy' : issues.length < 3 ? 'degraded' : 'critical';
  await logOrchestratorAction('selfDiagnose:' + status);
  return { status, issues, recommendations };
}

export async function createApprovalRequest(
  action: string,
  details: any,
  agentId?: string,
  companyId?: string
): Promise<ApprovalRequest> {
  const request: ApprovalRequest = {
    id: 'apr:' + Date.now().toString(36),
    action, details, agentId, companyId,
    status: 'pending',
    requestedAt: Date.now(),
  };
  await redis.set('approval:' + request.id, JSON.stringify(request), { ex: 86400 * 3 });
  await redis.lpush('approval:pending', request.id);
  await logOrchestratorAction('approvalRequest:' + action + ':' + request.id);
  return request;
}

export async function resolveApprovalRequest(
  requestId: string,
  approved: boolean,
  approvedBy: string,
  reasoning?: string
): Promise<ApprovalRequest | null> {
  const raw = await redis.get<string>('approval:' + requestId);
  if (!raw) return null;
  const request: ApprovalRequest = typeof raw === 'string' ? JSON.parse(raw) : raw;
  request.status = approved ? 'approved' : 'rejected';
  request.approvedBy = approvedBy;
  request.reasoning = reasoning;
  await redis.set('approval:' + requestId, JSON.stringify(request), { ex: 86400 * 7 });
  await logOrchestratorAction('approvalResolved:' + requestId + ':' + request.status);
  return request;
}

export async function judgeAgent(
  agent: SuperAgent,
  companyType: string
): Promise<{ verdict: string; score: number; reasoning: string }> {
  const systemPrompt = 'You are an impartial AI performance judge. Evaluate the agent based on its metrics, wins, errors, and CLEAR scores. Respond in JSON only with: verdict (excellent|good|poor|critical), score (0-100), reasoning (string).';
  const userMessage = 'Agent: ' + agent.name + '\nRole: ' + agent.role +
    '\nWins: ' + agent.wins.slice(-10).join(', ') +
    '\nErrors: ' + agent.errors.slice(-10).join(', ') +
    '\nCLEAR: ' + JSON.stringify(agent.clearMetrics) +
    '\nGeneration: ' + agent.generation +
    '\nCompany type: ' + companyType;

  try {
    const result = await callLLM({ systemPrompt, userMessage, agentId: 'judge', maxTokens: 300 });
    const clean = result.response.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    const score = computeCLEARScore(agent.clearMetrics, companyType);
    return {
      verdict: score > 70 ? 'good' : score > 40 ? 'poor' : 'critical',
      score: Math.round(score),
      reasoning: 'Automated score based on CLEAR metrics',
    };
  }
}
// ============================================================
// BLOQUE 10: Generador de worker Python con 4 arquitecturas
// ============================================================

export function generatePythonWorker(
  architecture: 'consensus' | 'pipeline' | 'hierarchical' | 'competitive',
  agents: Partial<SuperAgent>[],
  companyName: string
): string {
  const agentNames = agents.map(a => a.name ?? 'Agent').join(', ');

  const headers = `#!/usr/bin/env python3
# ${companyName} - Worker Python - Architecture: ${architecture}
# Auto-generated by Empire Crew Orchestrator

import os, json, time, requests
from typing import Any

GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
BASE_URL = 'https://api.groq.com/openai/v1/chat/completions'
AGENTS = [${agents.map(a => `'${a.name ?? 'Agent'}'`).join(', ')}]

def call_groq(system_prompt: str, user_message: str, model: str = 'llama-3.3-70b-versatile') -> str:
    res = requests.post(BASE_URL, headers={
        'Authorization': f'Bearer {GROQ_API_KEY}',
        'Content-Type': 'application/json'
    }, json={
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_message}
        ],
        'max_tokens': 1000
    })
    return res.json()['choices'][0]['message']['content']
`;

  const architectures: Record<string, string> = {
    consensus: `
def run_consensus(task: str) -> dict:
    votes = []
    for agent in AGENTS:
        prompt = f'You are {agent}. Vote on this task with your best recommendation.'
        vote = call_groq(prompt, task)
        votes.append({'agent': agent, 'vote': vote})
        print(f'[{agent}] voted: {vote[:80]}')
    
    summary_prompt = 'You are a consensus resolver. Given these votes, produce the best unified decision.'
    votes_text = '\\n'.join([f"{v['agent']}: {v['vote']}" for v in votes])
    final = call_groq(summary_prompt, votes_text)
    return {'architecture': 'consensus', 'votes': votes, 'result': final}

if __name__ == '__main__':
    task = input('Task: ')
    result = run_consensus(task)
    print('\\nFinal decision:', result['result'])
`,
    pipeline: `
def run_pipeline(task: str) -> dict:
    context = task
    results = []
    for agent in AGENTS:
        prompt = f'You are {agent}. Process the following and improve it for the next agent in the pipeline.'
        context = call_groq(prompt, context)
        results.append({'agent': agent, 'output': context})
        print(f'[{agent}] processed: {context[:80]}')
    return {'architecture': 'pipeline', 'steps': results, 'result': context}

if __name__ == '__main__':
    task = input('Task: ')
    result = run_pipeline(task)
    print('\\nFinal output:', result['result'])
`,
    hierarchical: `
def run_hierarchical(task: str) -> dict:
    if not AGENTS:
        return {'error': 'No agents defined'}
    
    ceo = AGENTS[0]
    workers = AGENTS[1:]
    
    plan_prompt = f'You are {ceo}, the CEO. Break this task into {len(workers)} subtasks, one per line.'
    plan = call_groq(plan_prompt, task)
    subtasks = [s.strip() for s in plan.split('\\n') if s.strip()]
    
    results = []
    for i, worker in enumerate(workers):
        subtask = subtasks[i] if i < len(subtasks) else task
        prompt = f'You are {worker}. Complete this subtask.'
        output = call_groq(prompt, subtask)
        results.append({'agent': worker, 'subtask': subtask, 'output': output})
        print(f'[{worker}] completed subtask {i+1}')
    
    synthesis_prompt = f'You are {ceo}. Synthesize these results into a final report.'
    synthesis_input = '\\n'.join([f"{r['agent']}: {r['output']}" for r in results])
    final = call_groq(synthesis_prompt, synthesis_input)
    return {'architecture': 'hierarchical', 'plan': subtasks, 'results': results, 'result': final}

if __name__ == '__main__':
    task = input('Task: ')
    result = run_hierarchical(task)
    print('\\nFinal report:', result['result'])
`,
    competitive: `
def run_competitive(task: str) -> dict:
    responses = []
    for agent in AGENTS:
        prompt = f'You are {agent}. Provide your best solution. Compete to give the highest quality answer.'
        output = call_groq(prompt, task)
        responses.append({'agent': agent, 'output': output})
        print(f'[{agent}] submitted solution: {output[:80]}')
    
    judge_prompt = 'You are an impartial judge. Select the best solution and explain why. Respond with: WINNER: <agent_name>\\nREASON: <reason>\\nFINAL: <best solution>'
    solutions = '\\n\\n'.join([f"{r['agent']}:\\n{r['output']}" for r in responses])
    judgment = call_groq(judge_prompt, solutions)
    return {'architecture': 'competitive', 'responses': responses, 'judgment': judgment}

if __name__ == '__main__':
    task = input('Task: ')
    result = run_competitive(task)
    print('\\nJudgment:', result['judgment'])
`,
  };

  return headers + (architectures[architecture] ?? architectures.consensus);
}

export async function saveWorkerScript(
  companyId: string,
  architecture: 'consensus' | 'pipeline' | 'hierarchical' | 'competitive',
  script: string
): Promise<void> {
  await redis.set('worker:' + companyId + ':' + architecture, script, { ex: 86400 * 30 });
  await logOrchestratorAction('workerGenerated:' + companyId + ':' + architecture);
}

export async function getWorkerScript(
  companyId: string,
  architecture: string
): Promise<string | null> {
  return redis.get<string>('worker:' + companyId + ':' + architecture);
}