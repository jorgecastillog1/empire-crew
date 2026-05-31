import { redis } from './redis';

// ============================================================
// OMK: Trazabilidad extendida con proof.json
// ============================================================

export interface ProofRecord {
  id: string;
  action: string;
  agentId?: string;
  companyId?: string;
  input: any;
  output: any;
  verified: boolean;
  checksum: string;
  timestamp: number;
  durationMs: number;
}

function simpleChecksum(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = (hash << 5) - hash + data.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export async function writeProof(
  action: string,
  input: any,
  output: any,
  agentId?: string,
  companyId?: string,
  durationMs = 0
): Promise<ProofRecord> {
  const id = 'proof:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 6);
  const raw = JSON.stringify({ action, input, output });
  const checksum = simpleChecksum(raw);

  const proof: ProofRecord = {
    id,
    action,
    agentId,
    companyId,
    input,
    output,
    verified: true,
    checksum,
    timestamp: Date.now(),
    durationMs,
  };

  await redis.set(id, JSON.stringify(proof), { ex: 86400 * 30 });
  await redis.lpush('omk:proofs', id);
  await redis.ltrim('omk:proofs', 0, 499);

  if (companyId) {
    await redis.lpush('omk:proofs:' + companyId, id);
    await redis.ltrim('omk:proofs:' + companyId, 0, 99);
  }

  return proof;
}

export async function getProof(proofId: string): Promise<ProofRecord | null> {
  const raw = await redis.get<string>(proofId);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

export async function getRecentProofs(companyId?: string, limit = 20): Promise<ProofRecord[]> {
  const key = companyId ? 'omk:proofs:' + companyId : 'omk:proofs';
  const ids = await redis.lrange(key, 0, limit - 1) as string[];
  const proofs: ProofRecord[] = [];
  for (const id of ids) {
    const proof = await getProof(id);
    if (proof) proofs.push(proof);
  }
  return proofs;
}

export async function verifyProof(proofId: string): Promise<boolean> {
  const proof = await getProof(proofId);
  if (!proof) return false;
  const raw = JSON.stringify({ action: proof.action, input: proof.input, output: proof.output });
  const checksum = simpleChecksum(raw);
  return checksum === proof.checksum;
}

export async function getProofSummary(): Promise<{
  total: number; verified: number; failed: number;
}> {
  const ids = await redis.lrange('omk:proofs', 0, 99) as string[];
  let verified = 0;
  let failed = 0;
  for (const id of ids) {
    const ok = await verifyProof(id);
    ok ? verified++ : failed++;
  }
  return { total: ids.length, verified, failed };
}