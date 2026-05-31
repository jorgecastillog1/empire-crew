import { redis } from './redis';
import { storeEmbedding, searchSimilar } from './embeddings';

export interface MemoryEntry {
  id: string;
  agentId: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  content: string;
  importance: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
  ttl: number;
  metadata: any;
}

const BASE_TTL = 7 * 24 * 60 * 60;
const MAX_TTL = 90 * 24 * 60 * 60;
const MIN_TTL = 60 * 60;
const IMPORTANCE_MULTIPLIER = 2.5;
const ACCESS_BONUS = 0.3;

function calculateTTL(importance: number, accessCount: number, ageSeconds: number): number {
  const importanceBonus = importance * IMPORTANCE_MULTIPLIER;
  const accessBonus = Math.log1p(accessCount) * ACCESS_BONUS;
  const decayFactor = Math.exp(-ageSeconds / (BASE_TTL * 2));
  const ttl = BASE_TTL * (1 + importanceBonus + accessBonus) * decayFactor;
  return Math.max(MIN_TTL, Math.min(MAX_TTL, Math.round(ttl)));
}

export async function storeMemory(
  agentId: string,
  content: string,
  type: MemoryEntry['type'] = 'episodic',
  importance: number = 0.5,
  metadata: any = {}
): Promise<string> {
  const id = `${agentId}:${type}:${Date.now()}`;
  const ttl = calculateTTL(importance, 0, 0);
  const entry: MemoryEntry = {
    id, agentId, type, content, importance,
    accessCount: 0,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    ttl,
    metadata,
  };
  await redis.set(`empire:memory:${id}`, JSON.stringify(entry), { ex: ttl });
  await redis.sadd(`empire:memory:agent:${agentId}`, id);
  await storeEmbedding(`memory:${id}`, content, { agentId, type, importance });
  return id;
}

export async function recallMemory(memoryId: string): Promise<MemoryEntry | null> {
  const raw = await redis.get(`empire:memory:${memoryId}`);
  if (!raw) return null;
  const entry: MemoryEntry = typeof raw === 'string' ? JSON.parse(raw) : raw;
  entry.accessCount += 1;
  entry.lastAccessedAt = Date.now();
  const ageSeconds = (Date.now() - entry.createdAt) / 1000;
  entry.ttl = calculateTTL(entry.importance, entry.accessCount, ageSeconds);
  await redis.set(`empire:memory:${memoryId}`, JSON.stringify(entry), { ex: entry.ttl });
  return entry;
}

export async function searchMemories(agentId: string, query: string, topK: number = 5): Promise<MemoryEntry[]> {
  const similar = await searchSimilar(query, topK * 2);
  const agentMemories = similar.filter(r => r.key.startsWith(`memory:${agentId}`));
  const entries: MemoryEntry[] = [];
  for (const match of agentMemories.slice(0, topK)) {
    const memId = match.key.replace('memory:', '');
    const entry = await recallMemory(memId);
    if (entry) entries.push(entry);
  }
  return entries;
}

export async function consolidateMemories(agentId: string): Promise<void> {
  const memoryIds = await redis.smembers(`empire:memory:agent:${agentId}`) as string[];
  const expired: string[] = [];
  const active: MemoryEntry[] = [];

  for (const id of memoryIds) {
    const raw = await redis.get(`empire:memory:${id}`);
    if (!raw) {
      expired.push(id);
      continue;
    }
    const entry: MemoryEntry = typeof raw === 'string' ? JSON.parse(raw) : raw;
    active.push(entry);
  }

  if (expired.length > 0) {
    await redis.srem(`empire:memory:agent:${agentId}`, ...expired);
  }

  const episodic = active.filter(e => e.type === 'episodic');
  if (episodic.length > 50) {
    const sorted = episodic.sort((a, b) => a.importance - b.importance);
    const toForget = sorted.slice(0, episodic.length - 50);
    for (const entry of toForget) {
      await redis.del(`empire:memory:${entry.id}`);
      await redis.srem(`empire:memory:agent:${agentId}`, entry.id);
    }
  }
}

