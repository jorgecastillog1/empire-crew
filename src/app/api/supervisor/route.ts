import { NextRequest, NextResponse } from 'next/server';
import { runSystemDiagnosis, checkServiceHealth, healService, reportServiceError } from '../../../lib/supervisor';
import { consolidateToHindsight } from '../../../lib/hindsight';
import { runForgettingCurve } from '../../../lib/memory';
import { redis } from '../../../lib/redis';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') ?? 'diagnosis';

  if (action === 'diagnosis') {
    const report = await runSystemDiagnosis();
    return NextResponse.json(report);
  }

  if (action === 'status') {
    const diagnosis = await runSystemDiagnosis();
    const queue = await redis.lrange('empire:orchestrator:log', 0, 9) as string[];
    return NextResponse.json({
      status: 'operational',
      diagnosis,
      recentLog: queue.map(l => { try { return typeof l === 'string' ? JSON.parse(l) : l; } catch { return l; } }),
      timestamp: Date.now(),
    });
  }

  if (action === 'health') {
    const service = searchParams.get('service') ?? 'groq';
    const health = await checkServiceHealth(service);
    return NextResponse.json(health);
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  try {
    const { action, service, error, agentId, companyId } = await request.json();

    if (action === 'heal') {
      const result = await healService(service, error ?? 'unknown error');
      return NextResponse.json(result);
    }

    if (action === 'report_error') {
      await reportServiceError(service, error);
      const result = await healService(service, error);
      return NextResponse.json(result);
    }

    if (action === 'consolidate') {
      const logs = await redis.lrange('empire:orchestrator:log', 0, 49) as string[];
      const logStrings = logs.map(l => {
        try { const p = typeof l === 'string' ? JSON.parse(l) : l; return p.action ?? String(l); }
        catch { return String(l); }
      });
      const result = await consolidateToHindsight(agentId, companyId, logStrings);
      return NextResponse.json(result);
    }

    if (action === 'forget') {
      const result = await runForgettingCurve(agentId);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}