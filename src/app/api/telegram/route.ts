import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { createApprovalRequest, resolveApprovalRequest } from '@/lib/orchestrator';
import { executeTool } from '@/lib/thoth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, message, agentId, companyId, requestId, approved } = body;

    if (action === 'notify') {
      const result = await executeTool('telegram_notify', { message });
      return NextResponse.json(result);
    }

    if (action === 'approval_request') {
      const req = await createApprovalRequest(message, { agentId, companyId }, agentId, companyId);
      await executeTool('telegram_notify', {
        message: '<b>Approval Required</b>\n' + message + '\n\nID: <code>' + req.id + '</code>\nReply with /approve ' + req.id + ' or /reject ' + req.id,
      });
      return NextResponse.json(req);
    }

    if (action === 'resolve') {
      const result = await resolveApprovalRequest(requestId, approved, 'telegram', '');
      await executeTool('telegram_notify', {
        message: 'Request ' + requestId + ' has been ' + (approved ? 'APPROVED' : 'REJECTED'),
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const raw = await redis.get<string>('empire:settings:telegram');
  const settings = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
  const token = settings.token;
  const chatId = settings.chatId;

  if (!token || !chatId) {
    return NextResponse.json({ configured: false });
  }

  try {
    const res = await fetch('https://api.telegram.org/bot' + token + '/getMe');
    const data = await res.json();
    return NextResponse.json({ configured: true, bot: data.result });
  } catch {
    return NextResponse.json({ configured: false, error: 'Cannot reach Telegram' });
  }
}