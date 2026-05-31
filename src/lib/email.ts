import nodemailer from 'nodemailer';
import { redis } from './redis';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; content: string | Buffer; contentType?: string }[];
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: number;
}

async function getEmailConfig(): Promise<EmailConfig | null> {
  try {
    const config = await redis.get('empire:settings:email');
    if (config) return typeof config === 'string' ? JSON.parse(config) : config as EmailConfig;
  } catch {}
  return {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '',
    fromName: process.env.EMAIL_FROM_NAME || 'Empire Crew',
  };
}

async function createTransport() {
  const config = await getEmailConfig();
  if (!config) throw new Error('Email no configurado');
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  try {
    const transporter = await createTransport();
    const config = await getEmailConfig();
    const info = await transporter.sendMail({
      from: '"' + (config?.fromName || 'Empire Crew') + '" <' + config?.user + '>',
      to: Array.isArray(message.to) ? message.to.join(',') : message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
    });
    await logEmail({ to: message.to, subject: message.subject, success: true, messageId: info.messageId });
    return { success: true, messageId: info.messageId, timestamp: Date.now() };
  } catch (error: any) {
    await logEmail({ to: message.to, subject: message.subject, success: false, error: error.message });
    return { success: false, error: error.message, timestamp: Date.now() };
  }
}

async function logEmail(data: any): Promise<void> {
  try {
    await redis.lpush('empire:email:log', JSON.stringify({ ...data, timestamp: Date.now() }));
    await redis.ltrim('empire:email:log', 0, 99);
  } catch {}
}

export async function sendAgentReport(agentId: string, companyId: string, report: string, to: string): Promise<EmailResult> {
  return await sendEmail({
    to,
    subject: `[Empire Crew] Reporte de Agente — ${agentId}`,
    html: `
      <div style="font-family:monospace;background:#0a0a0a;color:#00ff88;padding:24px;border-radius:8px;">
        <h2 style="color:#00ccff;">Empire Crew — Reporte Automático</h2>
        <p><strong>Agente:</strong> ${agentId}</p>
        <p><strong>Empresa:</strong> ${companyId}</p>
        <hr style="border-color:#333;" />
        <pre style="color:#ccc;white-space:pre-wrap;">${report}</pre>
        <hr style="border-color:#333;" />
        <p style="color:#555;font-size:12px;">Generado automáticamente por el Super Orquestador</p>
      </div>
    `,
  });
}

export async function sendSalesAlert(to: string, product: string, amount: number, platform: string): Promise<EmailResult> {
  return await sendEmail({
    to,
    subject: `💰 Nueva Venta — ${product}`,
    html: `
      <div style="font-family:monospace;background:#0a0a0a;color:#00ff88;padding:24px;border-radius:8px;">
        <h2 style="color:#00ccff;">💰 Nueva Venta Detectada</h2>
        <p><strong>Producto:</strong> ${product}</p>
        <p><strong>Monto:</strong> $${amount}</p>
        <p><strong>Plataforma:</strong> ${platform}</p>
        <p><strong>Hora:</strong> ${new Date().toLocaleString('es-ES')}</p>
      </div>
    `,
  });
}

export async function sendWeeklyReport(to: string, report: {
  ecosystemHealth: number;
  totalRevenue: number;
  totalAgents: number;
  topOpportunities: string[];
}): Promise<EmailResult> {
  return await sendEmail({
    to,
    subject: `📊 Reporte Semanal Empire Crew — ${new Date().toLocaleDateString('es-ES')}`,
    html: `
      <div style="font-family:monospace;background:#0a0a0a;color:#ccc;padding:24px;border-radius:8px;">
        <h2 style="color:#00ccff;">📊 Reporte Semanal</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px;color:#888;">Salud del Ecosistema</td><td style="color:#00ff88;font-weight:bold;">${report.ecosystemHealth}%</td></tr>
          <tr><td style="padding:8px;color:#888;">Revenue Total</td><td style="color:#00ff88;font-weight:bold;">$${report.totalRevenue}</td></tr>
          <tr><td style="padding:8px;color:#888;">Agentes Activos</td><td style="color:#00ccff;font-weight:bold;">${report.totalAgents}</td></tr>
        </table>
        <h3 style="color:#00ccff;">Top Oportunidades</h3>
        <ul>${report.topOpportunities.map(o => `<li style="color:#ccc;">${o}</li>`).join('')}</ul>
      </div>
    `,
  });
}

export async function getEmailLog(): Promise<any[]> {
  const logs = await redis.lrange('empire:email:log', 0, 49) as string[];
  return logs.map(l => { try { return typeof l === 'string' ? JSON.parse(l) : l; } catch { return l; } });
}
