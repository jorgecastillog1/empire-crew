import { NextRequest, NextResponse } from 'next/server';
import {
  listAgents, saveConsensusSession, getConsensusSession,
  hashPrompt, getCachedResponse, setCachedResponse,
  computeCLEARScore
} from '@/lib/orchestrator';
import { callLLM } from '@/lib/orchestrator';
import { executeTool } from '@/lib/thoth';
import { writeProof } from '@/lib/omk';
import { redis } from '@/lib/redis';

// ============================================================
// CAPA 1: Compresión del task
// ============================================================
async function compressTask(task: string, companyId: string): Promise<string> {
  if (task.split(' ').length <= 50) return task;
  const result = await callLLM({
    systemPrompt: 'Extract the 5 most critical decision points from this text. Return ONLY a numbered list, max 200 words total. No preamble.',
    userMessage: task,
    agentId: 'compressor:' + companyId,
    maxTokens: 200,
    useCache: true,
  });
  return result.response;
}

// ============================================================
// CAPA 2: Budget de tokens por arquitectura + peso del agente
// ============================================================
const ARCHITECTURE_BUDGETS: Record<string, { total: number; perAgent: number; result: number }> = {
  consensus:    { total: 400, perAgent: 40,  result: 80  },
  pipeline:     { total: 500, perAgent: 60,  result: 100 },
  hierarchical: { total: 450, perAgent: 50,  result: 100 },
  competitive:  { total: 500, perAgent: 60,  result: 100 },
};

function getAgentTokenBudget(agent: any, budget: number): number {
  const weight = agent.voteWeight ?? 1;
  return Math.min(Math.floor(budget * (weight / 3)), budget * 2);
}

// ============================================================
// VETO: Solo agentes con hasVeto:true y voteWeight>=2
// ============================================================
async function evaluateVetoes(
  task: string,
  agents: any[],
  companyId: string
): Promise<{ vetoed: boolean; agentId: string; reason: string } | null> {
  const vetoAgents = agents.filter(a => a.hasVeto && (a.voteWeight ?? 1) >= 2 && a.vetoConditions?.length > 0);
  if (vetoAgents.length === 0) return null;

  // Keyword check primero (0 tokens)
  for (const agent of vetoAgents) {
    for (const condition of agent.vetoConditions) {
      if (task.toLowerCase().includes(condition.toLowerCase())) {
        // Micro-call para validar el veto (max 100 tokens)
        const validation = await callLLM({
          systemPrompt: 'You are ' + agent.name + '. Decide if this task truly violates your veto condition: "' + condition + '". Answer ONLY: VETO_VALID or VETO_INVALID and one sentence reason.',
          userMessage: task.slice(0, 300),
          agentId: 'veto:' + agent.id,
          maxTokens: 80,
          useCache: true,
        });
        if (validation.response.includes('VETO_VALID')) {
          return {
            vetoed: true,
            agentId: agent.id,
            reason: agent.name + ': ' + validation.response.replace('VETO_VALID', '').trim(),
          };
        }
      }
    }
  }
  return null;
}

// ============================================================
// DESEMPATE: El orquestador elige al mejor agente según CLEAR
// ============================================================
function selectTiebreaker(agents: any[], companyType: string): any {
  if (agents.length === 0) return null;
  return agents.reduce((best, agent) => {
    const scoreA = computeCLEARScore(agent.clearMetrics ?? {
      cost: 50, latency: 50, efficiency: 50, assurance: 50, reliability: 50,
      costNormalizedAccuracy: 50, policyAdherenceScore: 50, slaComplianceRate: 50,
    }, companyType);
    const scoreB = computeCLEARScore(best.clearMetrics ?? {
      cost: 50, latency: 50, efficiency: 50, assurance: 50, reliability: 50,
      costNormalizedAccuracy: 50, policyAdherenceScore: 50, slaComplianceRate: 50,
    }, companyType);
    return scoreA > scoreB ? agent : best;
  });
}

