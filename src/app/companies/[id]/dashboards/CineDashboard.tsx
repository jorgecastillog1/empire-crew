'use client';
// ─── CineDashboard.tsx ────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Company } from '@/types/company';

interface Props { company: Company; }

interface VideoJob {
  id?: string;
  status: 'queued' | 'processing' | 'done' | 'error' | string;
  prompt?: string;
  url?: string;
}

const MYTHOLOGIES = [
  'Griega','Nórdica','Egipcia','Azteca','Maya','Celta',
  'Japonesa','China','India','Mesopotámica','Eslava','Yoruba',
  'Inca','Persa','Fenicia','Romana','Polinesia',
];

const PIPELINE = ['Guión','Prompts Visuales','Generación Video','Post-Producción','Publicación'];

export default function CineDashboard({ company }: Props) {
  const [prompt, setPrompt]       = useState('');
  const [style, setStyle]         = useState('cinematic');
  const [duration, setDuration]   = useState('5');
  const [generating, setGenerating] = useState(false);
  const [result, setResult]       = useState<any>(null);
  const [genError, setGenError]   = useState('');
  const [jobs, setJobs]           = useState<VideoJob[]>([]);
  const [selectedMythology, setSelectedMythology] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // ─── Carga de cola de videos ───────────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/video?action=queue&companyId=${company.id}`);
      if (res.ok && mountedRef.current) {
        const data = await res.json();
        setJobs(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, [company.id]);

  useEffect(() => {
    mountedRef.current = true;
    fetchJobs();
    // Polling de cola cada 15s — persiste aunque se cambie de panel
    const t = setInterval(fetchJobs, 15_000);
    return () => {
      mountedRef.current = false;
      clearInterval(t);
    };
  }, [fetchJobs]);

  // ─── Generar video ─────────────────────────────────────────────────────────
  const generate = async () => {
  if (!prompt.trim()) return;
  setGenerating(true); setGenError(''); setResult(null);
  try {
    const res = await fetch('/api/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productDescription: selectedMythology
          ? `[Mitología ${selectedMythology}] ${prompt.trim()} — Estilo: ${style}, Duración: ${duration}s`
          : `${prompt.trim()} — Estilo: ${style}, Duración: ${duration}s`,
        companyId: company.id,
        platform: 'tiktok',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setResult(data);
    fetchJobs();
  } catch (e: any) {
    setGenError(e.message ?? 'Error desconocido');
  } finally {
    setGenerating(false);
  }
};

  const videosGenerated = jobs.filter(j => j.status === 'done').length;
  const videosInQueue   = jobs.filter(j => j.status !== 'done').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ─── KPIs ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: 'Videos Generados', value: videosGenerated.toString(), color: '#f0b429' },
          { label: 'En Cola',          value: videosInQueue.toString(),   color: '#a78bfa' },
          { label: 'Universos Activos', value: '17',                      color: '#4f8ef7' },
          { label: 'Pipeline',         value: company.metric,             color: '#00c896' },
        ].map(item => (
          <div key={item.label} style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* ─── Generador de Video ───────────────────────────────────────────── */}
      <div style={{ background: '#0d1117', border: '1px solid rgba(240,180,41,0.2)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3', marginBottom: 12 }}>🎬 Generador de Video con IA</div>

        {/* Mitología seleccionada */}
        {selectedMythology && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: '#f0b429', background: 'rgba(240,180,41,0.1)', border: '1px solid rgba(240,180,41,0.2)', padding: '4px 10px', borderRadius: 6 }}>
              🏛️ {selectedMythology}
            </span>
            <button onClick={() => setSelectedMythology(null)} style={{ fontSize: 10, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}>✕ quitar</button>
          </div>
        )}

        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Describe la escena: Un guerrero espartano en las puertas del Olimpo, cielo tormentoso, rayos de Zeus iluminando el horizonte..."
          rows={3}
          style={{ width: '100%', background: '#161b22', border: '1px solid #1e2433', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#e6edf3', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 12 }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>Estilo Visual</div>
            <select value={style} onChange={e => setStyle(e.target.value)} style={{ width: '100%', background: '#161b22', border: '1px solid #1e2433', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#e6edf3', outline: 'none' }}>
              {['cinematic','anime','realistic','fantasy','documentary','noir'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>Duración</div>
            <select value={duration} onChange={e => setDuration(e.target.value)} style={{ width: '100%', background: '#161b22', border: '1px solid #1e2433', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#e6edf3', outline: 'none' }}>
              {['3','5','10'].map(d => <option key={d} value={d}>{d}s</option>)}
            </select>
          </div>
          <button onClick={generate} disabled={generating || !prompt.trim()} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
            background: generating ? '#1e2433' : 'linear-gradient(135deg, #f0b429, #ff6b35)',
            color: generating ? '#8b949e' : '#000',
            opacity: !prompt.trim() ? 0.5 : 1,
          }}>
            {generating ? '⏳ Generando…' : '🎬 Generar Video'}
          </button>
        </div>

        {genError && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.2)', borderRadius: 8, fontSize: 12, color: '#ff5050' }}>
            ❌ {genError}
          </div>
        )}

        {result && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(240,180,41,0.08)', border: '1px solid rgba(240,180,41,0.2)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#f0b429', marginBottom: 6 }}>✅ Job creado: {result.id}</div>
            {(result.cloudinaryUrl ?? result.videoUrl)
              ? <video controls style={{ width: '100%', borderRadius: 8, marginTop: 8 }} src={result.cloudinaryUrl ?? result.videoUrl} />
              : <div style={{ fontSize: 11, color: '#8b949e' }}>Estado: {result.status} — procesando en segundo plano</div>
            }
          </div>
        )}
    </div>
      {/* ─── Pipeline + Audiencia ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>🎬 Pipeline de Producción</div>
          {PIPELINE.map((stage, i) => (
            <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < PIPELINE.length - 1 ? '1px solid #1e2433' : 'none' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? '#f0b429' : '#1e2433', boxShadow: i === 0 ? '0 0 8px #f0b429' : 'none' }} />
              <span style={{ fontSize: 12, color: i === 0 ? '#f0b429' : '#8b949e' }}>{stage}</span>
              {i === 0 && <span style={{ fontSize: 10, color: '#f0b429', marginLeft: 'auto' }}>En espera</span>}
            </div>
          ))}
        </div>
        <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>📺 Audiencia por Plataforma</div>
          {['TikTok','Instagram','YouTube'].map(p => (
            <div key={p} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1e2433' }}>
              <span style={{ fontSize: 12, color: '#8b949e' }}>{p}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>0</span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Universos Mitológicos ────────────────────────────────────────── */}
      <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>⚡ Universos Mitológicos — clic para activar en prompt</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {MYTHOLOGIES.map(m => (
            <span key={m} onClick={() => setSelectedMythology(m === selectedMythology ? null : m)} style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
              background: selectedMythology === m ? 'rgba(240,180,41,0.25)' : 'rgba(240,180,41,0.1)',
              color: selectedMythology === m ? '#fff' : '#f0b429',
              border: `1px solid ${selectedMythology === m ? '#f0b429' : 'rgba(240,180,41,0.2)'}`,
              fontWeight: selectedMythology === m ? 700 : 400,
            }}>
              {m}
            </span>
          ))}
        </div>
      </div>

      {/* ─── Cola de videos ───────────────────────────────────────────────── */}
      {jobs.length > 0 && (
        <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>🎞️ Cola de Videos ({jobs.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {jobs.map((job, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#161b22', borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: '#8b949e', fontFamily: 'monospace' }}>{job.id ?? `job-${i}`}</span>
                <span style={{ fontSize: 10, color: job.status === 'done' ? '#00c896' : job.status === 'error' ? '#ff5050' : '#f0b429' }}>
                  {job.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}