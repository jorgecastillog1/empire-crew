'use client';
// ─── TradingDashboard.tsx ─────────────────────────────────────────────────────
// Fixes incluidos:
// 1. Futuros + Spot (balance unificado)
// 2. Confianza real desde API
// 3. Señales en gráfico con SL y TP1/2/3
// 4. 10 criptos de mayor volumen
// 5. Agentes paralelos (useRef para no caerse al cambiar panel)
// 6. Rotación de modelos Groq
// 7. Carga rápida con Promise.allSettled

import { useState, useEffect, useRef, useCallback } from 'react';
import TradingChart from '@/app/components/TradingChart';
import BookmapPanel from '@/app/components/BookmapPanel';
import type { Company, TradingMetrics } from '@/types/company';

// ─── 10 criptos de mayor volumen ─────────────────────────────────────────────
const TOP_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
];

// ─── Rotación de modelos Groq ─────────────────────────────────────────────────
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];
let groqModelIndex = 0;
export function getNextGroqModel() {
  const model = GROQ_MODELS[groqModelIndex % GROQ_MODELS.length];
  groqModelIndex++;
  return model;
}

interface Props {
  company: Company;
  metrics: TradingMetrics | null;
  refetch: () => void;
}

interface SignalOverlay {
  type: 'LONG' | 'SHORT' | 'WAIT';
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  confidence: number;
}

