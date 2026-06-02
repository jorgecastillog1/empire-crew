import { redis } from './redis';

// Lee clave Jina desde empire:settings:services (guardada desde Settings UI)
async function getJinaKey(): Promise<string> {
  try {
    const raw = await redis.get<string>('empire:settings:services');
    const services: { label: string; apiKey: string }[] = raw
      ? (typeof raw === 'string' ? JSON.parse(raw) : raw)
      : [];
    const svc = services.find(
      s => s.label.toLowerCase() === 'jina' && s.apiKey
    );
    if (svc?.apiKey) return svc.apiKey;
  } catch {}
  return process.env.JINA_API_KEY ?? '';
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = await getJinaKey();

  if (!apiKey) {
    console.warn('[embeddings] No Jina API key configured. Returning empty embedding.');
    return [];
  }

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v2-base-es',
      input: [text],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jina embeddings error: ${err}`);
  }

  const data = await response.json();
  return data.data?.[0]?.embedding ?? [];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function storeEmbedding(
  key: string,
  text: string,
  metadata: any = {}
): Promise<void> {
  const embedding = await generateEmbedding(text);
  await redis.set(`empire:embedding:${key}`, JSON.stringify({
    text,
    embedding,
    metadata,
    createdAt: Date.now(),
  }));
  await redis.sadd('empire:embedding:keys', key);
}

export async function searchSimilar(
  query: string,
  topK: number = 5
): Promise<{ key: string; text: string; score: number; metadata: any }[]> {
  const queryEmbedding = await generateEmbedding(query);

  if (!queryEmbedding.length) return [];

  const keys = await redis.smembers('empire:embedding:keys') as string[];
  const results: { key: string; text: string; score: number; metadata: any }[] = [];

  for (const key of keys) {
    const raw = await redis.get(`empire:embedding:${key}`);
    if (!raw) continue;
    const stored = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!stored.embedding?.length) continue;
    const score = cosineSimilarity(queryEmbedding, stored.embedding);
    results.push({ key, text: stored.text, score, metadata: stored.metadata ?? {} });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

export async function storeAgentMemory(
  agentId: string,
  event: string,
  outcome: string
): Promise<void> {
  const key = `agent:${agentId}:memory:${Date.now()}`;
  await storeEmbedding(key, `${event} → ${outcome}`, {
    agentId, event, outcome, type: 'episodic',
  });
}

export async function searchAgentMemory(
  agentId: string,
  query: string,
  topK: number = 3
): Promise<any[]> {
  const results = await searchSimilar(query, topK * 3);
  return results
    .filter(r => r.metadata?.agentId === agentId)
    .slice(0, topK);
}

export async function storeMarketKnowledge(
  topic: string,
  content: string,
  companyType: string
): Promise<void> {
  const key = `market:${companyType}:${topic
    .replace(/\s+/g, '-')
    .toLowerCase()}:${Date.now()}`;
  await storeEmbedding(key, content, { topic, companyType, type: 'market' });
}

export async function searchMarketKnowledge(
  query: string,
  companyType: string,
  topK: number = 5
): Promise<any[]> {
  const results = await searchSimilar(query, topK * 3);
  return results
    .filter(r => r.metadata?.companyType === companyType)
    .slice(0, topK);
}

export async function deleteEmbedding(key: string): Promise<void> {
  await redis.del(`empire:embedding:${key}`);
  await redis.srem('empire:embedding:keys', key);
}

export async function listEmbeddings(): Promise<string[]> {
  return await redis.smembers('empire:embedding:keys') as string[];
}