export async function getWorkingMemory(agentId: string): Promise<string> {
  const raw = await redis.get(`empire:memory:working:${agentId}`);
  return raw ? String(raw) : '';
}

export async function setWorkingMemory(agentId: string, content: string): Promise<void> {
  await redis.set(`empire:memory:working:${agentId}`, content, { ex: 3600 });
}

export async function clearWorkingMemory(agentId: string): Promise<void> {
  await redis.del(`empire:memory:working:${agentId}`);
}

export async function getMemoryStats(agentId: string): Promise<{
  total: number;
  byType: Record<string, number>;
  avgImportance: number;
  oldestMemory: number;
}> {
  const memoryIds = await redis.smembers(`empire:memory:agent:${agentId}`) as string[];
  const byType: Record<string, number> = { episodic: 0, semantic: 0, procedural: 0, working: 0 };
  let totalImportance = 0;
  let oldest = Date.now();

  for (const id of memoryIds) {
    const raw = await redis.get(`empire:memory:${id}`);
    if (!raw) continue;
    const entry: MemoryEntry = typeof raw === 'string' ? JSON.parse(raw) : raw;
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    totalImportance += entry.importance;
    if (entry.createdAt < oldest) oldest = entry.createdAt;
  }

  return {
    total: memoryIds.length,
    byType,
    avgImportance: memoryIds.length > 0 ? totalImportance / memoryIds.length : 0,
    oldestMemory: oldest,
  };
}
// ============================================================
// CURVAS DE OLVIDO: TTL exponencial basado en frecuencia de acceso
// ============================================================

export function calculateExponentialTTL(
  importance: number,
  accessCount: number,
  daysSinceCreation: number
): number {
  // Base TTL según importancia (1-30 días)
  const baseTTL = Math.ceil(importance * 30) * 86400;
  
  // Factor de refuerzo: cada acceso duplica el TTL parcialmente
  const reinforcementFactor = Math.pow(1.5, Math.min(accessCount, 10));
  
  // Factor de decaimiento: sin accesos, TTL se reduce exponencialmente
  const decayFactor = Math.exp(-0.1 * Math.max(0, daysSinceCreation - 3));
  
  // TTL final entre 1 hora y 90 días
  const finalTTL = Math.floor(baseTTL * reinforcementFactor * decayFactor);
  return Math.max(3600, Math.min(finalTTL, 90 * 86400));
}

export async function refreshMemoryTTL(memoryId: string): Promise<void> {
  const raw = await redis.get<string>(memoryId);
  if (!raw) return;
  try {
    const item: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const daysSince = (Date.now() - item.createdAt) / 86400000;
    const newTTL = calculateExponentialTTL(item.importance, item.accessCount, daysSince);
    item.ttl = newTTL;
    item.lastAccessedAt = Date.now();
    await redis.set(memoryId, JSON.stringify(item), { ex: newTTL });
  } catch {}
}

export async function runForgettingCurve(agentId: string): Promise<{
  refreshed: number; forgotten: number; kept: number;
}> {
  const ids = await redis.smembers('empire:memory:agent:' + agentId) as string[];
  let refreshed = 0, forgotten = 0, kept = 0;

  for (const id of ids) {
    const raw = await redis.get<string>(id);
    if (!raw) {
      await redis.srem('empire:memory:agent:' + agentId, id);
      forgotten++;
      continue;
    }
    try {
      const item: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const daysSince = (Date.now() - item.createdAt) / 86400000;
      const newTTL = calculateExponentialTTL(item.importance, item.accessCount, daysSince);

      // Si el TTL nuevo es menor que 2 horas y no se ha accedido en 7 días, olvidar
      if (newTTL <= 7200 && daysSince > 7 && item.accessCount === 0) {
        await redis.del(id);
        await redis.srem('empire:memory:agent:' + agentId, id);
        forgotten++;
      } else {
        await redis.set(id, JSON.stringify({ ...item, ttl: newTTL }), { ex: newTTL });
        refreshed++;
      }
    } catch {
      kept++;
    }
  }

  return { refreshed, forgotten, kept };
}