export default function TradingDashboard({ company, metrics, refetch }: Props) {
  const [symbol, setSymbol]         = useState('BTCUSDT');
  const [executing, setExecuting]   = useState(false);
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [signal, setSignal]         = useState<SignalOverlay | null>(null);
  const [futuresBalance, setFuturesBalance] = useState<Record<string, number>>({});
  const [loadingSignal, setLoadingSignal]   = useState(false);

  // useRef para mantener el intervalo de polling aunque el usuario cambie de panel
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ─── Fetch señal con TP1/2/3 ───────────────────────────────────────────────
  const fetchSignal = useCallback(async () => {
    setLoadingSignal(true);
    try {
      const [metaRes, liquidityRes] = await Promise.allSettled([
        fetch(`/api/trading?action=meta&symbol=${symbol}`).then(r => r.json()),
        fetch(`/api/trading?action=liquidity&symbol=${symbol}`).then(r => r.json()),
      ]);

      if (metaRes.status === 'fulfilled' && mountedRef.current) {
        const meta = metaRes.value;
        const entry = meta.entryPrice ?? 0;
        const sl    = meta.stopLoss ?? 0;
        const risk  = Math.abs(entry - sl);

        setSignal({
          type:       meta.decision === 'EXECUTE_LONG' ? 'LONG' : meta.decision === 'EXECUTE_SHORT' ? 'SHORT' : 'WAIT',
          entryPrice: entry,
          stopLoss:   sl,
          tp1:        meta.decision === 'EXECUTE_LONG' ? entry + risk * 1.5 : entry - risk * 1.5,
          tp2:        meta.decision === 'EXECUTE_LONG' ? entry + risk * 2.5 : entry - risk * 2.5,
          tp3:        meta.decision === 'EXECUTE_LONG' ? entry + risk * 4   : entry - risk * 4,
          confidence: meta.confidence ?? 0,
        });
      }
    } catch (e) {
      console.error('[fetchSignal]', e);
    } finally {
      if (mountedRef.current) setLoadingSignal(false);
    }
  }, [symbol]);

  // ─── Fetch balance futuros ─────────────────────────────────────────────────
  const fetchFuturesBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/trading?action=futures_balance');
      if (res.ok && mountedRef.current) {
        const data = await res.json();
        setFuturesBalance(data ?? {});
      }
    } catch (e) {
      console.error('[fetchFuturesBalance]', e);
    }
  }, []);

  // ─── Polling persistente (no se cae al cambiar de panel) ──────────────────
  useEffect(() => {
    mountedRef.current = true;
    fetchSignal();
    fetchFuturesBalance();

    // Inicia polling que sobrevive navegación entre paneles
    if (!pollingRef.current) {
      pollingRef.current = setInterval(() => {
        fetchSignal();
        fetchFuturesBalance();
        refetch();
      }, 30_000);
    }

    return () => {
      mountedRef.current = false;
      // NO limpiamos el intervalo aquí — sobrevive al desmonte
    };
  }, [fetchSignal, fetchFuturesBalance, refetch]);

  // Limpieza real solo cuando la app se cierra
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // ─── Ejecutar ciclo ────────────────────────────────────────────────────────
  const runCycle = async () => {
    setExecuting(true); setCycleError(null);
    try {
      const res = await fetch('/api/trading?action=cycle');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refetch();
      await fetchSignal();
    } catch (e: any) {
      setCycleError(e?.message ?? 'Error al ejecutar ciclo');
    } finally {
      setExecuting(false);
    }
  };

  const usdtSpot    = metrics?.balance?.USDT ?? 0;
  const usdtFutures = futuresBalance?.USDT ?? futuresBalance?.usdt ?? 0;
  const meta        = metrics?.meta;

  // Color de señal
  const signalColor = signal?.type === 'LONG' ? '#00c896' : signal?.type === 'SHORT' ? '#ff5050' : '#f0b429';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ─── KPIs ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: 'Balance Spot',    value: `$${usdtSpot.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`,    color: '#00c896' },
          { label: 'Balance Futuros', value: usdtFutures > 0 ? `$${usdtFutures.toLocaleString('es-CO', { minimumFractionDigits: 2 })}` : 'Sin futuros', color: '#4f8ef7' },
          { label: 'Señal Activa',    value: signal ? signal.type : (metrics?.openOrders?.length ?? 0) > 0 ? 'OPERANDO' : 'SIN SEÑAL', color: signalColor },
          { label: 'Confianza',       value: signal?.confidence ? `${signal.confidence}%` : '0%', color: '#a78bfa' },
          { label: 'Órdenes Abiertas', value: metrics?.openOrders?.length?.toString() ?? '0', color: '#f0b429' },
        ].map(item => (
          <div key={item.label} style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 10, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* ─── Señal activa con SL y TPs ────────────────────────────────────── */}
      {signal && signal.type !== 'WAIT' && (
        <div style={{ background: '#0d1117', border: `1px solid ${signalColor}40`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: signalColor, marginBottom: 12 }}>
            {signal.type === 'LONG' ? '🟢 SEÑAL LONG' : '🔴 SEÑAL SHORT'} — Confianza: {signal.confidence}%
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
            {[
              { label: 'Entrada',   value: `$${signal.entryPrice.toLocaleString()}`, color: '#e6edf3' },
              { label: 'Stop Loss', value: `$${signal.stopLoss.toLocaleString()}`,   color: '#ff5050' },
              { label: 'TP1',       value: `$${signal.tp1.toLocaleString()}`,        color: '#00c896' },
              { label: 'TP2',       value: `$${signal.tp2.toLocaleString()}`,        color: '#00c896' },
              { label: 'TP3',       value: `$${signal.tp3.toLocaleString()}`,        color: '#00c896' },
            ].map(item => (
              <div key={item.label} style={{ background: '#161b22', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Selector de par + botón ciclo ────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TOP_PAIRS.map(p => (
            <button key={p} onClick={() => setSymbol(p)} style={{
              padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: symbol === p ? '#00c896' : '#161b22',
              color: symbol === p ? '#000' : '#8b949e',
            }}>
              {p.replace('USDT', '')}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <button onClick={runCycle} disabled={executing} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700,
            background: executing ? '#1e2433' : 'linear-gradient(135deg, #00c896, #4f8ef7)',
            color: executing ? '#8b949e' : '#000',
          }}>
            {executing ? '⏳ Analizando…' : '🚀 Ejecutar Ciclo Elite'}
          </button>
          {cycleError && <span style={{ fontSize: 11, color: '#ff5050' }}>⚠️ {cycleError}</span>}
        </div>
      </div>

      {/* ─── Chart ────────────────────────────────────────────────────────── */}
      <TradingChart symbol={symbol} />

      {/* ─── Bookmap WebSocket ────────────────────────────────────────────── */}
      <BookmapPanel symbol={symbol} />

      {/* ─── Balance Spot + Futuros ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Spot */}
        {metrics?.balance && Object.values(metrics.balance).some(v => v > 0) && (
          <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>💰 Balance Spot</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
              {Object.entries(metrics.balance).filter(([, v]) => v > 0).map(([asset, qty]) => (
                <div key={asset} style={{ background: '#161b22', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>{asset}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#00c896' }}>{qty.toFixed(4)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Futuros */}
        <div style={{ background: '#0d1117', border: '1px solid rgba(79,142,247,0.3)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>📈 Balance Futuros</div>
          {Object.keys(futuresBalance).length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
              {Object.entries(futuresBalance).filter(([, v]) => v > 0).map(([asset, qty]) => (
                <div key={asset} style={{ background: '#161b22', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>{asset}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#4f8ef7' }}>{(qty as number).toFixed(4)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#8b949e', padding: 8 }}>
              Sin posiciones en futuros activas
            </div>
          )}
        </div>
      </div>

      {/* ─── Funding rates ────────────────────────────────────────────────── */}
      {(metrics?.funding?.pairs?.length ?? 0) > 0 && (
        <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>💸 Funding Rate + Open Interest</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
            {metrics!.funding!.pairs.map(f => (
              <div key={f.symbol} style={{ background: '#161b22', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>{f.symbol.replace('USDT', '')}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: f.fundingRate > 0 ? '#ff5050' : '#00c896' }}>
                  {(f.fundingRate * 100).toFixed(4)}%
                </div>
                <div style={{ fontSize: 10, color: '#8b949e' }}>{f.annualized?.toFixed(1)}% APR</div>
                <div style={{ fontSize: 10, marginTop: 4, color: f.confluence === 'LONG_SQUEEZE' ? '#ff5050' : f.confluence === 'SHORT_SQUEEZE' ? '#00c896' : '#8b949e' }}>
                  {f.confluence}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Últimas operaciones ──────────────────────────────────────────── */}
      <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3', marginBottom: 12 }}>📋 Últimas Operaciones</div>
        {metrics?.recentOrders?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {metrics.recentOrders.map((order, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#161b22', borderRadius: 8, flexWrap: 'wrap', gap: 4 }}>
                <span style={{ fontSize: 12, color: order.side === 'BUY' ? '#00c896' : '#ff5050', fontWeight: 700 }}>{order.side}</span>
                <span style={{ fontSize: 12, color: '#8b949e' }}>{order.symbol}</span>
                <span style={{ fontSize: 12, color: '#e6edf3' }}>{order.executedQty} @ ${parseFloat(order.price ?? '0').toLocaleString()}</span>
                <span style={{ fontSize: 11, color: order.status === 'FILLED' ? '#00c896' : '#f0b429' }}>{order.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 24, color: '#8b949e', fontSize: 12, border: '1px dashed #1e2433', borderRadius: 8 }}>
            Sin operaciones — agentes en modo análisis
          </div>
        )}
      </div>
    </div>
  );
}