import { NextRequest, NextResponse } from 'next/server';
import {
  createVerifiedPlan,
  getPlan,
  listPlans,
  planAndPrioritize,
} from '@/app/lib/planner';   // ← RUTA CORREGIDA
import { logOrchestratorAction } from '@/lib/orchestrator';

// ... resto del código igual

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, goal, companyId, companyType, tasks, initialState } = body;

    // Acción: crear un plan a partir de un objetivo
    if (action === 'create_plan') {
      if (!goal || !companyId) {
        return NextResponse.json(
          { error: 'goal y companyId son requeridos' },
          { status: 400 }
        );
      }
      const plan = await createVerifiedPlan(
        goal,
        companyId,
        companyType || 'marketing',
        initialState || {}
      );
      await logOrchestratorAction(`planner:api:create:${plan.id}`);
      return NextResponse.json(plan, { status: 201 });
    }

    // Acción: planificar y priorizar múltiples tareas
    if (action === 'plan_and_prioritize') {
      if (!tasks || !Array.isArray(tasks) || !companyId) {
        return NextResponse.json(
          { error: 'tasks (array) y companyId son requeridos' },
          { status: 400 }
        );
      }
      const result = await planAndPrioritize(
        tasks,
        companyId,
        companyType || 'marketing'
      );
      await logOrchestratorAction(`planner:api:prioritize:${companyId}`);
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: 'Acción no reconocida. Use "create_plan" o "plan_and_prioritize".' },
      { status: 400 }
    );
  } catch (error: any) {
    await logOrchestratorAction(`planner:api:error:${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get('planId');
    const companyId = searchParams.get('companyId');

    // Obtener un plan específico por ID
    if (planId) {
      const plan = await getPlan(planId);
      if (!plan) {
        return NextResponse.json({ error: 'Plan no encontrado' }, { status: 404 });
      }
      return NextResponse.json(plan);
    }

    // Listar todos los planes de una empresa
    if (companyId) {
      const plans = await listPlans(companyId);
      return NextResponse.json(plans);
    }

    return NextResponse.json(
      { error: 'Se requiere planId o companyId como parámetro' },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}