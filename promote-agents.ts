import { redis } from './src/lib/redis.js';
import { saveAgentState, DEFAULT_CLEAR } from './src/lib/orchestrator.js';

const companyId = 'marketing-pro';

async function promoteAgents() {
  console.log('🚀 Promoviendo agentes...');
  
  const companyRaw = await redis.get(`empire:company:${companyId}`);
  if (!companyRaw) {
    console.error('❌ Empresa no encontrada');
    return;
  }
  
  const company = typeof companyRaw === 'string' ? JSON.parse(companyRaw) : companyRaw;
  console.log(`📋 ${company.agents.length} agentes encontrados`);
  
  for (const agent of company.agents) {
    const superAgent = {
      id: agent.name,
      companyId: companyId,
      name: agent.name,
      role: agent.role,
      status: "idle" as const,
      model: agent.model,
      systemPrompt: `Eres experto en ${agent.role}.`,
      capabilities: [agent.role],
      connectedAPIs: [],
      metrics: { primary: "general", secondary: [], targets: {} },
      memory: { episodic: [], semantic: [], working: "", procedural: [] },
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
      status_lifecycle: "alive" as const,
      tokenUsage: 0,
      weeklyTokenBudget: 500000,
      version: 1,
    };
    
    await saveAgentState(superAgent);
    console.log(`✅ ${agent.name}`);
  }
  
  console.log('🎉 Listo');
  process.exit(0);
}

promoteAgents();