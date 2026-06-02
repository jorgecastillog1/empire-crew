import { redis } from '@/lib/redis';
import { logOrchestratorAction } from '@/lib/orchestrator';
import crypto from 'crypto';

// ============================================================
// BINANCE — Conexión directa (sin proxy)
// ============================================================

const SPOT_URL = 'https://api.binance.com';
const FUTURES_URL = 'https://fapi.binance.com';
const API_KEY = process.env.BINANCE_API_KEY ?? '';
const SECRET_KEY = process.env.BINANCE_SECRET_KEY ?? '';

function sign(queryString: string): string {
  return crypto.createHmac('sha256', SECRET_KEY).update(queryString).digest('hex');
}

async function binanceRequest(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  params: Record<string, any> = {},
  signed = false,
  isFutures = false
): Promise<any> {
  let queryString = new URLSearchParams(params).toString();

  if (signed) {
    const timestamp = Date.now();
    queryString += (queryString ? '&' : '') + 'timestamp=' + timestamp;
    queryString += '&signature=' + sign(queryString);
  }

  const baseUrl = isFutures ? FUTURES_URL : SPOT_URL;
  const url = baseUrl + endpoint + (method === 'GET' && queryString ? '?' + queryString : '');

  const res = await fetch(url, {
    method,
    headers: {
      'X-MBX-APIKEY': API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method !== 'GET' ? queryString : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error('Binance error: ' + (data.msg ?? JSON.stringify(data)));
  return data;
}

// ─── Precio actual ────────────────────────────────────────────
export async function getPrice(symbol: string): Promise<number> {
  const data = await binanceRequest('GET', '/api/v3/ticker/price', { symbol });
  return parseFloat(data.price);
}

// ─── Precios múltiples ────────────────────────────────────────
export async function getPrices(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  for (const symbol of symbols) {
    try { prices[symbol] = await getPrice(symbol); }
    catch { prices[symbol] = 0; }
  }
  return prices;
}

// ─── Balance de la cuenta (Spot) ──────────────────────────────
export async function getAccountBalance(): Promise<Record<string, number>> {
  console.log('🔍 [SPOT] Iniciando getAccountBalance');
  console.log('🔑 [SPOT] API_KEY presente:', !!API_KEY);
  console.log('🔑 [SPOT] SECRET_KEY presente:', !!SECRET_KEY);
  
  try {
    const data = await binanceRequest('GET', '/api/v3/account', {}, true, false);
    console.log('✅ [SPOT] Respuesta completa de Binance:', JSON.stringify(data, null, 2));
    
    const balances: Record<string, number> = {};
    for (const b of data.balances ?? []) {
      const free = parseFloat(b.free);
      if (free > 0) balances[b.asset] = free;
    }
    console.log('💰 [SPOT] Balances filtrados (con saldo >0):', balances);
    return balances;
  } catch (error: any) {
    console.error('❌ [SPOT] Error en getAccountBalance:', error.message);
    return {};
  }
}

// ─── Balance de Futuros ───────────────────────────────────────
export async function getFuturesBalance(): Promise<Record<string, number>> {
  console.log('🔍 [FUTURES] Iniciando getFuturesBalance');
  console.log('🔑 [FUTURES] API_KEY presente:', !!API_KEY);
  console.log('🔑 [FUTURES] SECRET_KEY presente:', !!SECRET_KEY);
  
  if (!API_KEY || !SECRET_KEY) {
    console.error('❌ [FUTURES] Faltan claves API de Binance');
    return {};
  }
  
  try {
    const timestamp = Date.now();
    let queryString = `timestamp=${timestamp}`;
    queryString += `&signature=${sign(queryString)}`;
    const url = `${FUTURES_URL}/fapi/v2/account?${queryString}`;
    console.log('🌐 [FUTURES] URL de la petición:', url);
    
    const res = await fetch(url, {
      headers: { 'X-MBX-APIKEY': API_KEY },
    });
    
    console.log('📡 [FUTURES] Código de respuesta HTTP:', res.status);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`❌ [FUTURES] Error HTTP ${res.status}: ${errorText}`);
      return {};
    }
    
    const data = await res.json();
    console.log('✅ [FUTURES] Respuesta completa de Binance:', JSON.stringify(data, null, 2));
    
    const balances: Record<string, number> = {};
    for (const b of data.assets ?? []) {
      const free = parseFloat(b.availableBalance);
      if (free > 0) balances[b.asset] = free;
    }
    console.log('💰 [FUTURES] Balances filtrados (con saldo >0):', balances);
    return balances;
  } catch (error: any) {
    console.error('❌ [FUTURES] Excepción en getFuturesBalance:', error.message);
    return {};
  }
}

// ─── Klines / Velas (Spot) ───────────────────────────────────
export async function getKlines(
  symbol: string,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '1h',
  limit = 100
): Promise<{ open: number; high: number; low: number; close: number; volume: number; timestamp: number }[]> {
  const data = await binanceRequest('GET', '/api/v3/klines', { symbol, interval, limit }, false, false);
  return data.map((k: any[]) => ({
    timestamp: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// ─── Indicadores técnicos (sin cambios) ──────────────────────
export function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const rs = gains / (losses || 1);
  return 100 - 100 / (1 + rs);
}

export function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

export function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.2 + macd * 0.8;
  return { macd, signal, histogram: macd - signal };
}

export function calcBollinger(closes: number[], period = 20): { upper: number; middle: number; lower: number } {
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period);
  return { upper: middle + 2 * std, middle, lower: middle - 2 * std };
}

export async function analyzeSymbol(symbol: string): Promise<{
  symbol: string;
  price: number;
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  bollinger: { upper: number; middle: number; lower: number };
  ema20: number;
  ema50: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  timestamp: number;
}> {
  const klines = await getKlines(symbol, '1h', 100);
  const closes = klines.map(k => k.close);
  const price = closes[closes.length - 1];

  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const bollinger = calcBollinger(closes);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);

  let buySignals = 0, sellSignals = 0;
  if (rsi < 30) buySignals++;
  if (rsi > 70) sellSignals++;
  if (macd.histogram > 0) buySignals++;
  if (macd.histogram < 0) sellSignals++;
  if (price < bollinger.lower) buySignals++;
  if (price > bollinger.upper) sellSignals++;
  if (ema20 > ema50) buySignals++;
  if (ema20 < ema50) sellSignals++;

  const total = buySignals + sellSignals;
  const confidence = total > 0 ? Math.max(buySignals, sellSignals) / total * 100 : 50;
  const signal: 'BUY' | 'SELL' | 'HOLD' = buySignals > sellSignals ? 'BUY' : sellSignals > buySignals ? 'SELL' : 'HOLD';

  const result = { symbol, price, rsi, macd, bollinger, ema20, ema50, signal, confidence: Math.round(confidence), timestamp: Date.now() };
  await redis.set('trading:analysis:' + symbol, JSON.stringify(result), { ex: 300 });
  await logOrchestratorAction('binance:analyze:' + symbol + ':' + signal);

  return result;
}

// ─── Funding rates (futuros) ─────────────────────────────────
export async function getFundingRates(symbols: string[]): Promise<Record<string, number>> {
  const rates: Record<string, number> = {};
  for (const symbol of symbols) {
    try {
      const res = await fetch(`${FUTURES_URL}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
      const data = await res.json();
      rates[symbol] = parseFloat(data[0]?.fundingRate ?? '0');
    } catch { rates[symbol] = 0; }
  }
  return rates;
}

// ─── Ejecutar orden (Spot) ───────────────────────────────────
export async function placeOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  type: 'MARKET' | 'LIMIT' = 'MARKET',
  price?: number
): Promise<any> {
  const params: Record<string, any> = { symbol, side, type, quantity };
  if (type === 'LIMIT' && price) {
    params.price = price;
    params.timeInForce = 'GTC';
  }
  const order = await binanceRequest('POST', '/api/v3/order', params, true, false);
  await logOrchestratorAction('binance:order:' + side + ':' + symbol + ':' + quantity);
  await redis.lpush('trading:orders', JSON.stringify({ ...order, timestamp: Date.now() }));
  await redis.ltrim('trading:orders', 0, 199);
  return order;
}

// ─── Orden en Futuros ────────────────────────────────────────
export async function placeFuturesOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  leverage: number = 10,
  type: 'MARKET' | 'LIMIT' = 'MARKET',
  price?: number
): Promise<any> {
  try {
    // Configurar apalancamiento
    const levTimestamp = Date.now();
    let levQuery = `symbol=${symbol}&leverage=${leverage}&timestamp=${levTimestamp}`;
    levQuery += '&signature=' + sign(levQuery);
    await fetch(`${FUTURES_URL}/fapi/v1/leverage`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: levQuery,
    });

    // Colocar orden
    const timestamp = Date.now();
    const params: Record<string, any> = { symbol, side, type, quantity };
    if (type === 'LIMIT' && price) { params.price = price; params.timeInForce = 'GTC'; }
    let queryString = new URLSearchParams(params).toString();
    queryString += '&timestamp=' + timestamp;
    queryString += '&signature=' + sign(queryString);

    const res = await fetch(`${FUTURES_URL}/fapi/v1/order`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: queryString,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error('Futures order error: ' + JSON.stringify(err));
    }

    const order = await res.json();
    await logOrchestratorAction('binance:futures:' + side + ':' + symbol + ':' + quantity + ':lev' + leverage);
    await redis.lpush('trading:orders', JSON.stringify({ ...order, futures: true, timestamp: Date.now() }));
    await redis.ltrim('trading:orders', 0, 199);
    return order;
  } catch (e: any) {
    await logOrchestratorAction('binance:futures:error:' + e.message);
    throw e;
  }
}

// ─── Órdenes abiertas (Spot) ─────────────────────────────────
export async function getOpenOrders(symbol?: string): Promise<any[]> {
  const params = symbol ? { symbol } : {};
  return await binanceRequest('GET', '/api/v3/openOrders', params, true, false);
}

// ─── Historial de órdenes (Spot) ─────────────────────────────
export async function getOrderHistory(symbol: string, limit = 20): Promise<any[]> {
  return await binanceRequest('GET', '/api/v3/allOrders', { symbol, limit }, true, false);
}