// ============================================================
// CAPA 2: Un solo LLM call por arquitectura con budget estricto
// ============================================================
async function runOptimizedConsensus(
  compressedTask: string,
  agents: any[],
  architecture: string,
  companyId: string,
  companyType: string
): Promise<{ result: string; votes: any[]; reasoning: string; usedTiebreaker: boolean }> {

  const budget = ARCHITECTURE_BUDGETS[architecture] ?? ARCHITECTURE_BUDGETS.consensus;

  const agentProfiles = agents.map((a, i) => {
    const tokenBudget = getAgentTokenBudget(a, budget.perAgent);
    return i + '. ' + a.name + ' [' + a.role + ', weight:' + (a.voteWeight ?? 1) + ', max_words:' + tokenBudget + ']';
  }).join('\n');

  const prompts: Record<string, { system: string; user: string }> = {
    consensus: {
      system: `Multi-agent consensus simulator. Each agent votes based on their role and weight.
STRICT: each vote max words as specified in profile. Result max ${budget.result / 4} words.
Respond ONLY in JSON: {"votes":[{"agentId":"0","vote":"...","weight":1},...], "result":"...", "reasoning":"...", "tiebreak":false}
If votes are split evenly, set tiebreak:true and let the highest-weight agent decide.`,
      user: 'Task: ' + compressedTask + '\n\nAgents:\n' + agentProfiles,
    },
    pipeline: {
      system: `Pipeline simulator. Each agent processes sequentially, building on previous output.
STRICT: each stage max words as specified. Final result max ${budget.result / 4} words.
Respond ONLY in JSON: {"votes":[{"agentId":"0","vote":"stage output","weight":1},...], "result":"final output", "reasoning":"pipeline summary", "tiebreak":false}`,
      user: 'Task: ' + compressedTask + '\n\nPipeline order:\n' + agentProfiles,
    },
    hierarchical: {
      system: `Hierarchical simulator. Agent 0 is CEO (plans), others execute subtasks.
CEO max ${budget.perAgent * 2} words, workers max words as specified. Result max ${budget.result / 4} words.
Respond ONLY in JSON: {"votes":[{"agentId":"0","vote":"CEO plan","weight":2},{"agentId":"1","vote":"execution","weight":1},...], "result":"synthesized decision", "reasoning":"...", "tiebreak":false}`,
      user: 'Task: ' + compressedTask + '\n\nHierarchy:\n' + agentProfiles,
    },
    competitive: {
      system: `Competitive simulator with integrated judge. Each agent proposes best solution, judge picks winner.
Each solution max words as specified. Judge verdict max ${budget.result / 4} words.
Respond ONLY in JSON: {"votes":[{"agentId":"0","vote":"solution","weight":1},...], "result":"WINNER: [name] - [solution]", "reasoning":"why this wins", "tiebreak":false}`,
      user: 'Task: ' + compressedTask + '\n\nCompetitors:\n' + agentProfiles,
    },
  };

  const p = prompts[architecture] ?? prompts.consensus;
  const result = await callLLM({
    systemPrompt: p.system,
    userMessage: p.user,
    agentId: 'consensus:' + architecture + ':' + companyId,
    maxTokens: budget.total,
    useCache: false,
  });

  let parsed: any = {};
  try {
    const clean = result.response.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    parsed = { votes: [], result: result.response.slice(0, 200), reasoning: 'Raw response', tiebreak: false };
  }

  // Si hay desempate, el orquestador elige
  let usedTiebreaker = false;
  if (parsed.tiebreak) {
    const tiebreaker = selectTiebreaker(agents, companyType);
    if (tiebreaker) {
      const tbVote = parsed.votes?.find((v: any) => v.agentId === String(agents.indexOf(tiebreaker)));
      if (tbVote) {
        parsed.result = '[Tiebreaker: ' + tiebreaker.name + '] ' + tbVote.vote;
        usedTiebreaker = true;
      }
    }
  }

  return {
    result: parsed.result ?? '',
    votes: parsed.votes ?? [],
    reasoning: parsed.reasoning ?? '',
    usedTiebreaker,
  };
}

