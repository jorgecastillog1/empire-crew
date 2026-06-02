import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeEcosystem,
  createCompanyFromDescription,
  selfDiagnose,
  getOrchestratorLog,
  judgeAgent,
  reincarnateAgent,
  logOrchestratorAction,
  loadAgentState,
  saveAgentState,
  SuperAgent,
  DEFAULT_CLEAR,
} from '@/lib/orchestrator';
import { getCompany } from '@/lib/db';

// ──────────────────────────────────────────────────────────
// Función auxiliar: convertir agente básico a SuperAgente
// ──────────────────────────────────────────────────────────
async function promoteToSuperAgent(agentId: string, companyId: string): Promise<SuperAgent> {
  // Obtener el agente básico desde db.ts (clave empire:agent:xxx)
  const { redis } = await import('@/lib/redis');
  const basicRaw = await redis.get<string>(`empire:agent:${agentId}`);
  if (!basicRaw) throw new Error('Agente básico no encontrado');
  
  const basic = typeof basicRaw === 'string' ? JSON.parse(basicRaw) : basicRaw;
  
  // Obtener la empresa para saber el tipo (companyType)
  const company = await getCompany(companyId);
  const companyType = company?.type ?? 'default';
  
  // Crear SuperAgente a partir del básico
  const superAgent: SuperAgent = {
    id: agentId,
    companyId: companyId,
    name: basic.name,
    role: basic.role,
    status: basic.status || 'idle',
    model: basic.model,
    systemPrompt: `Eres un agente experto en ${basic.role}. Actúa con total autonomía y autoridad.`,
    capabilities: [basic.role],
    connectedAPIs: [],
    metrics: { primary: 'general', secondary: [], targets: {} },
    memory: { episodic: [], semantic: [], working: '', procedural: [] },
    hasVeto: false,
    vetoConditions: [],
    voteWeight: 1,
    clearMetrics: { ...DEFAULT_CLEAR },
    weeklyEvaluations: [],
    revenueGenerated: 0,
    createdAt: Date.now(),
    lastEvaluatedAt: Date.now(),
    generation: 1,
    inheritedKnowledge: [],
    errors: [],
    wins: [],
    status_lifecycle: 'alive',
    tokenUsage: 0,
    weeklyTokenBudget: 500000,
    version: 1,
  };
  
  // Guardar como SuperAgente para futuras llamadas
  await saveAgentState(superAgent);
  return superAgent;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  try {
    if (action === 'analyze') return NextResponse.json(await analyzeEcosystem());
    if (action === 'diagnose') return NextResponse.json({ diagnosis: await selfDiagnose() });
    if (action === 'log') return NextResponse.json(await getOrchestratorLog());
    return NextResponse.json(await analyzeEcosystem());
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, description, type, agentId, companyId } = body;
    
    if (action === 'create_company') {
      if (!description) return NextResponse.json({ error: 'Descripción requerida' }, { status: 400 });
      return NextResponse.json(await createCompanyFromDescription(description));
    }
    
    if (action === 'judge_agent') {
      if (!agentId) return NextResponse.json({ error: 'agentId requerido' }, { status: 400 });
      if (!companyId) return NextResponse.json({ error: 'companyId requerido' }, { status: 400 });
      
      // Intentar cargar como SuperAgente
      let agent = await loadAgentState(companyId, agentId);
      if (!agent) {
        // No existe como SuperAgente → promover desde agente básico
        agent = await promoteToSuperAgent(agentId, companyId);
      }
      
      // Obtener tipo de empresa
      const company = await getCompany(companyId);
      const companyType = company?.type ?? 'default';
      
      const result = await judgeAgent(agent, companyType);
      return NextResponse.json(result);
    }
    
    if (action === 'reincarnate_agent') {
      if (!agentId) return NextResponse.json({ error: 'agentId requerido' }, { status: 400 });
      if (!companyId) return NextResponse.json({ error: 'companyId requerido' }, { status: 400 });
      
      // Intentar cargar como SuperAgente (debe existir, pero si no, promover)
      let deadAgent = await loadAgentState(companyId, agentId);
      if (!deadAgent) {
        deadAgent = await promoteToSuperAgent(agentId, companyId);
      }
      
      const company = await getCompany(companyId);
      const companyType = company?.type ?? 'default';
      
      const newAgent = await reincarnateAgent(deadAgent, companyType);
      return NextResponse.json(newAgent, { status: 201 });
    }
    
    if (action === 'copilot') {
      const { companyId, companyType, message, context } = body;
      if (!message) return NextResponse.json({ error: 'message requerido' }, { status: 400 });
      const { callLLM } = await import('@/lib/orchestrator');
      const result = await callLLM({
        companyId: companyId ?? 'default',
        agentId: 'copilot',
        systemPrompt: `Eres el Copiloto IA de Empire Crew, experto en ${companyType ?? 'negocios'}. Contexto: ${context ?? ''}. Responde de forma concisa, práctica y accionable.`,
        userMessage: message,
        temperature: 0.7,
      });
      return NextResponse.json({ response: result.response });
    }
    
    return NextResponse.json({ error: 'Accion no reconocida' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}