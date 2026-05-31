import { redis } from '@/lib/redis';
import { callLLM, logOrchestratorAction } from '@/lib/orchestrator';
import { writeProof } from '@/lib/omk';
import { storeMemory } from '@/lib/memory';

// ============================================================
// HINDSIGHT: Memoria a largo plazo estructurada
// ============================================================

export interface LongTermMemory {
  id: string;
  agentId: string;
  companyId: string;
  type: 'fact' | 'experience' | 'opinion' | 'pattern';
  content: string;
  evidence: string[];
  confidence: number;
  createdAt: number;
  lastReinforced: number;
  reinforceCount: number;
}

// Guardar memoria a largo plazo
export async function storeLongTerm(
  agentId: string,
  companyId: string,
  content: string,
  type: LongTermMemory['type'] = 'fact',
  evidence: string[] = [],
  confidence: number = 0.8
): Promise<LongTermMemory> {
  const id = 'lt:' + agentId + ':' + Date.now().toString(36);
  const memory: LongTermMemory = {
    id, agentId, companyId, type, content, evidence,
    confidence, createdAt: Date.now(),
    lastReinforced: Date.now(), reinforceCount: 0,
  };
  await redis.set(id, JSON.stringify(memory), { ex: 86400 * 365 });
  await redis.sadd('lt:index:' + agentId, id);
  await redis.sadd('lt:index:company:' + companyId, id);
  return memory;
}

// Reforzar memoria existente
export async function reinforceLongTerm(memoryId: string): Promise<void> {
  const raw = await redis.get<string>(memoryId);
  if (!raw) return;
  const memory: LongTermMemory = typeof raw === 'string' ? JSON.parse(raw) : raw;
  memory.reinforceCount += 1;
  memory.lastReinforced = Date.now();
  memory.confidence = Math.min(1, memory.confidence + 0.05);
  await redis.set(memoryId, JSON.stringify(memory), { ex: 86400 * 365 });
}

// Consolidar conversaciones en memoria a largo plazo (corre de noche)
export async function consolidateToHindsight(
  agentId: string,
  companyId: string,
  recentLogs: string[]
): Promise<{ stored: number; facts: string[] }> {
  if (recentLogs.length === 0) return { stored: 0, facts: [] };

  const logsText = recentLogs.slice(-20).join('\n');

  const result = await callLLM({
    systemPrompt: `You are a memory consolidator. Extract long-term learnings from agent logs.
Respond ONLY in JSON: {"facts":["fact1","fact2"],"experiences":["exp1"],"patterns":["pattern1"]}
Max 3 items per category. Each item max 50 words.`,
    userMessage: 'Agent: ' + agentId + '\nLogs:\n' + logsText,
    agentId: 'hindsight:consolidator',
    maxTokens: 400,
    useCache: false,
  });

  let parsed: { facts: string[]; experiences: string[]; patterns: string[] } = {
    facts: [], experiences: [], patterns: [],
  };

  try {
    const clean = result.response.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {}

  let stored = 0;
  const allFacts: string[] = [];

  for (const fact of parsed.facts ?? []) {
    await storeLongTerm(agentId, companyId, fact, 'fact', [], 0.7);
    await storeMemory(agentId, fact, 'semantic', 0.8, { source: 'hindsight' });
    allFacts.push(fact);
    stored++;
  }

  for (const exp of parsed.experiences ?? []) {
    await storeLongTerm(agentId, companyId, exp, 'experience', [], 0.6);
    stored++;
  }

  for (const pattern of parsed.patterns ?? []) {
    await storeLongTerm(agentId, companyId, pattern, 'pattern', [], 0.75);
    stored++;
  }

  await writeProof('hindsight:consolidate', { agentId, logsCount: recentLogs.length }, { stored, facts: allFacts }, 'hindsight', companyId);
  await logOrchestratorAction('hindsight:consolidated:' + agentId + ':' + stored + ' memories');

  return { stored, facts: allFacts };
}

// Recuperar memorias a largo plazo
export async function retrieveLongTerm(
  agentId: string,
  query: string,
  limit: number = 5
): Promise<LongTermMemory[]> {
  const ids = await redis.smembers('lt:index:' + agentId) as string[];
  const results: (LongTermMemory & { score: number })[] = [];
  const queryWords = query.toLowerCase().split(' ').filter(w => w.length > 3);

  for (const id of ids.slice(0, 300)) {
    const raw = await redis.get<string>(id);
    if (!raw) continue;
    try {
      const mem: LongTermMemory = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const contentLower = mem.content.toLowerCase();
      const matches = queryWords.filter(w => contentLower.includes(w)).length;
      const score = matches * mem.confidence * (1 + mem.reinforceCount * 0.1);
      if (score > 0) results.push({ ...mem, score });
    } catch {}
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Generar worker Python para consolidación nocturna
export function generateHindsightWorker(companyId: string): string {
  return `#!/usr/bin/env python3
# Hindsight Worker - Consolidacion nocturna para ${companyId}
# Ejecutar con: python hindsight_worker.py
# Cron: 0 2 * * * python hindsight_worker.py

import requests
import json
from datetime import datetime

API_BASE = 'http://localhost:3000'

def consolidate_company(company_id: str):
    print(f'[{datetime.now()}] Consolidando {company_id}...')
    res = requests.post(f'{API_BASE}/api/memory', json={
        'action': 'consolidate',
        'agentId': company_id,
    })
    if res.ok:
        print(f'Consolidacion exitosa: {res.json()}')
    else:
        print(f'Error: {res.text}')

if __name__ == '__main__':
    consolidate_company('${companyId}')
    print('Hindsight worker completado.')
`;
}