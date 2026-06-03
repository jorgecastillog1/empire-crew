'use client';
import React, { useEffect, useState } from 'react';
import { Building2, Cpu, Activity, ShieldCheck, Radio, AlertTriangle, CheckCircle, TrendingUp, Zap, Bell } from 'lucide-react';
import { EmpireFactory3DToggle } from '@/app/components/EmpireFactory3D';
import { Company } from '@/lib/db';

interface SSELog { action: string; timestamp: number; }
interface SSEEcosystem { companies: number; agents: number; health: number; timestamp: number; }
interface Approval { id: string; action: string; status: string; requestedAt: number; }

export default function GlobalDashboard() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [ecosystem, setEcosystem] = useState<SSEEcosystem>({ companies: 0, agents: 0, health: 100, timestamp: 0 });
  const [logs, setLogs] = useState<SSELog[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [connected, setConnected] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [updatingCompanyId, setUpdatingCompanyId] = useState<string | null>(null); // ← NUEVO: para mostrar carga

  // Cargar empresas al inicio
  const loadCompanies = async () => {
    try {
      const res = await fetch('/api/companies');
      const data = await res.json();
      setCompanies(data);
    } catch (error) {
      console.error('Error al cargar empresas:', error);
    }
  };

  // Función para cambiar el estado de encendido/apagado de una empresa
  const toggleCompanyEnabled = async (companyId: string, currentEnabled: boolean | undefined) => {
    setUpdatingCompanyId(companyId);
    const newEnabled = !(currentEnabled ?? true); // Si no existe enabled, asumimos true
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (res.ok) {
        // Recargar la lista de empresas para reflejar el cambio
        await loadCompanies();
      } else {
        console.error('Error al actualizar estado');
      }
    } catch (error) {
      console.error('Error de red:', error);
    } finally {
      setUpdatingCompanyId(null);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  // SSE (EventSource) para datos en tiempo real
  useEffect(() => {
    const es = new EventSource('/api/sse');
    es.addEventListener('ecosystem', (e) => {
      setEcosystem(JSON.parse(e.data));
      setConnected(true);
      setPulse(p => !p);
    });
    es.addEventListener('logs', (e) => {
      const { logs } = JSON.parse(e.data);
      setLogs(logs ?? []);
    });
    es.addEventListener('approvals', (e) => {
      const { approvals } = JSON.parse(e.data);
      setApprovals(approvals ?? []);
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const totalAgents = companies.reduce((a, c) => a + (c.agents?.length || 0), 0);

  const getLogColor = (action: string) => {
    if (action.includes('error') || action.includes('fail')) return 'text-red-400';
    if (action.includes('reincarnate') || action.includes('probation')) return 'text-amber-400';
    if (action.includes('done') || action.includes('ok')) return 'text-emerald-400';
    return 'text-cyan-400';
  };

  const getLogIcon = (action: string) => {
    if (action.includes('error') || action.includes('fail')) return '❌';
    if (action.includes('telegram')) return '📨';
    if (action.includes('evaluate')) return '📊';
    if (action.includes('reincarnate')) return '♻️';
    if (action.includes('company')) return '🏢';
    if (action.includes('thoth')) return '🔧';
    return '⚡';
  };

  const timeAgo = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return 'Hace ' + diff + 's';
    if (diff < 3600) return 'Hace ' + Math.floor(diff / 60) + 'm';
    return 'Hace ' + Math.floor(diff / 3600) + 'h';
  };

  return (
    <div className="p-6 space-y-6 min-h-screen bg-slate-950">

      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Panel de Control</h1>
          <p className="text-sm text-slate-400 mt-1">Ecosistema de empresas autónomas — datos en vivo</p>
        </div>
        <EmpireFactory3DToggle
          companies={companies.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            health: 0.85,
            agents: c.agents?.length ?? 0,
          }))}
          onSelectCompany={(cid) => window.location.href = `/companies/${cid}`}
        />
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium border ${connected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          {connected ? 'En Vivo' : 'Desconectado'}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Empresas Activas</p>
          <div className="flex items-baseline justify-between">
            <span className="text-4xl font-bold text-cyan-400">{companies.length}</span>
            <Building2 className="w-5 h-5 text-slate-600" />
          </div>
          <p className="text-xs text-slate-500 mt-2">+0 esta semana</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Agentes Activos</p>
          <div className="flex items-baseline justify-between">
            <span className="text-4xl font-bold text-blue-400">{totalAgents}</span>
            <Cpu className="w-5 h-5 text-slate-600" />
          </div>
          <p className="text-xs text-slate-500 mt-2">0 en probatoria</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Salud Ecosistema</p>
          <div className="flex items-baseline justify-between">
            <span className="text-4xl font-bold text-emerald-400">{ecosystem.health}%</span>
            <Activity className="w-5 h-5 text-emerald-500 animate-pulse" />
          </div>
          <div className="mt-2 h-1.5 bg-slate-800 rounded-full">
            <div className="h-1.5 bg-emerald-400 rounded-full transition-all duration-1000" style={{ width: ecosystem.health + '%' }} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Estado de Red</p>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-purple-400">Operational</span>
            <Radio className="w-5 h-5 text-purple-400 animate-pulse" />
          </div>
          <p className="text-xs text-slate-500 mt-2">SSE activo</p>
        </div>
      </div>

      {/* Approvals pendientes */}
      {approvals.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-400">Aprobaciones Pendientes ({approvals.length})</h2>
          </div>
          <div className="space-y-2">
            {approvals.map((a) => (
              <div key={a.id} className="flex justify-between items-center bg-slate-900/50 px-4 py-2 rounded-lg text-sm">
                <span className="text-slate-300">{a.action}</span>
                <div className="flex gap-2">
                  <button className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-lg text-xs hover:bg-emerald-500/30 transition-colors">Aprobar</button>
                  <button className="px-3 py-1 bg-red-500/20 text-red-400 rounded-lg text-xs hover:bg-red-500/30 transition-colors">Rechazar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Empresas — tarjetas con botón de encendido/apagado */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-cyan-400" /> Subsidiarias Activas
          </h2>
          <div className="space-y-3">
            {companies.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-4">No hay empresas. Crea una en Instanciar Empresa.</p>
            )}
            {companies.map((c) => {
              const isEnabled = c.enabled !== undefined ? c.enabled : true; // si no existe, asumimos encendida
              const isUpdating = updatingCompanyId === c.id;
              return (
                <div key={c.id} className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors group">
                  <a href={`/companies/${c.id}`} className="flex-1">
                    <p className="text-sm font-medium text-slate-200 group-hover:text-cyan-400 transition-colors">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.type} · {c.agents?.length ?? 0} agentes</p>
                  </a>
                  {/* Botón de encendido/apagado */}
                  <button
                    onClick={() => toggleCompanyEnabled(c.id, c.enabled)}
                    disabled={isUpdating}
                    className={`ml-3 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      isEnabled
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                        : 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isUpdating ? '...' : (isEnabled ? '🔛 Encendida' : '🔒 Apagada')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Logs en tiempo real */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            Actividad del Orquestador
            <span className="ml-auto text-xs text-slate-500">En vivo</span>
          </h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {logs.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-4">Sin actividad reciente.</p>
            )}
            {logs.map((log, i) => (
              <div key={i} className="flex justify-between items-start text-xs py-2 border-b border-slate-800/50">
                <div className="flex items-start gap-2">
                  <span>{getLogIcon(log.action)}</span>
                  <span className={getLogColor(log.action)}>{log.action}</span>
                </div>
                <span className="text-slate-600 shrink-0 ml-2">{timeAgo(log.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}