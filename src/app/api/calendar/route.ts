import { NextRequest, NextResponse } from 'next/server';
import {
  createEvent,
  listEvents,
  deleteEvent,
  updateEvent,
  scheduleAgentEvaluation,
  scheduleWeeklyReport,
  scheduleContentPublication,
  getCalendarLog,
} from '@/lib/calendar';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, event, eventId, updates, agentId, agentName, companyId, companyName, title, platform, publishDate, evaluationDate, reportDate } = body;

    switch (action) {
      case 'create':
        return NextResponse.json(await createEvent(event));

      case 'update':
        return NextResponse.json(await updateEvent(eventId, updates));

      case 'delete':
        return NextResponse.json(await deleteEvent(eventId));

      case 'schedule_evaluation':
        return NextResponse.json(await scheduleAgentEvaluation(agentId, agentName, companyId, new Date(evaluationDate)));

      case 'schedule_report':
        return NextResponse.json(await scheduleWeeklyReport(new Date(reportDate), companyName));

      case 'schedule_publication':
        return NextResponse.json(await scheduleContentPublication(title, platform, new Date(publishDate)));

      default:
        return NextResponse.json({ error: 'Accion no reconocida' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'log') {
      return NextResponse.json(await getCalendarLog());
    }

    const maxResults = parseInt(searchParams.get('maxResults') || '10');
    const timeMin = searchParams.get('timeMin') || undefined;
    return NextResponse.json(await listEvents(maxResults, timeMin));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
