import { redis } from '@/lib/redis';
import { callLLM, logOrchestratorAction, HTNTask, TaskPrioritization, decomposeHTN, prioritizeTasks } from '@/lib/orchestrator';
import { writeProof } from '@/lib/omk';

// ============================================================
// PLANIFICADOR NEURO-SIMBÓLICO
// ============================================================

export interface PlanStep {
  id: string;
  action: string;
  parameters: any;
  preconditions: string[];
  effects: string[];
  verified: boolean;
  proof?: string;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  verified: boolean;
  confidence: number;
  companyId: string;
  createdAt: number;
}

// Validador simbólico — verifica precondiciones y efectos
function validateStep(step: PlanStep, worldState: Record<string, any>): {
  valid: boolean; reason: string;
} {
  for (const precondition of step.preconditions) {
    const [key, value] = precondition.split('=');
    if (worldState[key.trim()] !== undefined && String(worldState[key.trim()]) !== value?.trim()) {
      return { valid: false, reason: 'Precondition failed: ' + precondition };
    }
  }
  return { valid: true, reason: 'OK' };
}

// Aplicar efectos al estado del mundo
function applyEffects(step: PlanStep, worldState: Record<string, any>): Record<string, any> {
  const newState = { ...worldState };
  for (const effect of step.effects) {
    const [key, value] = effect.split('=');
    newState[key.trim()] = value?.trim() ?? true;
  }
  return newState;
}

// Generar plan con LLM
async function generatePlanWithLLM(
  goal: string,
  companyId: string,
  companyType: string
): Promise<PlanStep[]> {
  const result = await callLLM({
    systemPrompt: `You are a neuro-symbolic planner for a ${companyType} company.
Generate a verified execution plan as JSON array of steps.
Each step: {"id":"1","action":"...","parameters":{},"preconditions":["state=value"],"effects":["state=value"],"verified":false}
Max 5 steps. Actions must be specific and executable. Keep preconditions and effects simple key=value pairs.
Respond ONLY with the JSON array.`,
    userMessage: 'Goal: ' + goal + '\nCompany: ' + companyId,
    agentId: 'planner:' + companyId,
    maxTokens: 600,
    useCache: true,
  });

  try {
    const clean = result.response.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return [{
      id: '1',
      action: goal,
      parameters: {},
      preconditions: [],
      effects: ['goal=completed'],
      verified: false,
    }];
  }
}

// Plan completo con validación simbólica
export async function createVerifiedPlan(
  goal: string,
  companyId: string,
  companyType: string = 'marketing',
  initialState: Record<string, any> = {}
): Promise<ExecutionPlan> {
  const planId = 'plan:' + Date.now().toString(36);
  await logOrchestratorAction('planner:start:' + goal.slice(0, 50));

  const steps = await generatePlanWithLLM(goal, companyId, companyType);

  // Validación simbólica paso a paso
  let worldState = { ...initialState };
  let allValid = true;
  let confidence = 1.0;

  for (const step of steps) {
    const validation = validateStep(step, worldState);
    step.verified = validation.valid;
    step.proof = validation.reason;

    if (!validation.valid) {
      allValid = false;
      confidence *= 0.7;
    } else {
      worldState = applyEffects(step, worldState);
    }
  }

  const plan: ExecutionPlan = {
    id: planId,
    goal,
    steps,
    verified: allValid,
    confidence: Math.round(confidence * 100) / 100,
    companyId,
    createdAt: Date.now(),
  };

  await redis.set('plan:' + planId, JSON.stringify(plan), { ex: 86400 * 7 });
  await writeProof('planner:create', { goal, companyId }, { planId, verified: allValid, confidence, steps: steps.length }, 'planner', companyId);
  await logOrchestratorAction('planner:done:' + planId + ':confidence:' + confidence);

  return plan;
}

export async function getPlan(planId: string): Promise<ExecutionPlan | null> {
  const raw = await redis.get<string>('plan:' + planId);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

export async function listPlans(companyId: string): Promise<ExecutionPlan[]> {
  const keys = await redis.keys('plan:plan:*');
  const plans: ExecutionPlan[] = [];
  for (const key of keys) {
    const raw = await redis.get<string>(key);
    if (!raw) continue;
    try {
      const plan = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (plan.companyId === companyId) plans.push(plan);
    } catch {}
  }
  return plans.sort((a, b) => b.createdAt - a.createdAt);
}

// Priorizar tareas con HTN
export async function planAndPrioritize(
  tasks: { id: string; description: string; deadline: number; priority: number }[],
  companyId: string,
  companyType: string
): Promise<{ plans: ExecutionPlan[]; prioritized: TaskPrioritization[] }> {
  const prioritized = await prioritizeTasks(
    tasks.map(t => ({
      taskId: t.id,
      priority: t.priority,
      estimatedCost: 10,
      deadline: t.deadline,
      dependencies: [],
    }))
  );

  const plans: ExecutionPlan[] = [];
  for (const task of prioritized.slice(0, 3)) {
    const original = tasks.find(t => t.id === task.taskId);
    if (!original) continue;
    const plan = await createVerifiedPlan(original.description, companyId, companyType);
    plans.push(plan);
  }

  return { plans, prioritized };
}