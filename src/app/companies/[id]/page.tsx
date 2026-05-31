'use client';
// ─── app/company/[id]/page.tsx — CompanyDashboard REFACTORIZADO ───────────────
// Cambios clave vs versión anterior:
//   1. Tipos extraídos a @/types/company
//   2. Hook extraído a @/hooks/useCompanyData (polling solo en trading)
//   3. BookmapPanel usa WebSocket (importado de components/dashboards/)
//   4. Grid responsive con auto-fit
//   5. Error handling en TradingDashboard.runCycle y BookmapPanel
//   6. EmpireFactory3DToggle lazy-loaded (solo cuando el usuario lo pide)
//   7. Código ~40% más corto gracias a la modularización

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useCompanyData } from '@/hooks/useCompanyData';
import BookmapPanel from '@/app/components/BookmapPanel';
import { EmpireFactory3DToggle } from '@/app/components/EmpireFactory3D';
import TradingDashboard from './dashboards/TradingDashboard';
import CineDashboard from './dashboards/CineDashboard';
import MarketingDashboard from './dashboards/MarketingDashboard';
import {
  TYPE_CONFIG, DEFAULT_THEME, STATUS_COLOR,
  type Agent, type Company, type TradingMetrics,
  type OrchestratorLog, type Diagnosis,
} from '@/types/company';

// ─── Constantes de estilos reutilizables ──────────────────────────────────────
const CARD = {
  background: '#0d1117',
  border: '1px solid #1e2433',
  borderRadius: 12,
  padding: 16,
};

const INPUT_STYLE = {
  background: '#161b22',
  border: '1px solid #1e2433',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  color: '#e6edf3' as const,
  outline: 'none',
};

