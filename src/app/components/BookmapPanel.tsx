'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

interface BookLevel { price: number; qty: number; }
interface LiveBook { bids: BookLevel[]; asks: BookLevel[]; }

const WS_BASE = 'wss://stream.binance.com:9443/ws';
const MAX_LEVELS = 10;
const INSTITUTIONAL_RATIO = 0.4;

function getHeatColor(qty: number, maxQty: number, side: 'bid' | 'ask'): string {
  const intensity = Math.min(qty / maxQty, 1);
  const isInst = intensity >= INSTITUTIONAL_RATIO;
  if (side === 'bid') return isInst
    ? `rgba(0,200,150,${0.35 + intensity * 0.65})`
    : `rgba(0,200,150,${intensity * 0.25})`;
  return isInst
    ? `rgba(255,80,80,${0.35 + intensity * 0.65})`
    : `rgba(255,80,80,${intensity * 0.25})`;
}

export default function BookmapPanel({ symbol }: { symbol: string }) {
  const [book, setBook]           = useState<LiveBook>({ bids: [], asks: [] });
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError]     = useState<string | null>(null);
  const wsRef      = useRef<WebSocket | null>(null);
  const retryRef   = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    const ws = new WebSocket(`${WS_BASE}/${symbol.toLowerCase()}@depth20@100ms`);
    wsRef.current = ws;

    ws.onopen  = () => { setConnected(true); setWsError(null); retryRef.current = 0; };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string);
        const parse = (arr: string[][]): BookLevel[] =>
          arr.map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) }));
        setBook({
          bids: parse(data.bids ?? []).slice(0, MAX_LEVELS),
          asks: parse(data.asks ?? []).slice(0, MAX_LEVELS),
        });
      } catch {}
    };
    ws.onerror = () => { setWsError('Stream interrumpido'); setConnected(false); };
    ws.onclose = () => {
      setConnected(false);
      const delay = Math.min(1000 * 2 ** retryRef.current, 30_000);
      retryRef.current += 1;
      timeoutRef.current = setTimeout(connect, delay);
    };
  }, [symbol]);

  useEffect(() => {
    connect();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [connect]);

  const allQtys   = [...book.bids, ...book.asks].map(l => l.qty);
  const maxQty    = Math.max(...allQtys, 1);
  const maxBidQty = Math.max(...book.bids.map(l => l.qty), 1);
  const maxAskQty = Math.max(...book.asks.map(l => l.qty), 1);
  const instThreshold = maxQty * INSTITUTIONAL_RATIO;
  const topBidWall = [...book.bids].sort((a, b) => b.qty - a.qty)[0];
  const topAskWall = [...book.asks].sort((a, b) => b.qty - a.qty)[0];
  const midPrice   = book.bids[0] && book.asks[0]
    ? (book.bids[0].price + book.asks[0].price) / 2 : 0;

  return (
    <div style={{ background: '#0d1117', border: '1px solid #1e2433', borderRadius: 12, padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>🔥 Bookmap — Liquidez Institucional</span>
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>WebSocket en tiempo real · {symbol}</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {midPrice > 0 && <span style={{ fontSize: 14, fontWeight: 800, color: '#e6edf3' }}>${midPrice.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#00c896' : '#ff5050', boxShadow: connected ? '0 0 6px #00c896' : 'none' }} />
            <span style={{ fontSize: 10, color: connected ? '#00c896' : '#ff5050' }}>
              {connected ? 'WS Activo' : wsError ?? 'Reconectando…'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['#00c896','■ Compras'],['#ff5050','■ Ventas'],['#f0b429','★ Inst.']].map(([c,l]) => (
              <span key={l} style={{ fontSize: 10, color: c, background: `${c}18`, padding: '2px 8px', borderRadius: 4 }}>{l}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Muros institucionales */}
      {(topBidWall || topAskWall) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {topBidWall && (
            <div style={{ background: 'rgba(0,200,150,0.08)', border: '1px solid rgba(0,200,150,0.2)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 4 }}>💚 MURO COMPRA INSTITUCIONAL</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#00c896' }}>${topBidWall.price.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>{topBidWall.qty.toFixed(4)} {symbol.replace('USDT','')}</div>
            </div>
          )}
          {topAskWall && (
            <div style={{ background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.2)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 4 }}>❤️ MURO VENTA INSTITUCIONAL</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#ff5050' }}>${topAskWall.price.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>{topAskWall.qty.toFixed(4)} {symbol.replace('USDT','')}</div>
            </div>
          )}
        </div>
      )}

      {book.bids.length === 0 && book.asks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: '#8b949e', fontSize: 12 }}>
          {connected ? 'Esperando datos del stream…' : 'Conectando al stream de Binance…'}
        </div>
      ) : (
        <div>
          {/* ASKS descendente */}
          {[...book.asks].reverse().map(({ price, qty }, i) => {
            const isInst = qty >= instThreshold;
            return (
              <div key={`ask-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, position: 'relative', borderRadius: 4, overflow: 'hidden', padding: '4px 8px' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${(qty/maxAskQty)*100}%`, background: getHeatColor(qty, maxQty, 'ask'), transition: 'width 0.1s linear' }} />
                {isInst && <span style={{ position: 'relative', fontSize: 10, color: '#f0b429' }}>★</span>}
                <span style={{ position: 'relative', fontSize: 11, color: '#ff5050', fontWeight: isInst ? 800 : 400, flex: 1 }}>${price.toLocaleString()}</span>
                <span style={{ position: 'relative', fontSize: 11, color: '#8b949e', minWidth: 80, textAlign: 'right' }}>{qty.toFixed(4)}</span>
                <span style={{ position: 'relative', fontSize: 10, color: '#8b949e', minWidth: 80, textAlign: 'right' }}>${(price*qty).toLocaleString('es-CO',{maximumFractionDigits:0})}</span>
              </div>
            );
          })}

          {/* Precio medio */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px', background: '#161b22', borderRadius: 6, margin: '4px 0' }}>
            <div style={{ flex: 1, height: 1, background: '#1e2433' }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: '#e6edf3' }}>${midPrice.toLocaleString('es-CO',{minimumFractionDigits:2})}</span>
            <div style={{ flex: 1, height: 1, background: '#1e2433' }} />
          </div>

          {/* BIDS */}
          {book.bids.map(({ price, qty }, i) => {
            const isInst = qty >= instThreshold;
            return (
              <div key={`bid-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, position: 'relative', borderRadius: 4, overflow: 'hidden', padding: '4px 8px' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${(qty/maxBidQty)*100}%`, background: getHeatColor(qty, maxQty, 'bid'), transition: 'width 0.1s linear' }} />
                {isInst && <span style={{ position: 'relative', fontSize: 10, color: '#f0b429' }}>★</span>}
                <span style={{ position: 'relative', fontSize: 11, color: '#00c896', fontWeight: isInst ? 800 : 400, flex: 1 }}>${price.toLocaleString()}</span>
                <span style={{ position: 'relative', fontSize: 11, color: '#8b949e', minWidth: 80, textAlign: 'right' }}>{qty.toFixed(4)}</span>
                <span style={{ position: 'relative', fontSize: 10, color: '#8b949e', minWidth: 80, textAlign: 'right' }}>${(price*qty).toLocaleString('es-CO',{maximumFractionDigits:0})}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}