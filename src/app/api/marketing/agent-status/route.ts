// src/app/api/marketing/agent-status/route.ts
// Endpoint para consultar el estado de los agentes de marketing, logs de ciclos y campañas recientes

import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { logOrchestratorAction } from '@/lib/orchestrator';

export async function GET() {
  try {
    await logOrchestratorAction('marketing:status:consultado');

    // Obtener los últimos 10 logs de ciclos automáticos
    const cycleLogsRaw = await redis.lrange('empire:marketing:cycle-logs', 0, 9);
    const cycleLogs = cycleLogsRaw.map(log => {
      try {
        return typeof log === 'string' ? JSON.parse(log) : log;
      } catch {
        return { error: 'Log corrupto', raw: log };
      }
    });

    // Obtener las últimas 10 campañas generadas
    const campaignsRaw = await redis.lrange('empire:marketing:campaigns', 0, 9);
    const campaigns = campaignsRaw.map(campaign => {
      try {
        return typeof campaign === 'string' ? JSON.parse(campaign) : campaign;
      } catch {
        return { error: 'Campaña corrupta', raw: campaign };
      }
    });

    // (Opcional) Obtener logs recientes de los agentes de marketing desde el orquestador
    const orchestratorLogsRaw = await redis.lrange('empire:orchestrator:log', 0, 19);
    const marketingLogs = orchestratorLogsRaw
      .map(log => {
        try {
          const parsed = typeof log === 'string' ? JSON.parse(log) : log;
          // Filtrar solo logs relacionados con marketing
          if (parsed.action && parsed.action.includes('marketing:')) {
            return parsed;
          }
          return null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(0, 10);

    // Estado general
    const lastCycleLog = cycleLogs[0] || null;
    const lastSuccess = lastCycleLog?.campaignsGenerated > 0;

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
      lastCycle: lastCycleLog,
      lastSuccess,
      cycles: cycleLogs,
      recentCampaigns: campaigns,
      recentAgentLogs: marketingLogs,
    });
  } catch (error: any) {
    await logOrchestratorAction(`marketing:status:error:${error.message}`);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}