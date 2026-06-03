'use client';
// ─── MarketingDashboard.tsx ───────────────────────────────────────────────────
// MODIFICADO: Añadida sección de Automatización (ciclo automático, estado, botón forzar)
// Se mantienen todas las herramientas manuales (copy, SEO, afiliados).

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Company } from '@/types/company';
import { getNextGroqModel } from './TradingDashboard';

interface Props { company: Company; }

// Interfaz para los datos de estado de automatización
interface AutomationStatus {
  lastCycle: {
    timestamp: number;
    productsFound: number;
    productsFiltered: number;
    campaignsGenerated: number;
    published: number;
    errors: string[];
  } | null;
  lastSuccess: boolean;
  cycles: any[];
  recentCampaigns: any[];
  recentAgentLogs: any[];
}

export default function MarketingDashboard({ company }: Props) {
  // ========== Estado existente ==========
  const [affiliateSearching, setAffiliateSearching] = useState(false);
  const [affiliateResults, setAffiliateResults]     = useState<string[]>([]);
  const [seoQuery, setSeoQuery]   = useState('');
  const [seoResults, setSeoResults] = useState('');
  const [seoLoading, setSeoLoading] = useState(false);
  const [copyTopic, setCopyTopic] = useState('');
  const [copyResult, setCopyResult] = useState('');
  const [copyLoading, setCopyLoading] = useState(false);
  const [robotLogs, setRobotLogs] = useState<any[]>([]);
  const mountedRef = useRef(true);

  // ========== NUEVO: Estado para automatización ==========
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus>({
    lastCycle: null,
    lastSuccess: false,
    cycles: [],
    recentCampaigns: [],
    recentAgentLogs: [],
  });
  const [statusLoading, setStatusLoading] = useState(true);
  const [forceCycleLoading, setForceCycleLoading] = useState(false);

  // ========== Funciones existentes ==========
  const fetchRobotLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/robot?action=log');
      if (res.ok && mountedRef.current) {
        const d = await res.json();
        setRobotLogs(Array.isArray(d) ? d.slice(0, 5) : []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchRobotLogs();
    const t = setInterval(fetchRobotLogs, 20_000);
    return () => {
      mountedRef.current = false;
      clearInterval(t);
    };
  }, [fetchRobotLogs]);

  const generateCopy = async () => {
    if (!copyTopic.trim()) return;
    setCopyLoading(true); setCopyResult('');
    try {
      const model = getNextGroqModel();
      const res = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'copilot',
          companyId: company.id,
          companyType: 'marketing',
          model,
          message: `Eres Agent-Neuro-Copywriter experto en neuromarketing. Crea un copy publicitario de ALTA CONVERSIÓN para: "${copyTopic}".

Estructura obligatoria:
1. 🎯 HOOK (primera línea que detiene el scroll)
2. 💡 PROPUESTA DE VALOR ÚNICA (qué lo hace diferente)
3. 📊 PRUEBA SOCIAL (testimonio o estadística)
4. ⚡ LLAMADA A LA ACCIÓN URGENTE (con escasez o urgencia)

Usa sesgos cognitivos: reciprocidad, escasez, prueba social, autoridad. Máximo 150 palabras. Directo, sin explicaciones.`,
          context: `Empresa: ${company.name}, Sector: ${company.sector}`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCopyResult(data.response ?? 'Sin respuesta');
    } catch (e: any) {
      setCopyResult(`⚠️ Error: ${e.message}`);
    } finally {
      setCopyLoading(false);
    }
  };

  const runSEO = async () => {
    if (!seoQuery.trim()) return;
    setSeoLoading(true); setSeoResults('');
    try {
      const model = getNextGroqModel();
      const res = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'copilot',
          companyId: company.id,
          companyType: 'marketing',
          model,
          message: `Eres Agent-SEO-Dominator. Analiza SEO para: "${seoQuery}".

Responde SOLO con este JSON (sin markdown, sin explicaciones):
{
  "keywords": ["kw1","kw2","kw3","kw4","kw5"],
  "difficulty": 45,
  "volume": 12000,
  "ideas": ["idea1","idea2","idea3"],
  "intent": "informacional|transaccional|navegacional",
  "cpc": 1.20
}`,
          context: 'SEO research avanzado',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      try {
        const clean = (data.response ?? '').replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        setSeoResults(JSON.stringify(parsed, null, 2));
      } catch {
        setSeoResults(data.response ?? 'Sin respuesta');
      }
    } catch (e: any) {
      setSeoResults(`⚠️ Error: ${e.message}`);
    } finally {
      setSeoLoading(false);
    }
  };

  const searchAffiliates = async () => {
    setAffiliateSearching(true);
    try {
      const res = await fetch('/api/robot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dispatch_and_execute',
          type: 'scrape_trends',
          companyId: company.id,
          companyType: 'marketing',
          payload: { url: 'https://www.clickbank.com/marketplace.htm', selector: '.product-title' },
        }),
      });
      const data = await res.json();
      setAffiliateResults(data.result?.trends ?? []);
    } catch {} finally {
      setAffiliateSearching(false);
    }
  };

  // ========== NUEVAS FUNCIONES PARA AUTOMATIZACIÓN ==========
  const fetchAutomationStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/marketing/agent-status');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAutomationStatus({
            lastCycle: data.lastCycle,
            lastSuccess: data.lastSuccess,
            cycles: data.cycles || [],
            recentCampaigns: data.recentCampaigns || [],
            recentAgentLogs: data.recentAgentLogs || [],
          });
        }
      }
    } catch (error) {
      console.error('Error al obtener estado de automatización:', error);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const forceCycle = async () => {
    const secret = process.env.NEXT_PUBLIC_CRON_SECRET;
    if (!secret) {
      alert('⚠️ No se ha configurado la variable NEXT_PUBLIC_CRON_SECRET. El botón no funcionará.');
      return;
    }
    setForceCycleLoading(true);
    try {
      const res = await fetch(`/api/marketing/cycle?secret=${secret}`);
      const data = await res.json();
      if (data.success) {
        alert(`✅ Ciclo forzado exitosamente. Campañas generadas: ${data.cycleLog.campaignsGenerated}`);
        await fetchAutomationStatus(); // refrescar estado
      } else {
        alert(`❌ Error: ${data.error}`);
      }
    } catch (error: any) {
      alert(`❌ Error de red: ${error.message}`);
    } finally {
      setForceCycleLoading(false);
    }
  };

  // Cargar estado al montar y refrescar cada 30 segundos
  useEffect(() => {
    fetchAutomationStatus();
    const interval = setInterval(fetchAutomationStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchAutomationStatus]);

  // Helper para formatear timestamp
  const formatDate = (ts: number) => {
    if (!ts) return 'Nunca';
    return new Date(ts).toLocaleString('es-CO');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ─── KPIs (sin cambios) ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: 'Ventas Hoy',    value: '$0.00', color: '#4f8ef7' },
          { label: 'CTR Promedio',  value: '0.00%', color: '#00c896' },
          { label: 'Leads Generados', value: '0',   color: '#e6edf3' },
          { label: 'ROAS',          value: '0.0x',  color: '#f0b429' },
        ].map(item => (
          <div key={item.label} style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* ─── NUEVA SECCIÓN: AUTOMATIZACIÓN DE MARKETING ───────────────────── */}
      <div style={{ background: '#0d1117', border: '1px solid rgba(0,200,150,0.3)', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#00c896' }}>🤖 Automatización 24/7 — Agentes trabajando automáticamente</div>
          <button
            onClick={forceCycle}
            disabled={forceCycleLoading}
            style={{
              padding: '6px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
              background: forceCycleLoading ? '#1e2433' : '#f0b429',
              color: forceCycleLoading ? '#8b949e' : '#000',
            }}
          >
            {forceCycleLoading ? '⏳ Forzando...' : '⚡ Forzar ciclo ahora'}
          </button>
        </div>

        {statusLoading ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#8b949e' }}>Cargando estado de automatización...</div>
        ) : (
          <>
            {/* Estado del último ciclo */}
            <div style={{ background: '#161b22', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e6edf3', marginBottom: 6 }}>📊 Último ciclo automático</div>
              {automationStatus.lastCycle ? (
                <div style={{ fontSize: 11, color: '#8b949e', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  <span>🕒 Fecha: {formatDate(automationStatus.lastCycle.timestamp)}</span>
                  <span>🔍 Productos encontrados: {automationStatus.lastCycle.productsFound}</span>
                  <span>🎯 Productos filtrados: {automationStatus.lastCycle.productsFiltered}</span>
                  <span>📢 Campañas generadas: {automationStatus.lastCycle.campaignsGenerated}</span>
                  <span>📤 Publicaciones: {automationStatus.lastCycle.published}</span>
                  <span style={{ color: automationStatus.lastCycle.errors.length > 0 ? '#ff5050' : '#00c896' }}>
                    ⚠️ Errores: {automationStatus.lastCycle.errors.length}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: '#8b949e' }}>Aún no se ha ejecutado ningún ciclo automático. El primer ciclo se lanzará según el cron (cada 4 horas).</div>
              )}
            </div>

            {/* Últimas campañas generadas */}
            {automationStatus.recentCampaigns.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e6edf3', marginBottom: 6 }}>📋 Últimas campañas generadas</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {automationStatus.recentCampaigns.slice(0, 3).map((camp, idx) => (
                    <div key={idx} style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 8, padding: 8 }}>
                      <div style={{ fontSize: 12, color: '#c9d1d9' }}>{camp.product?.name || 'Producto'}</div>
                      <div style={{ fontSize: 10, color: '#8b949e', wordBreak: 'break-all' }}>
                        {camp.fullCopy?.substring(0, 100)}...
                      </div>
                      {camp.funnelHtml && (
                        <a href={camp.funnelHtml} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#00c896' }}>
                          Ver funnel →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Logs recientes de agentes (solo marketing) */}
            {automationStatus.recentAgentLogs.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e6edf3', marginBottom: 6 }}>📡 Actividad reciente de agentes</div>
                <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 10, color: '#8b949e' }}>
                  {automationStatus.recentAgentLogs.map((log, idx) => (
                    <div key={idx} style={{ padding: '4px 0', borderBottom: '1px solid #1e2433' }}>
                      {log.action}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Nota sobre el cron */}
            <div style={{ marginTop: 12, fontSize: 10, color: '#4f8ef7', textAlign: 'center', borderTop: '1px solid #1e2433', paddingTop: 8 }}>
              ⏰ Ciclo automático programado cada 4 horas (configurable en cron-job.org)
            </div>
          </>
        )}
      </div>

      {/* ─── Generador de Copy (manual, intacto) ────────────────────────────── */}
      <div style={{ background: '#0d1117', border: '1px solid rgba(79,142,247,0.2)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>✍️ Agent-Neuro-Copywriter</div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 12 }}>Genera copies de alta conversión con neuromarketing</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={copyTopic}
            onChange={e => setCopyTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && generateCopy()}
            placeholder="Ej: Curso de trading algorítmico para principiantes..."
            style={{ flex: 1, background: '#161b22', border: '1px solid #1e2433', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#e6edf3', outline: 'none' }}
          />
          <button
            onClick={generateCopy}
            disabled={copyLoading || !copyTopic.trim()}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: copyLoading ? '#1e2433' : '#4f8ef7', color: copyLoading ? '#8b949e' : '#000', opacity: !copyTopic.trim() ? 0.5 : 1 }}
          >
            {copyLoading ? '⏳…' : '✍️ Generar'}
          </button>
        </div>
        {copyResult && (
          <div style={{ background: '#161b22', border: '1px solid #1e2433', borderRadius: 8, padding: 12, fontSize: 12, color: '#c9d1d9', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>
            {copyResult}
          </div>
        )}
      </div>

      {/* ─── SEO Research (manual, intacto) ─────────────────────────────────── */}
      <div style={{ background: '#0d1117', border: '1px solid rgba(79,142,247,0.2)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 4 }}>🔍 Agent-SEO-Dominator</div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 12 }}>Keyword research con volumen, dificultad e intención de búsqueda</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={seoQuery}
            onChange={e => setSeoQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSEO()}
            placeholder="Ej: trading algorítmico, marketing digital..."
            style={{ flex: 1, background: '#161b22', border: '1px solid #1e2433', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#e6edf3', outline: 'none' }}
          />
          <button
            onClick={runSEO}
            disabled={seoLoading || !seoQuery.trim()}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: seoLoading ? '#1e2433' : '#4f8ef7', color: seoLoading ? '#8b949e' : '#000', opacity: !seoQuery.trim() ? 0.5 : 1 }}
          >
            {seoLoading ? '⏳…' : '🔍 Analizar'}
          </button>
        </div>
        {seoResults && (
          <div style={{ background: '#161b22', border: '1px solid #1e2433', borderRadius: 8, padding: 12, fontSize: 12, color: '#c9d1d9', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 250, overflowY: 'auto', fontFamily: 'monospace' }}>
            {seoResults}
          </div>
        )}
      </div>

      {/* ─── Funnel + Afiliados (manual, intacto) ───────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>📊 Funnel de Conversión</div>
          {[
            { label: 'Tripwire ($7)',   value: 0, color: '#4f8ef7' },
            { label: 'Core Offer ($47)', value: 0, color: '#a78bfa' },
            { label: 'Upsell ($197)',   value: 0, color: '#f0b429' },
            { label: 'Remarketing',    value: 0, color: '#00c896' },
          ].map(item => (
            <div key={item.label} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#8b949e' }}>{item.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>{item.value} ventas</span>
              </div>
              <div style={{ height: 4, background: '#161b22', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(item.value, 0)}%`, background: item.color, borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>💰 Agent-Affiliate-Scout</div>
            <button
              onClick={searchAffiliates}
              disabled={affiliateSearching}
              style={{ fontSize: 11, background: affiliateSearching ? '#1e2433' : 'rgba(79,142,247,0.15)', border: '1px solid rgba(79,142,247,0.3)', color: affiliateSearching ? '#8b949e' : '#4f8ef7', padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}
            >
              {affiliateSearching ? '⏳ Buscando…' : '🔎 Escanear'}
            </button>
          </div>
          {affiliateResults.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {affiliateResults.slice(0, 6).map((r, i) => (
                <div key={i} style={{ fontSize: 12, color: '#c9d1d9', padding: '6px 10px', background: '#161b22', borderRadius: 6 }}>{r}</div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 20, color: '#8b949e', fontSize: 12, border: '1px dashed #1e2433', borderRadius: 8 }}>
              Agent-Affiliate-Scout listo para escanear ClickBank, Hotmart y Amazon Associates
            </div>
          )}
        </div>
      </div>

      {/* ─── Actividad robots (existente, intacto) ─────────────────────────── */}
      {robotLogs.length > 0 && (
        <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>🤖 Actividad de Robots de Marketing</div>
          {robotLogs.map((log: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e2433' }}>
              <span style={{ fontSize: 11, color: '#8b949e', fontFamily: 'monospace' }}>{log.type ?? log.action ?? JSON.stringify(log)}</span>
              <span style={{ fontSize: 10, color: log.status === 'done' ? '#00c896' : '#f0b429' }}>{log.status ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}