'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';

interface Candle {
  time: any;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface AgentSignal {
  type: 'EXECUTE_LONG' | 'EXECUTE_SHORT' | 'WAIT' | 'CASH';
  confidence: number;
  reasoning: string;
  entryPrice: number;
  stopLoss: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  agents: {
    liquidity: string;
    cvd: string;
    session: string;
    smartMoney: string;
    funding: string;
  };
}

interface LiquidityLevel {
  price: number;
  strength: number;
  direction: 'UP' | 'DOWN';
}

interface FVG {
  high: number;
  low: number;
  direction: 'UP' | 'DOWN';
}

export default function TradingChart({ symbol = 'BTCUSDT' }: { symbol?: string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<any>(null);
  const volumeSeries = useRef<any>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [signal, setSignal] = useState<AgentSignal | null>(null);
  const [liquidity, setLiquidity] = useState<{ above: LiquidityLevel[]; below: LiquidityLevel[] } | null>(null);
  const [fvgs, setFvgs] = useState<FVG[]>([]);
  const [cvd, setCvd] = useState<{ divergence: boolean; divergenceType: string; type: string; signal: string } | null>(null);
  const [session, setSession] = useState<{ currentSession: string; sessionBias: string; recommendation: string } | null>(null);
  const [funding, setFunding] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [interval, setIntervalState] = useState<'5m' | '15m' | '1h' | '4h'>('1h');

  // ─── Fetch candles ────────────────────────────────────────
  const fetchCandles = useCallback(async () => {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=200`);
      const data = await res.json();
      const formatted: Candle[] = data.map((k: any[]) => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
      setCandles(formatted);
      if (candleSeries.current) candleSeries.current.setData(formatted);
      if (volumeSeries.current) {
        volumeSeries.current.setData(formatted.map(c => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(0,200,150,0.3)' : 'rgba(255,80,80,0.3)',
        })));
      }
    } catch (e) { console.error('Candles error:', e); }
  }, [symbol, interval]);

  // ─── Fetch agent signals ──────────────────────────────────
  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const [metaRes, liquidityRes, cvdRes, sessionRes, fundingRes, smartRes] = await Promise.all([
        fetch(`/api/trading?action=meta&symbol=${symbol}`).then(r => r.json()),
        fetch(`/api/trading?action=liquidity&symbol=${symbol}`).then(r => r.json()),
        fetch(`/api/trading?action=cvd&symbol=${symbol}`).then(r => r.json()),
        fetch(`/api/trading?action=session&symbol=${symbol}`).then(r => r.json()),
        fetch(`/api/trading?action=funding`).then(r => r.json()),
        fetch(`/api/trading?action=smart_money&symbol=${symbol}`).then(r => r.json()),
      ]);

      setSignal({
        type: metaRes.decision ?? 'WAIT',
        confidence: metaRes.confidence ?? 0,
        reasoning: metaRes.reasoning ?? '',
        entryPrice: metaRes.entryPrice ?? 0,
        stopLoss: metaRes.stopLoss ?? 0,
        agents: {
          liquidity: liquidityRes.bias ?? 'N/A',
          cvd: cvdRes.divergenceType ?? 'NONE',
          session: sessionRes.sessionBias ?? 'N/A',
          smartMoney: smartRes.whaleActivity ?? 'N/A',
          funding: fundingRes.pairs?.find((p: any) => p.symbol === symbol)?.confluence ?? 'NEUTRAL',
        },
      });

      setLiquidity({
        above: (liquidityRes.liquidityAbove ?? []).map((l: any) => ({ ...l, direction: 'UP' as const })),
        below: (liquidityRes.liquidityBelow ?? []).map((l: any) => ({ ...l, direction: 'DOWN' as const })),
      });

      setFvgs(smartRes.fairValueGaps ?? []);
      setCvd(cvdRes);
      setSession(sessionRes);
      setFunding(fundingRes.pairs ?? []);
      setLastUpdate(new Date());
    } catch (e) { console.error('Signals error:', e); }
    setLoading(false);
  }, [symbol]);

  // ─── Send signal to Telegram ──────────────────────────────
  const sendToTelegram = useCallback(async () => {
  if (!signal) return;
  try {
    await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'notify',   // ← CAMBIADO DE 'send' A 'notify'
        message: `🤖 *EMPIRE TRADING SIGNAL*\n\n` +
          `📊 *${symbol}* — ${signal.type}\n` +
          `🎯 Confianza: ${signal.confidence}%\n` +
          `💰 Entrada: $${signal.entryPrice.toLocaleString()}\n` +
          `🛑 Stop Loss: $${signal.stopLoss.toLocaleString()}\n\n` +
          `📡 *Señales de Agentes:*\n` +
          `• Liquidez: ${signal.agents.liquidity}\n` +
          `• CVD Delta: ${signal.agents.cvd}\n` +
          `• Sesión: ${signal.agents.session}\n` +
          `• Smart Money: ${signal.agents.smartMoney}\n` +
          `• Funding/OI: ${signal.agents.funding}\n\n` +
          `💭 ${signal.reasoning}\n\n` +
          `⏰ ${new Date().toLocaleString('es-CO')}`,
      }),
    });
    alert('✅ Señal enviada a Telegram');
  } catch (e) { alert('❌ Error enviando a Telegram'); }
}, [signal, symbol]);

  // ─── Init chart ───────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    chart.current = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 420,
      layout: { background: { color: '#0f1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#1e2433' }, horzLines: { color: '#1e2433' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#1e2433' },
      timeScale: { borderColor: '#1e2433', timeVisible: true },
    });

    candleSeries.current = chart.current.addSeries(CandlestickSeries, {
      upColor: '#00c896', downColor: '#ff5050',
      borderUpColor: '#00c896', borderDownColor: '#ff5050',
      wickUpColor: '#00c896', wickDownColor: '#ff5050',
    });

    volumeSeries.current = chart.current.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.current.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const handleResize = () => {
      if (chartRef.current && chart.current) {
        chart.current.applyOptions({ width: chartRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); chart.current?.remove(); };
  }, []);

  useEffect(() => { fetchCandles(); fetchSignals(); }, [fetchCandles, fetchSignals]);
  // ─── Price lines: Entry, SL, TP1/2/3 ─────────────────────────────────────
useEffect(() => {
  if (!candleSeries.current || !signal || signal.type === 'WAIT') return;
  const isLong = signal.type === 'EXECUTE_LONG';
  const lines = [
    { price: signal.entryPrice, color: '#ffffff', title: 'Entrada' },
    { price: signal.stopLoss,   color: '#ff5050', title: 'SL' },
    { price: signal.tp1 ?? 0,   color: '#00c896', title: 'TP1' },
    { price: signal.tp2 ?? 0,   color: '#00c896', title: 'TP2' },
    { price: signal.tp3 ?? 0,   color: '#00c896', title: 'TP3' },
  ].filter(l => l.price > 0);

  lines.forEach(l => {
    candleSeries.current.createPriceLine({
      price: l.price,
      color: l.color,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: l.title,
    });
  });
}, [signal]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { fetchCandles(); fetchSignals(); }, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchCandles, fetchSignals]);

  const signalColor = signal?.type === 'EXECUTE_LONG' ? '#00c896' :
    signal?.type === 'EXECUTE_SHORT' ? '#ff5050' :
    signal?.type === 'WAIT' ? '#f0b429' : '#8b949e';

  const signalBg = signal?.type === 'EXECUTE_LONG' ? 'rgba(0,200,150,0.1)' :
    signal?.type === 'EXECUTE_SHORT' ? 'rgba(255,80,80,0.1)' :
    signal?.type === 'WAIT' ? 'rgba(240,180,41,0.1)' : 'rgba(139,148,158,0.1)';

  return (
    <div style={{ background: '#0f1117', borderRadius: 16, padding: 20, color: '#c9d1d9' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, color: '#fff', fontWeight: 700 }}>{symbol}</h2>
          <span style={{ fontSize: 12, color: '#8b949e' }}>
            {lastUpdate ? `Actualizado: ${lastUpdate.toLocaleTimeString('es-CO')}` : 'Cargando...'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['5m', '15m', '1h', '4h'] as const).map(tf => (
            <button key={tf} onClick={() => setIntervalState(tf)} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: interval === tf ? '#00c896' : '#1e2433', color: interval === tf ? '#000' : '#8b949e',
              fontWeight: interval === tf ? 700 : 400,
            }}>{tf}</button>
          ))}
          <button onClick={() => { fetchCandles(); fetchSignals(); }} style={{
            padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: '#1e2433', color: '#8b949e',
          }}>🔄</button>
          <button onClick={() => setAutoRefresh(!autoRefresh)} style={{
            padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: autoRefresh ? 'rgba(0,200,150,0.2)' : '#1e2433',
            color: autoRefresh ? '#00c896' : '#8b949e',
          }}>{autoRefresh ? '⏸ Auto' : '▶ Auto'}</button>
        </div>
      </div>

      {/* Chart */}
      <div ref={chartRef} style={{ width: '100%', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }} />

      {/* Main Signal */}
      <div style={{ background: signalBg, border: `1px solid ${signalColor}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontSize: 18, fontWeight: 800, color: signalColor,
              background: `${signalColor}22`, padding: '4px 16px', borderRadius: 8,
            }}>
              {signal?.type === 'EXECUTE_LONG' ? '🟢 LONG' :
               signal?.type === 'EXECUTE_SHORT' ? '🔴 SHORT' :
               signal?.type === 'WAIT' ? '🟡 ESPERAR' : '⚪ CASH'}
            </span>
            <div>
              <div style={{ fontSize: 13, color: '#8b949e' }}>Confianza</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: signalColor }}>{signal?.confidence ?? 0}%</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#8b949e' }}>Entrada</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>${signal?.entryPrice.toLocaleString() ?? '—'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#8b949e' }}>Stop Loss</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#ff5050' }}>${signal?.stopLoss.toLocaleString() ?? '—'}</div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: '#8b949e', fontStyle: 'italic' }}>{signal?.reasoning}</div>
      </div>

