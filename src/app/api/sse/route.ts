import { NextRequest } from 'next/server';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        const msg = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
        controller.enqueue(encoder.encode(msg));
      };

      const sendUpdates = async () => {
        try {
          // Ecosystem stats
          const companyKeys = await redis.keys('company:*');
          const agentKeys = await redis.keys('agent:*:*');
          const logs = await redis.lrange('empire:orchestrator:log', 0, 9) as string[];

          const parsedLogs = logs.map(l => {
            try { return typeof l === 'string' ? JSON.parse(l) : l; } catch { return { action: String(l), timestamp: Date.now() }; }
          });

          send('ecosystem', {
            companies: companyKeys.length,
            agents: agentKeys.length,
            health: 100,
            timestamp: Date.now(),
          });

          send('logs', { logs: parsedLogs });

          // Approval requests pendientes
          const pendingIds = await redis.lrange('approval:pending', 0, 4) as string[];
          const approvals = [];
          for (const id of pendingIds) {
            const raw = await redis.get<string>('approval:' + id);
            if (raw) try { approvals.push(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch {}
          }
          if (approvals.length > 0) send('approvals', { approvals });

        } catch (err) {
          send('error', { message: 'Update failed' });
        }
      };

      // Enviar inmediatamente
      await sendUpdates();

      // Luego cada 5 segundos
      const interval = setInterval(async () => {
        try {
          await sendUpdates();
        } catch {
          clearInterval(interval);
          controller.close();
        }
      }, 5000);

      // Cleanup cuando el cliente se desconecta
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}