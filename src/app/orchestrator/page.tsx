'use client';
import { useEffect, useState } from 'react';
import { Brain, Zap, AlertTriangle, CheckCircle, Clock, Plus, RefreshCw, Download, Activity } from 'lucide-react';

interface OrchestratorReport {
  timestamp: number;
  ecosystemHealth: number;
  totalCompanies: number;
  totalAgents: number;
  agentsOnProbation: string[];
  agentsDead: string[];
  opportunities: string[];
  alerts: string[];
  actions: string[];
}

interface LogEntry {
  action: string;
  timestamp: number;
}

export default function OrchestratorPage() {
  const [report, setReport] = useState<OrchestratorReport | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [diagnosis, setDiagnosis] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [diagnosing, setDiagnosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [result, setResult] = useState<any>(null);
  const [workerCode, setWorkerCode] = useState<string>('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [reportRes, logRes] = await Promise.all([
        fetch('/api/orchestrator?action=analyze'),
        fetch('/api/orchestrator?action=log'),
      ]);
      const reportData = await reportRes.json();
      const logData = await logRes.json();
      setReport(reportData);
      setLog(logData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const runDiagnosis = async () => {
    setDiagnosing(true);
    try {
      const res = await fetch('/api/orchestrator?action=diagnose');
      const data = await res.json();
      setDiagnosis(data.diagnosis);
    } catch (e) {
      setDiagnosis('Error al ejecutar diagnóstico.');
    } finally {
      setDiagnosing(false);
    }
  };

  const createCompany = async () => {
    if (!description.trim()) return;
    setCreating(true);
    setResult(null);
    try {
      const res = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_company', description, type: companyType }),
      });
      const data = await res.json();
      setResult(data);
      setWorkerCode(data.workerCode || '');
      await fetchData();
    } catch (e) {
      setResult({ error: 'Error al crear empresa' });
    } finally {
      setCreating(false);
    }
  };

  const downloadWorker = () => {
    const blob = new Blob([workerCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'worker.py';
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => { fetchData(); }, []);

  const healthColor = (h: number) =>
    h >= 80 ? 'text-emerald-400' : h >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-start border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
            <Brain className="w-7 h-7 text-purple-400" />
            Orquestador Inteligente
          </h1>
          <p className="text-sm text-slate-400 mt-1">Motor autónomo de creación, evaluación y evolución de empresas y agentes.</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg text-sm transition-colors">
          <RefreshCw className="w-4 h-4" />
          Actualizar
        </button>
      </div>

      {report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Salud del Ecosistema</p>
            <p className={`text-3xl font-bold mt-1 ${healthColor(report.ecosystemHealth)}`}>{report.ecosystemHealth}%</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Empresas Activas</p>
            <p className="text-3xl font-bold text-cyan-400 mt-1">{report.totalCompanies}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Agentes Totales</p>
            <p className="text-3xl font-bold text-blue-400 mt-1">{report.totalAgents}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">En Probatoria</p>
            <p className="text-3xl font-bold text-yellow-400 mt-1">{report.agentsOnProbation.length}</p>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-purple-500/20 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
          <Plus className="w-5 h-5 text-purple-400" />
          Crear Empresa desde Descripción
        </h2>
        <p className="text-sm text-slate-400">Describe tu idea y el orquestador generará la empresa completa con 9 agentes, reglas de consenso y código del worker.</p>
        <div className="space-y-3">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Ej: Quiero una empresa de dropshipping automatizado enfocada en productos de tecnología para el mercado latinoamericano..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors resize-none h-28"
          />
          <div className="flex gap-3">
            <select value={companyType} onChange={e => setCompanyType(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-purple-500 transition-colors">
              <option value="">Detectar tipo automáticamente</option>
              <option value="trading">Trading Algorítmico</option>
              <option value="marketing">Marketing Digital</option>
              <option value="cinematography">Cinematografía</option>
              <option value="custom">Personalizado</option>
            </select>
            <button onClick={createCompany} disabled={creating || !description.trim()}
              className="flex items-center gap-2 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-6 py-2 rounded-lg text-sm transition-colors">
              <Zap className="w-4 h-4" />
              {creating ? 'El Orquestador está trabajando...' : 'Instanciar Empresa'}
            </button>
          </div>
        </div>

        {result && !result.error && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Empresa creada exitosamente
              </h3>
              {workerCode && (
                <button onClick={downloadWorker} className="flex items-center gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
                  <Download className="w-3.5 h-3.5" />
                  Descargar worker.py
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-slate-500 text-xs">Nombre</p>
                <p className="text-slate-200 font-medium">{result.company?.name}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Tipo</p>
                <p className="text-slate-200 font-medium">{result.company?.type}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Agentes generados</p>
                <p className="text-slate-200 font-medium">{result.agents?.length || 0}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Dashboard</p>
                <a href={`/companies/${result.company?.id}`} className="text-purple-400 hover:underline font-medium">
                  /companies/{result.company?.id}
                </a>
              </div>
            </div>
            {result.agents && (
              <div className="space-y-2 mt-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Agentes instanciados:</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {result.agents.map((agent: any, i: number) => (
                    <div key={i} className="bg-slate-900 rounded-lg px-3 py-2 flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${agent.hasVeto ? 'bg-red-400' : 'bg-emerald-400'}`} />
                      <div>
                        <p className="text-xs font-medium text-slate-200">{agent.name}</p>
                        <p className="text-[10px] text-slate-500">{agent.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {result?.error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
            Error: {result.error}
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            Autodiagnóstico con IA
          </h2>
          <button onClick={runDiagnosis} disabled={diagnosing}
            className="flex items-center gap-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            <Brain className="w-4 h-4" />
            {diagnosing ? 'Analizando...' : 'Analizar ahora'}
          </button>
        </div>
        {diagnosis ? (
          <div className="bg-slate-950 rounded-lg p-4 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed border border-slate-800">
            {diagnosis}
          </div>
        ) : (
          <p className="text-sm text-slate-500">El orquestador analizará tu ecosistema con IA y te dará las 3 acciones más urgentes.</p>
        )}
      </div>

      {report && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
              Alertas del Sistema
            </h3>
            {report.alerts.length > 0 ? (
              <div className="space-y-2">
                {report.alerts.map((alert, i) => (
                  <div key={i} className="text-xs text-slate-400 bg-yellow-500/5 border border-yellow-500/10 rounded-lg px-3 py-2">{alert}</div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Sin alertas activas.</p>
            )}
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              Oportunidades Detectadas
            </h3>
            {report.opportunities.length > 0 ? (
              <div className="space-y-2">
                {report.opportunities.map((opp, i) => (
                  <div key={i} className="text-xs text-slate-400 bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2">{opp}</div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Analizando oportunidades...</p>
            )}
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-400" />
          Log de Acciones Autónomas
        </h3>
        {log.length > 0 ? (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {log.map((entry, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-slate-800/60 text-xs">
                <span className="text-slate-600 shrink-0 font-mono">{new Date(entry.timestamp).toLocaleTimeString('es-ES')}</span>
                <span className="text-slate-400">{entry.action}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Sin acciones registradas todavía.</p>
        )}
      </div>
    </div>
  );
}