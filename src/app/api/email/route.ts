import { NextRequest, NextResponse } from 'next/server';
import {
  sendEmail,
  sendAgentReport,
  sendSalesAlert,
  sendWeeklyReport,
  getEmailLog,
} from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, to, subject, text, html, attachments, agentId, companyId, report, product, amount, platform } = body;

    switch (action) {
      case 'send':
        return NextResponse.json(await sendEmail({ to, subject, text, html, attachments }));

      case 'agent_report':
        return NextResponse.json(await sendAgentReport(agentId, companyId, report, to));

      case 'sales_alert':
        return NextResponse.json(await sendSalesAlert(to, product, amount, platform));

      case 'weekly_report':
        return NextResponse.json(await sendWeeklyReport(to, report));

      default:
        return NextResponse.json({ error: 'Accion no reconocida' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const logs = await getEmailLog();
    return NextResponse.json(logs);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
