import { google } from 'googleapis';
import { redis } from './redis';

export interface CalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

export interface CalendarEvent {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees?: string[];
  reminders?: number[];
}

export interface CalendarResult {
  success: boolean;
  eventId?: string;
  eventUrl?: string;
  error?: string;
  timestamp: number;
}

async function getCalendarConfig(): Promise<CalendarConfig | null> {
  try {
    const config = await redis.get('empire:settings:calendar');
    if (config) return typeof config === 'string' ? JSON.parse(config) : config as CalendarConfig;
  } catch {}
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
  };
}

async function getCalendarClient() {
  const config = await getCalendarConfig();
  if (!config?.clientId) throw new Error('Google Calendar no configurado');
  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });
  return { calendar: google.calendar({ version: 'v3', auth }), config };
}

export async function createEvent(event: CalendarEvent): Promise<CalendarResult> {
  try {
    const { calendar, config } = await getCalendarClient();
    const response = await calendar.events.insert({
      calendarId: config.calendarId,
      requestBody: {
        summary: event.title,
        description: event.description,
        location: event.location,
        start: { dateTime: event.startTime, timeZone: 'America/Bogota' },
        end: { dateTime: event.endTime, timeZone: 'America/Bogota' },
        attendees: event.attendees?.map(email => ({ email })),
        reminders: {
          useDefault: false,
          overrides: (event.reminders || [10]).map(minutes => ({ method: 'popup', minutes })),
        },
      },
    });
    await logCalendarAction({ action: 'create', title: event.title, success: true });
    return { success: true, eventId: response.data.id || '', eventUrl: response.data.htmlLink || '', timestamp: Date.now() };
  } catch (error: any) {
    await logCalendarAction({ action: 'create', title: event.title, success: false, error: error.message });
    return { success: false, error: error.message, timestamp: Date.now() };
  }
}

export async function listEvents(maxResults: number = 10, timeMin?: string): Promise<any[]> {
  try {
    const { calendar, config } = await getCalendarClient();
    const response = await calendar.events.list({
      calendarId: config.calendarId,
      timeMin: timeMin || new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });
    return response.data.items || [];
  } catch (error: any) {
    return [];
  }
}

export async function deleteEvent(eventId: string): Promise<CalendarResult> {
  try {
    const { calendar, config } = await getCalendarClient();
    await calendar.events.delete({ calendarId: config.calendarId, eventId });
    return { success: true, eventId, timestamp: Date.now() };
  } catch (error: any) {
    return { success: false, error: error.message, timestamp: Date.now() };
  }
}

export async function updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<CalendarResult> {
  try {
    const { calendar, config } = await getCalendarClient();
    const existing = await calendar.events.get({ calendarId: config.calendarId, eventId });
    const updated = {
      ...existing.data,
      summary: updates.title || existing.data.summary,
      description: updates.description || existing.data.description,
      start: updates.startTime ? { dateTime: updates.startTime, timeZone: 'America/Bogota' } : existing.data.start,
      end: updates.endTime ? { dateTime: updates.endTime, timeZone: 'America/Bogota' } : existing.data.end,
    };
    const response = await calendar.events.update({ calendarId: config.calendarId, eventId, requestBody: updated });
    return { success: true, eventId: response.data.id || '', timestamp: Date.now() };
  } catch (error: any) {
    return { success: false, error: error.message, timestamp: Date.now() };
  }
}

export async function scheduleAgentEvaluation(agentId: string, agentName: string, companyId: string, evaluationDate: Date): Promise<CalendarResult> {
  const startTime = evaluationDate.toISOString();
  const endTime = new Date(evaluationDate.getTime() + 30 * 60000).toISOString();
  return await createEvent({
    title: `[Empire Crew] Evaluacion CLEAR — ${agentName}`,
    description: `Evaluacion semanal del agente ${agentId} en empresa ${companyId}. Sistema CLEAR automatico.`,
    startTime,
    endTime,
    reminders: [30, 10],
  });
}

export async function scheduleWeeklyReport(reportDate: Date, companyName: string): Promise<CalendarResult> {
  const startTime = reportDate.toISOString();
  const endTime = new Date(reportDate.getTime() + 60 * 60000).toISOString();
  return await createEvent({
    title: `[Empire Crew] Reporte Semanal — ${companyName}`,
    description: `Generacion automatica de reporte semanal del ecosistema Empire Crew.`,
    startTime,
    endTime,
    reminders: [60],
  });
}

export async function scheduleContentPublication(title: string, platform: string, publishDate: Date, description?: string): Promise<CalendarResult> {
  const startTime = publishDate.toISOString();
  const endTime = new Date(publishDate.getTime() + 15 * 60000).toISOString();
  return await createEvent({
    title: `[Publicacion] ${platform} — ${title}`,
    description: description || `Publicacion programada en ${platform}`,
    startTime,
    endTime,
    reminders: [60, 15],
  });
}

async function logCalendarAction(data: any): Promise<void> {
  try {
    await redis.lpush('empire:calendar:log', JSON.stringify({ ...data, timestamp: Date.now() }));
    await redis.ltrim('empire:calendar:log', 0, 99);
  } catch {}
}

export async function getCalendarLog(): Promise<any[]> {
  const logs = await redis.lrange('empire:calendar:log', 0, 49) as string[];
  return logs.map(l => { try { return typeof l === 'string' ? JSON.parse(l) : l; } catch { return l; } });
}
