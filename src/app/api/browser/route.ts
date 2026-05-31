import { NextRequest, NextResponse } from 'next/server';
import { executeBrowserTask, scrapeUrl, monitorPrice, takeScreenshot, BrowserAction } from '@/lib/browser';
import { redis } from '@/lib/redis';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, actions, url, selector, agentId, companyId } = body;

    // Log en Redis
    await redis.lpush('empire:browser:log', JSON.stringify({
      action: action || 'custom',
      url: url || '',
      agentId: agentId || 'manual',
      companyId: companyId || '',
      timestamp: Date.now(),
    }));
    await redis.ltrim('empire:browser:log', 0, 99);

    // Accion simple
    if (action === 'scrape') {
      const content = await scrapeUrl(url, selector);
      return NextResponse.json({ success: true, data: content });
    }

    if (action === 'screenshot') {
      const base64 = await takeScreenshot(url);
      return NextResponse.json({ success: true, screenshot: base64 });
    }

    if (action === 'monitor_price') {
      const price = await monitorPrice(url, selector);
      return NextResponse.json({ success: true, price });
    }

    // Secuencia de acciones personalizadas
    if (action === 'execute' && Array.isArray(actions)) {
      const results = await executeBrowserTask(actions as BrowserAction[], { agentId, companyId });
      return NextResponse.json({ success: true, results });
    }

    return NextResponse.json({ error: 'Accion no reconocida' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const logs = await redis.lrange('empire:browser:log', 0, 19) as string[];
    const parsed = logs.map(l => {
      try { return typeof l === 'string' ? JSON.parse(l) : l; }
      catch { return { raw: l }; }
    });
    return NextResponse.json(parsed);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