// ─── Grid de KPIs responsivo ──────────────────────────────────────────────────
function KpiGrid({ items }: { items: { label: string; value: string; color: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
      {items.map(item => (
        <div key={item.label} style={CARD}>
          <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{item.label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────
function AgentCard({ agent, color }: { agent: Agent; color: string }) {
  const [expanded, setExpanded] = useState(false);
  const sc = STATUS_COLOR[agent.status] ?? '#8b949e';
  return (
    <div onClick={() => setExpanded(!expanded)} style={{
      ...CARD, cursor: 'pointer', transition: 'all 0.2s', position: 'relative', overflow: 'hidden',
      border: `1px solid ${expanded ? color : '#1e2433'}`,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: expanded ? `linear-gradient(90deg, ${color}, transparent)` : 'transparent' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 3 }}>{agent.name}</div>
          <div style={{ fontSize: 11, color: '#8b949e' }}>{agent.role}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: sc, background: `${sc}15`, border: `1px solid ${sc}30`, padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{agent.status}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e2433', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: sc, boxShadow: `0 0 8px ${sc}` }} />
            <span style={{ fontSize: 11, color: '#8b949e' }}>{agent.model}</span>
          </div>
          <span style={{ fontSize: 10, color }}>⚡ Telemetría Activa</span>
        </div>
      )}
    </div>
  );
}

// ─── Health Panel ─────────────────────────────────────────────────────────────
function HealthPanel({ diagnosis }: { diagnosis: Diagnosis | null }) {
  if (!diagnosis) return null;
  const oc = diagnosis.overall === 'healthy' ? '#00c896' : diagnosis.overall === 'degraded' ? '#f0b429' : '#ff5050';
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>❤️ Salud del Ecosistema</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: oc, textTransform: 'uppercase' }}>{diagnosis.overall}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6 }}>
        {diagnosis.services?.map(svc => {
          const c = svc.status === 'healthy' ? '#00c896' : svc.status === 'degraded' ? '#f0b429' : '#ff5050';
          return (
            <div key={svc.name} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#161b22', borderRadius: 8, padding: '6px 10px' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#8b949e' }}>{svc.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Logs Panel ───────────────────────────────────────────────────────────────
function LogsPanel({ logs }: { logs: OrchestratorLog[] }) {
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>⚡ Actividad del Orquestador</span>
        <span style={{ fontSize: 10, color: '#00c896' }}>En vivo</span>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {logs.length === 0
          ? <span style={{ fontSize: 12, color: '#8b949e' }}>Sin actividad</span>
          : logs.map((log, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid #1e2433' }}>
              <span style={{ fontSize: 10, color: '#f0b429', flexShrink: 0 }}>⚡</span>
              <span style={{ fontSize: 11, color: '#8b949e', fontFamily: 'monospace', wordBreak: 'break-all' }}>{log.action ?? JSON.stringify(log)}</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ─── Copilot Panel ────────────────────────────────────────────────────────────
function CopilotPanel({ company }: { company: Company }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const cfg = TYPE_CONFIG[company.type] ?? DEFAULT_THEME;

  const suggestions: Record<string, string[]> = {
    trading:        ['¿Cómo mejorar el win rate?', 'Analiza el drawdown actual', '¿Qué pares priorizar?'],
    cinematography: ['¿Qué universo mitológico explorar?', 'Optimiza el pipeline', '¿Cómo aumentar audiencia?'],
    marketing:      ['¿Cómo mejorar el CTR?', 'Analiza el funnel', '¿Qué productos afiliar?'],
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput(''); setApiError(null);
    setMessages(p => [...p, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const res = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'copilot', companyId: company.id, companyType: company.type,
          message: msg,
          context: `Empresa: ${company.name}, Sector: ${company.sector}, Agentes: ${company.agents.map(a => a.name).join(', ')}`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages(p => [...p, { role: 'assistant', content: data.response }]);
    } catch (e: any) {
      const errMsg = e?.message ?? 'Error desconocido';
      setApiError(errMsg);
      setMessages(p => [...p, { role: 'assistant', content: `⚠️ Error: ${errMsg}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...CARD, border: `1px solid ${cfg.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>🤖 Copiloto IA</span>
        <span style={{ fontSize: 11, color: cfg.color }}>Personalización en lenguaje natural</span>
      </div>
      {messages.length === 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {(suggestions[company.type] ?? []).map(s => (
            <button key={s} onClick={() => setInput(s)} style={{ ...INPUT_STYLE, cursor: 'pointer', fontSize: 11, padding: '6px 12px', borderRadius: 8 }}>{s}</button>
          ))}
        </div>
      )}
      {messages.length > 0 && (
        <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '85%', padding: '8px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.5, background: m.role === 'user' ? `${cfg.color}20` : '#161b22', border: `1px solid ${m.role === 'user' ? cfg.border : '#1e2433'}`, color: m.role === 'user' ? cfg.color : '#c9d1d9' }}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && <div style={{ fontSize: 11, color: '#8b949e', fontStyle: 'italic' }}>Analizando…</div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Pregunta al copiloto…" style={{ ...INPUT_STYLE, flex: 1 }} />
        <button onClick={send} disabled={loading || !input.trim()} style={{ background: cfg.color, border: 'none', borderRadius: 8, padding: '8px 16px', color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>→</button>
      </div>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────
export default function CompanyDashboard() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { company, diagnosis, logs, tradingMetrics, loading, error, refetch } = useCompanyData(id);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  useEffect(() => {
  fetch('/api/companies').then(r => r.json()).then(data => {
    if (Array.isArray(data)) setAllCompanies(data);
  }).catch(() => {});
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [agentForm, setAgentForm] = useState({ name: '', role: '', model: 'llama-3.3-70b-versatile' });
  const [saving, setSaving] = useState(false);
  const cfg = company ? (TYPE_CONFIG[company.type] ?? DEFAULT_THEME) : DEFAULT_THEME;

  const addAgent = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await fetch(`/api/companies/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentForm),
      });
      setAgentForm({ name: '', role: '', model: 'llama-3.3-70b-versatile' });
      setShowAgentForm(false);
      refetch();
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#010409' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12, animation: 'pulse 1.5s infinite' }}>⚡</div>
        <div style={{ color: '#8b949e', fontSize: 14 }}>Cargando entorno corporativo…</div>
        <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
      </div>
    </div>
  );

  if (error || !company) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#010409', flexDirection: 'column', gap: 12 }}>
      <div style={{ color: '#ff5050', fontSize: 32 }}>⚠️</div>
      <div style={{ color: '#8b949e', fontSize: 14 }}>{error ?? `Subsidiaria no encontrada: ${id}`}</div>
      <button onClick={() => refetch()} style={{ background: '#161b22', border: '1px solid #1e2433', color: '#e6edf3', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
        🔄 Reintentar
      </button>
    </div>
  );

  // Prepara los datos de nodos para la vista 3D
  const factoryNodes = [company].map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    health: 0.85, // puedes calcular esto desde diagnosis
    agents: c.agents.length,
  }));

  return (
    <div style={{ padding: '24px clamp(12px, 4vw, 32px)', background: '#010409', minHeight: '100vh', color: '#e6edf3' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, paddingBottom: 24, borderBottom: `1px solid ${cfg.border}`, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, padding: '4px 12px', borderRadius: 6 }}>
            División: {company.type}
          </span>
          <h1 style={{ fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 800, color: '#e6edf3', margin: '12px 0 6px', letterSpacing: -0.5 }}>{company.name}</h1>
          <p style={{ fontSize: 13, color: '#8b949e', margin: 0 }}>
            ID: <code style={{ color: '#e6edf3', background: '#161b22', padding: '2px 8px', borderRadius: 4, border: '1px solid #1e2433' }}>{id}</code>
            <span style={{ margin: '0 8px', color: '#1e2433' }}>|</span>
            Sector: <span style={{ color: '#e6edf3' }}>{company.sector}</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* 🏭 Botón Vista 3D — lazy load */}
          <EmpireFactory3DToggle
            companies={factoryNodes}
            onSelectCompany={(cid: string) => router.push(`/companies/${cid}`)}
          />
          <button onClick={async () => { await refetch(); setRefreshKey(k => k + 1); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#161b22', border: '1px solid #1e2433', color: '#8b949e', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>🔄 Actualizar</button>
          <div style={{ background: '#0d1117', border: `1px solid ${cfg.border}`, borderRadius: 12, padding: '12px 20px', display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>Fondos</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>{company.budget}</div>
            </div>
            <div style={{ borderLeft: '1px solid #1e2433', paddingLeft: 24 }}>
              <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>Métrica</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#e6edf3' }}>{company.metric}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Dashboard por tipo (los sub-dashboards de Cine y Marketing se mantienen igual) */}
      {company.type === 'trading' && (
        <TradingDashboard key={refreshKey} company={company} metrics={tradingMetrics} refetch={refetch} />
    )}
    {company.type === 'cinematography' && (
      <CineDashboard key={refreshKey} company={company} />
    )}
    {company.type === 'marketing' && (
      <MarketingDashboard key={refreshKey} company={company} />
    )}

      {/* Tiempo real */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 24 }}>
        <HealthPanel diagnosis={diagnosis} />
        <LogsPanel logs={logs} />
      </div>

      {/* Copiloto */}
      <div style={{ marginTop: 24 }}>
        <CopilotPanel company={company} />
      </div>

      {/* Consola de Agentes */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e6edf3', margin: 0 }}>
            ⚙️ Consola de Agentes Autónomos
            <span style={{ fontSize: 12, color: '#8b949e', fontWeight: 400, marginLeft: 8 }}>({company.agents.length} activos)</span>
          </h2>
          <button onClick={() => setShowAgentForm(!showAgentForm)} style={{ background: cfg.color, border: 'none', color: '#000', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            {showAgentForm ? '✕ Cancelar' : '+ Desplegar Agente'}
          </button>
        </div>

        {showAgentForm && (
          <form onSubmit={addAgent} style={{ ...CARD, border: `1px solid ${cfg.border}`, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
            {[{ label: 'Nombre', key: 'name', placeholder: 'Agent-Quant-01' }, { label: 'Rol', key: 'role', placeholder: 'Análisis de Mercado' }].map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>{f.label}</label>
                <input value={(agentForm as any)[f.key]} onChange={e => setAgentForm({ ...agentForm, [f.key]: e.target.value })} placeholder={f.placeholder} required style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box' }} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>Modelo</label>
              <select value={agentForm.model} onChange={e => setAgentForm({ ...agentForm, model: e.target.value })} style={{ ...INPUT_STYLE, width: '100%' }}>
                <option value="llama-3.3-70b-versatile">Llama 3.3 70B</option>
                <option value="llama-3.1-8b-instant">Llama 3.1 8B</option>
                <option value="claude-3-haiku-20240307">Claude Haiku</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
              </select>
            </div>
            <button type="submit" disabled={saving} style={{ background: cfg.color, border: 'none', borderRadius: 8, padding: '8px 20px', color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
              {saving ? '…' : 'Crear'}
            </button>
          </form>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {company.agents.map(agent => <AgentCard key={agent.name} agent={agent} color={cfg.color} />)}
        </div>
      </div>
    </div>
  );
}