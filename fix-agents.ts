// fix-agents.ts
import { redis } from './src/lib/redis.js';
import { saveAgentState, DEFAULT_CLEAR } from './src/lib/orchestrator.js';

const companyId = 'marketing-pro';

async function fixAgents() {
  console.log('🔧 Corrigiendo agentes...');
  
  // 1. Obtener los agentes de la empresa
  const companyRaw = await redis.get('empire:company:marketing-pro');
  const company = JSON.parse(companyRaw as string);
  
  console.log(`📋 Agentes encontrados: ${company.agents.length}`);
  
  // 2. Para cada agente, crear/actualizar SuperAgente con el formato correcto
  for (const agent of company.agents) {
    // El nombre correcto en inglés (como espera el código)
    const englishName = agent.name.replace('Agente-', 'Agent-');
    
    const superAgent = {
      id: englishName,
      companyId: companyId,
      name: englishName,
      role: agent.role,
      status: 'idle' as const,
      model: agent.model,
      systemPrompt: `Eres experto en ${agent.role}.`,
      capabilities: [agent.role],
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
      status_lifecycle: 'alive' as const,
      tokenUsage: 0,
      weeklyTokenBudget: 500000,
      version: 1,
    };
    
    // Guardar con la key correcta (agente:marketing-pro:Agent-XXX)
    await saveAgentState(superAgent);
    console.log(`✅ ${englishName} → guardado en agente:${companyId}:${englishName}`);
  }
  
  // 3. Verificar que se guardaron
  const keys = await redis.keys('agente:marketing-pro:*');
  console.log(`\n🎉 Total de agentes en Redis: ${keys.length}`);
  keys.forEach(k => console.log(`   ${k}`));
  
  process.exit(0);
}

fixAgents();