      {/* Agent Signals Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
        {[
          { label: '🌊 Liquidez', value: signal?.agents.liquidity, icon: '📊' },
          { label: '📈 CVD Delta', value: signal?.agents.cvd, icon: '⚡' },
          { label: '🕐 Sesión', value: signal?.agents.session, icon: '🌍' },
          { label: '🐋 Smart Money', value: signal?.agents.smartMoney, icon: '💎' },
          { label: '💸 Funding/OI', value: signal?.agents.funding, icon: '🔄' },
        ].map(({ label, value }) => {
          const isPositive = value === 'BULLISH' || value === 'ACCUMULATING' || value === 'SHORT_SQUEEZE' || value === 'BULLISH_DIV';
          const isNegative = value === 'BEARISH' || value === 'DISTRIBUTING' || value === 'LONG_SQUEEZE' || value === 'BEARISH_DIV';
          const color = isPositive ? '#00c896' : isNegative ? '#ff5050' : '#f0b429';
          return (
            <div key={label} style={{ background: '#1e2433', borderRadius: 8, padding: '10px 12px', border: `1px solid ${color}33` }}>
              <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color }}>{value ?? '—'}</div>
            </div>
          );
        })}
      </div>

      {/* Session + CVD Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={{ background: '#1e2433', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 8 }}>🕐 Sesión Actual</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Sesión</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#a78bfa' }}>{session?.currentSession ?? '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Bias</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: session?.sessionBias === 'BULLISH' ? '#00c896' : session?.sessionBias === 'BEARISH' ? '#ff5050' : '#f0b429' }}>
              {session?.sessionBias ?? '—'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#8b949e', fontStyle: 'italic', marginTop: 6 }}>{session?.recommendation ?? '—'}</div>
        </div>

        <div style={{ background: '#1e2433', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 8 }}>⚡ CVD Delta</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Divergencia</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: cvd?.divergence ? '#ff5050' : '#00c896' }}>
              {cvd?.divergence ? '⚠️ DETECTADA' : '✅ NINGUNA'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Tipo</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: cvd?.divergenceType === 'BEARISH_DIV' ? '#ff5050' : cvd?.divergenceType === 'BULLISH_DIV' ? '#00c896' : '#8b949e' }}>
              {cvd?.divergenceType ?? 'NONE'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#8b949e' }}>Señal</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: cvd?.signal === 'BUY' ? '#00c896' : cvd?.signal === 'SELL' ? '#ff5050' : '#f0b429' }}>
              {cvd?.signal ?? '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Funding Rates */}
      {funding.length > 0 && (
        <div style={{ background: '#1e2433', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>💸 Funding Rate + Open Interest</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {funding.slice(0, 5).map((f: any) => (
              <div key={f.symbol} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>{f.symbol.replace('USDT', '')}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: f.fundingRate > 0 ? '#ff5050' : '#00c896' }}>
                  {(f.fundingRate * 100).toFixed(4)}%
                </div>
                <div style={{ fontSize: 10, color: '#8b949e' }}>{f.annualized?.toFixed(1)}% APR</div>
                <div style={{ fontSize: 10, marginTop: 2, color: f.confluence === 'LONG_SQUEEZE' ? '#ff5050' : f.confluence === 'SHORT_SQUEEZE' ? '#00c896' : '#8b949e' }}>
                  {f.confluence}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FVGs */}
      {fvgs.length > 0 && (
        <div style={{ background: '#1e2433', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>📐 Fair Value Gaps</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {fvgs.slice(0, 4).map((fvg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: fvg.direction === 'UP' ? 'rgba(0,200,150,0.1)' : 'rgba(255,80,80,0.1)', borderRadius: 6 }}>
                <span style={{ fontSize: 12, color: fvg.direction === 'UP' ? '#00c896' : '#ff5050', fontWeight: 600 }}>
                  {fvg.direction === 'UP' ? '▲ FVG Alcista' : '▼ FVG Bajista'}
                </span>
                <span style={{ fontSize: 12, color: '#c9d1d9' }}>${fvg.low.toLocaleString()} — ${fvg.high.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Telegram Button */}
      <button onClick={sendToTelegram} disabled={!signal || loading} style={{
        width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
        background: signal ? 'linear-gradient(135deg, #2196f3, #00c896)' : '#1e2433',
        color: '#fff', fontSize: 15, fontWeight: 700,
        opacity: !signal || loading ? 0.5 : 1,
     }}>
       📱 Enviar Señal a Telegram
     </button>

      {loading && (
        <div style={{ textAlign: 'center', padding: 16, color: '#8b949e', fontSize: 13 }}>
          ⏳ Analizando mercado con 9 agentes elite...
        </div>
      )}
    </div>
  );
}