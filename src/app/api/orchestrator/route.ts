import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeEcosystem,
  createCompanyFromDescription,
  selfDiagnose,
  getOrchestratorLog,
  judgeAgent,
  reincarnateAgent,
  logOrchestratorAction,
} from '@/lib/orchestrator';

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
      if (!description) return NextResponse.json({ error: 'Descripci�n requerida' }, { status: 400 });
      return NextResponse.json(await createCompanyFromDescription(description));
    }
    if (action === 'judge_agent') {
      if (!agentId) return NextResponse.json({ error: 'agentId requerido' }, { status: 400 });
      return NextResponse.json(await judgeAgent(agentId, companyId ?? 'default'));
    }
    if (action === 'reincarnate_agent') {
      if (!agentId || !companyId) return NextResponse.json({ error: 'agentId y companyId requeridos' }, { status: 400 });
      return NextResponse.json(await reincarnateAgent(agentId, companyId), { status: 201 });
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