// ============================================================
// CAPA 3: Compresión del resultado para cache
// ============================================================
function compressResultForCache(session: any): string {
  const compressed = {
    id: session.id,
    result: session.result,
    reasoning: session.reasoning.slice(0, 100),
    votes: session.votes.map((v: any) => ({
      agentId: v.agentId,
      vote: v.vote.slice(0, 60),
      weight: v.weight,
    })),
    status: session.status,
    usedTiebreaker: session.usedTiebreaker,
    architecture: session.architecture,
    timestamp: session.timestamp,
  };
  return JSON.stringify(compressed);
}

// ============================================================
// RATE LIMIT: 1 consenso por empresa cada 60 segundos
// ============================================================
async function checkConsensusRateLimit(companyId: string): Promise<boolean> {
  const key = 'consensus:rl:' + companyId;
  const exists = await redis.get(key);
  if (exists) return false;
  await redis.set(key, '1', { ex: 60 });
  return true;
}

// ============================================================
// ROUTE HANDLERS
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const { companyId, task, architecture = 'consensus', companyType = 'marketing' } = await request.json();
    if (!companyId || !task) {
      return NextResponse.json({ error: 'companyId and task required' }, { status: 400 });
    }

    // Rate limit
    const allowed = await checkConsensusRateLimit(companyId);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit: 1 consensus per 60s per company. Try again shortly.' }, { status: 429 });
    }

    // Cache check (hash del task original)
    const cacheHash = hashPrompt(architecture, task, companyId);
    const cached = await getCachedResponse(cacheHash);
    if (cached) {
      return NextResponse.json({ ...JSON.parse(cached), fromCache: true });
    }

    const agents = await listAgents(companyId);
    if (agents.length === 0) {
      return NextResponse.json({ error: 'No agents found for company' }, { status: 404 });
    }

    const sessionId = 'cs:' + Date.now().toString(36);

    // Veto check (micro-call máx 80 tokens si hay keyword match)
    const veto = await evaluateVetoes(task, agents, companyId);
    if (veto) {
      const session = {
        id: sessionId, companyId,
        architecture: architecture as any,
        trigger: task, context: { task },
        votes: [], vetoes: [{ agentId: veto.agentId, reason: veto.reason }],
        conflicts: [], status: 'vetoed' as const,
        result: 'Vetoed: ' + veto.reason,
        reasoning: veto.reason,
        timestamp: Date.now(), cost: 0.0001, latency: 0, priority: 1,
        usedTiebreaker: false,
      };
      await saveConsensusSession(session);
      await executeTool('telegram_notify', {
        message: 'VETO aplicado en ' + companyId + '\nAgente: ' + veto.agentId + '\nRazón: ' + veto.reason,
      });
      return NextResponse.json(session);
    }

    // Capa 1: Comprimir task
    const start = Date.now();
    const compressedTask = await compressTask(task, companyId);

    // Capa 2: Un solo LLM call
    const { result, votes, reasoning, usedTiebreaker } = await runOptimizedConsensus(
      compressedTask, agents, architecture, companyId, companyType
    );
    const latency = Date.now() - start;

    const session = {
      id: sessionId, companyId,
      architecture: architecture as any,
      trigger: task, context: { task, compressedTask },
      votes, vetoes: [], conflicts: [],
      status: 'approved' as const,
      result, reasoning,
      timestamp: Date.now(),
      cost: task.split(' ').length > 50 ? 0.002 : 0.001,
      latency, priority: 1,
      usedTiebreaker,
    };

    await saveConsensusSession(session);

    // Capa 3: Cache comprimido
    await setCachedResponse(cacheHash, compressResultForCache(session));

    await writeProof('consensus:' + architecture, { task: compressedTask, companyId }, { result, votes: votes.length, usedTiebreaker }, 'consensus', companyId);

    await executeTool('telegram_notify', {
      message: 'Consenso [' + architecture + '] ' + companyId + '\n' +
        (usedTiebreaker ? 'Desempate aplicado\n' : '') +
        'Resultado: ' + result.slice(0, 100) + '\n' +
        'Votos: ' + votes.length + ' · ' + latency + 'ms · ' +
        (task.split(' ').length > 50 ? 'Task comprimido' : 'Task directo'),
    });

    return NextResponse.json(session);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  const session = await getConsensusSession(sessionId);
  return NextResponse.json(session ?? { error: 'Session not found' });
}