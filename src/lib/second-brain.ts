import { redis } from './redis';
import { callLLM, routeTaskToAgent, listAgents } from './orchestrator';
import { executeTool } from './thoth';
import { logOrchestratorAction } from './orchestrator';

// ============================================================
// SECOND BRAIN: Indexación semántica + búsqueda + memoria local
// ============================================================

export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  tags: string[];
  createdAt: number;
  accessCount: number;
  lastAccessedAt: number;
  ttl: number;
}

// Guardar entrada en memoria con TTL dinámico
export async function rememberFact(
  content: string,
  tags: string[] = [],
  baseTtlDays = 7
): Promise<MemoryEntry> {
  const id = 'mem:' + Date.now().toString(36);
  const entry: MemoryEntry = {
    id,
    content,
    tags,
    createdAt: Date.now(),
    accessCount: 0,
    lastAccessedAt: Date.now(),
    ttl: baseTtlDays * 86400,
  };
  await redis.set(id, JSON.stringify(entry), { ex: entry.ttl });
  await redis.sadd('memory:index', id);
  await logOrchestratorAction('secondBrain:remember:' + id);
  return entry;
}

// Recuperar y reforzar memoria (aumenta TTL al acceder)
export async function recallFact(id: string): Promise<MemoryEntry | null> {
  const raw = await redis.get<string>(id);
  if (!raw) return null;
  const entry: MemoryEntry = typeof raw === 'string' ? JSON.parse(raw) : raw;
  entry.accessCount += 1;
  entry.lastAccessedAt = Date.now();
  // Refuerzo: cada acceso suma 1 día al TTL
  entry.ttl = Math.min(entry.ttl + 86400, 90 * 86400);
  await redis.set(id, JSON.stringify(entry), { ex: entry.ttl });
  return entry;
}

// Búsqueda semántica simple por tags y palabras clave
export async function searchMemory(query: string, limit = 5): Promise<MemoryEntry[]> {
  const ids = await redis.smembers('memory:index') as string[];
  const results: MemoryEntry[] = [];
  const queryWords = query.toLowerCase().split(' ').filter(w => w.length > 3);

  for (const id of ids.slice(0, 200)) {
    const raw = await redis.get<string>(id);
    if (!raw) continue;
    try {
      const entry: MemoryEntry = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const contentLower = entry.content.toLowerCase();
      const tagMatch = entry.tags.some(t => query.toLowerCase().includes(t.toLowerCase()));
      const wordMatch = queryWords.filter(w => contentLower.includes(w)).length;
      if (tagMatch || wordMatch > 0) {
        results.push({ ...entry, accessCount: wordMatch + (tagMatch ? 2 : 0) });
      }
    } catch {}
  }

  return results
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, limit);
}

// Consolidar conversación en memoria a largo plazo
export async function consolidateToLongTerm(
  conversation: string,
  companyId: string
): Promise<void> {
  const systemPrompt = 'Extract the key facts, decisions, and learnings from this conversation. Return as a JSON array of strings, each being one important fact.';
  const result = await callLLM({
    systemPrompt,
    userMessage: conversation,
    agentId: 'consolidator',
    maxTokens: 500,
  });

  try {
    const clean = result.response.replace(/```json|```/g, '').trim();
    const facts: string[] = JSON.parse(clean);
    for (const fact of facts) {
      await rememberFact(fact, [companyId, 'long-term'], 30);
    }
    await logOrchestratorAction('secondBrain:consolidate:' + companyId + ':' + facts.length + ' facts');
  } catch {}
}

// Query al Second Brain: busca en memoria + llama LLM con contexto
export async function querySecondBrain(
  question: string,
  companyId: string
): Promise<string> {
  const memories = await searchMemory(question);
  const memoryContext = memories.length > 0
    ? 'Relevant memory:\n' + memories.map(m => '- ' + m.content).join('\n')
    : 'No relevant memory found.';

  // Reforzar memorias accedidas
  for (const m of memories) await recallFact(m.id);

  const agents = await listAgents(companyId);
  const webResult = await executeTool('web_search', { query: question });
  const webContext = webResult.success
    ? 'Web search results:\n' + (webResult.output as any[]).slice(0, 2).map((r: any) => r.title + ': ' + r.content).join('\n')
    : '';

  const systemPrompt = 'You are the Second Brain of Empire Crew. Answer using the memory context and web search provided. Be specific and actionable.';
  const userMessage = question + '\n\n' + memoryContext + '\n\n' + webContext;

  const result = await callLLM({
    systemPrompt,
    userMessage,
    agentId: 'second-brain:' + companyId,
    maxTokens: 800,
  });

  // Guardar esta interacción en memoria
  await rememberFact('Q: ' + question + '\nA: ' + result.response.slice(0, 200), [companyId], 7);

  return result.response;
}