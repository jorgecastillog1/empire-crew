import { NextRequest, NextResponse } from 'next/server';
import { evaluateAllAgents } from '@/lib/agentMonitor';
import { healAgent, healService } from '@/lib/supervisor';
import { logOrchestratorAction } from '@/lib/orchestrator';
import { redis } from '@/lib/redis';

const CRON_SECRET = process.env.CRON_SECRET ?? 'empire-cron-secret';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const action = searchParams.get('action') ?? 'evaluate';

  if (secret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (action === 'evaluate') {
      const results = await evaluateAllAgents();
      const actions: string[] = [];
      const healed: string[] = [];

      for (const eval_ of results) {
        await redis.hset('empire:agent:status', { [eval_.agentId]: eval_.decision });
        actions.push(eval_.agentId + ':' + eval_.decision);

        if (eval_.decision === 'probation' || eval_.decision === 'terminate') {
          await logOrchestratorAction('cron:agent:' + eval_.decision + ':' + eval_.agentId);
          const healResult = await healAgent(eval_.agentId, eval_.companyId, eval_.reason);
          healed.push(eval_.agentId + ':level' + healResult.level + ':' + healResult.action);
        }
      }

      await redis.set('empire:cron:lastRun', Date.now(), { ex: 86400 });
      return NextResponse.json({ evaluated: results.length, actions, healed, timestamp: Date.now() });
    }

    if (action === 'heal_services') {
      const services = ['groq', 'redis', 'tavily', 'fal', 'replicate', 'cloudinary'];
      const healed: string[] = [];
      for (const svc of services) {
        const errorCount = Number(await redis.get<number>('supervisor:errors:' + svc) ?? 0);
        if (errorCount > 0) {
          await healService(svc, 'auto-heal from cron');
          healed.push(svc);
        }
      }
      return NextResponse.json({ healed, timestamp: Date.now() });
    }

    if (action === 'status') {
      const lastRun = await redis.get<number>('empire:cron:lastRun');
      const agentStatuses = await redis.hgetall('empire:agent:status');
      return NextResponse.json({ lastRun, agentStatuses, timestamp: Date.now() });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}