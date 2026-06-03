// src/app/api/marketing/cycle/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runMarketingCycle } from '@/lib/marketing-automation';
import { logOrchestratorAction } from '@/lib/orchestrator';

const CRON_SECRET = process.env.CRON_SECRET || 'empire-cron-secret-2025';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== CRON_SECRET) {
    await logOrchestratorAction('marketing:cycle:unauthorized');
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    await logOrchestratorAction('marketing:cycle:api-start');
    const result = await runMarketingCycle();
    await logOrchestratorAction(`marketing:cycle:api-success:${result.campaignsGenerated}`);
    return NextResponse.json({
      success: true,
      cycleLog: result,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    await logOrchestratorAction(`marketing:cycle:api-error:${error.message}`);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const secret = body.secret || request.headers.get('x-cron-secret');

  if (secret !== CRON_SECRET) {
    await logOrchestratorAction('marketing:cycle:unauthorized');
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const result = await runMarketingCycle();
    return NextResponse.json({ success: true, cycleLog: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}