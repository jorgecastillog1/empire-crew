import { redis } from '@/lib/redis';
import { callLLM, logOrchestratorAction } from '@/lib/orchestrator';
import { getKlines, getAccountBalance, placeOrder, placeFuturesOrder, getFuturesBalance, getOpenOrders } from '@/lib/binance';
import { recordAgentEvent } from '@/lib/agentMonitor';
import { writeProof } from '@/lib/omk';

const COMPANY_ID = 'alpha-trading';
const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
const COINGLASS_KEY = process.env.COINGLASS_API_KEY ?? '';

// ============================================================
// 9 SUPER AGENTES ELITE — Alpha Trading Algorítmico
// ============================================================

// ─── Agente 1: Liquidity Map Agent ───────────────────────────
export async function runLiquidityMapAgent(symbol: string): Promise<{
  symbol: string;
  liquidityAbove: { price: number; strength: number }[];
  liquidityBelow: { price: number; strength: number }[];
  nearestTarget: { direction: 'UP' | 'DOWN'; price: number; strength: number };
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}> {
  const res = await fetch(`https://binance-proxy.trendtraderg11.workers.dev/api/v3/depth?symbol=${symbol}&limit=100`);
  const book = await res.json();

  const asks: [string, string][] = book.asks ?? [];
  const bids: [string, string][] = book.bids ?? [];
  const midPrice = (parseFloat(asks[0]?.[0] ?? '0') + parseFloat(bids[0]?.[0] ?? '0')) / 2;

  // Detectar muros de liquidez (acumulaciones grandes)
  const liquidityAbove = asks
    .map(([p, q]) => ({ price: parseFloat(p), strength: parseFloat(q) }))
    .filter(l => l.strength > 5)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5);

  const liquidityBelow = bids
    .map(([p, q]) => ({ price: parseFloat(p), strength: parseFloat(q) }))
    .filter(l => l.strength > 5)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5);

  const topAbove = liquidityAbove[0];
  const topBelow = liquidityBelow[0];

  const nearestTarget = !topAbove ? { direction: 'DOWN' as const, price: topBelow?.price ?? midPrice, strength: topBelow?.strength ?? 0 } :
    !topBelow ? { direction: 'UP' as const, price: topAbove.price, strength: topAbove.strength } :
    (topAbove.price - midPrice) < (midPrice - topBelow.price)
      ? { direction: 'UP' as const, price: topAbove.price, strength: topAbove.strength }
      : { direction: 'DOWN' as const, price: topBelow.price, strength: topBelow.strength };

  const bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    liquidityBelow.reduce((a, b) => a + b.strength, 0) > liquidityAbove.reduce((a, b) => a + b.strength, 0) * 1.3
      ? 'BULLISH'
      : liquidityAbove.reduce((a, b) => a + b.strength, 0) > liquidityBelow.reduce((a, b) => a + b.strength, 0) * 1.3
        ? 'BEARISH' : 'NEUTRAL';

  const result = { symbol, liquidityAbove, liquidityBelow, nearestTarget, bias };
  await redis.set('trading:liquidity:' + symbol, JSON.stringify(result), { ex: 60 });
  await recordAgentEvent('Agent-Liquidity-Map', COMPANY_ID, 'success', symbol + ':bias:' + bias);
  return result;
}

// ─── Agente 2: CVD Delta Agent ────────────────────────────────
export async function runCVDDeltaAgent(symbol: string): Promise<{
  symbol: string;
  cvd: number;
  delta: number;
  divergence: boolean;
  divergenceType: 'BEARISH_DIV' | 'BULLISH_DIV' | 'NONE';
  signal: 'BUY' | 'SELL' | 'HOLD';
}> {
  const klines = await getKlines(symbol, '5m', 50);
  let cvd = 0;
  const deltas: number[] = [];

  for (const k of klines) {
    const buyVol = k.volume * ((k.close - k.low) / (k.high - k.low || 1));
    const sellVol = k.volume - buyVol;
    const delta = buyVol - sellVol;
    cvd += delta;
    deltas.push(delta);
  }

  const recentDelta = deltas.slice(-5).reduce((a, b) => a + b, 0);
  const prices = klines.map(k => k.close);
  const priceUp = prices[prices.length - 1] > prices[prices.length - 6];
  const deltaUp = recentDelta > 0;

  const divergence = priceUp !== deltaUp;
  const divergenceType: 'BEARISH_DIV' | 'BULLISH_DIV' | 'NONE' =
    divergence ? (priceUp && !deltaUp ? 'BEARISH_DIV' : 'BULLISH_DIV') : 'NONE';

  const signal: 'BUY' | 'SELL' | 'HOLD' =
    divergenceType === 'BULLISH_DIV' ? 'BUY' :
    divergenceType === 'BEARISH_DIV' ? 'SELL' : 'HOLD';

  const result = { symbol, cvd: Math.round(cvd), delta: Math.round(recentDelta), divergence, divergenceType, signal };
  await redis.set('trading:cvd:' + symbol, JSON.stringify(result), { ex: 60 });
  await recordAgentEvent('Agent-CVD-Delta', COMPANY_ID, 'success', symbol + ':' + divergenceType);
  return result;
}

// ─── Agente 3: Funding + OI Confluence Agent ─────────────────
export async function runFundingOIAgent(): Promise<{
  pairs: {
    symbol: string;
    fundingRate: number;
    fundingAnnualized: number;
    openInterest: number;
    oiChange24h: number;
    confluence: 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | 'NEUTRAL';
    action: string;
  }[];
}> {
  const pairs = [];

  for (const symbol of PAIRS) {
    try {
      const [fundingRes, oiRes, oiHistRes] = await Promise.all([
        fetch(`https://binance-proxy.trendtraderg11.workers.dev/fapi/v1/premiumIndex?symbol=${symbol}`).then(r => r.json()),
        fetch(`https://binance-proxy.trendtraderg11.workers.dev/fapi/v1/openInterest?symbol=${symbol}`).then(r => r.json()),
        fetch(`https://binance-proxy.trendtraderg11.workers.dev/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=25`).then(r => r.json()),
      ]);

      const fundingRate = parseFloat(fundingRes.lastFundingRate ?? '0');
      const openInterest = parseFloat(oiRes.openInterest ?? '0');
      const oiHist: any[] = Array.isArray(oiHistRes) ? oiHistRes : [];
      const oiChange24h = oiHist.length >= 2
        ? ((oiHist[oiHist.length - 1].sumOpenInterest - oiHist[0].sumOpenInterest) / oiHist[0].sumOpenInterest) * 100
        : 0;

      const confluence: 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | 'NEUTRAL' =
        fundingRate > 0.001 && oiChange24h > 5 ? 'LONG_SQUEEZE' :
        fundingRate < -0.001 && oiChange24h > 5 ? 'SHORT_SQUEEZE' : 'NEUTRAL';

      const action =
        confluence === 'LONG_SQUEEZE' ? 'SHORT — longs atrapados, funding positivo extremo' :
        confluence === 'SHORT_SQUEEZE' ? 'LONG — shorts atrapados, funding negativo extremo' :
        'NEUTRAL — sin confluencia';

      pairs.push({
        symbol,
        fundingRate,
        fundingAnnualized: fundingRate * 3 * 365 * 100,
        openInterest,
        oiChange24h: Math.round(oiChange24h * 100) / 100,
        confluence,
        action,
      });
    } catch { continue; }
  }

  await redis.set('trading:funding_oi', JSON.stringify({ pairs, timestamp: Date.now() }), { ex: 300 });
  await recordAgentEvent('Agent-Funding-OI', COMPANY_ID, 'success', 'pairs:' + pairs.length);
  return { pairs };
}

// ─── Agente 4: Session Bias Agent ────────────────────────────
export async function runSessionBiasAgent(symbol: string): Promise<{
  currentSession: 'ASIA' | 'LONDON' | 'NEW_YORK' | 'OVERLAP';
  asiaRange: { high: number; low: number; mid: number };
  sessionBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  breakoutLevel: { up: number; down: number };
  recommendation: string;
}> {
  const hourUTC = new Date().getUTCHours();
  const currentSession: 'ASIA' | 'LONDON' | 'NEW_YORK' | 'OVERLAP' =
    hourUTC >= 0 && hourUTC < 8 ? 'ASIA' :
    hourUTC >= 8 && hourUTC < 13 ? 'LONDON' :
    hourUTC >= 13 && hourUTC < 17 ? 'OVERLAP' : 'NEW_YORK';

  const klines4h = await getKlines(symbol, '1h', 48);
  const asiaKlines = klines4h.filter(k => {
    const h = new Date(k.timestamp).getUTCHours();
    return h >= 0 && h < 8;
  });

  const asiaHigh = asiaKlines.length > 0 ? Math.max(...asiaKlines.map(k => k.high)) : klines4h[klines4h.length - 1].high;
  const asiaLow = asiaKlines.length > 0 ? Math.min(...asiaKlines.map(k => k.low)) : klines4h[klines4h.length - 1].low;
  const asiaMid = (asiaHigh + asiaLow) / 2;
  const currentPrice = klines4h[klines4h.length - 1].close;

  const sessionBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    currentPrice > asiaHigh ? 'BULLISH' :
    currentPrice < asiaLow ? 'BEARISH' : 'NEUTRAL';

  const recommendation =
    currentSession === 'LONDON' && sessionBias === 'NEUTRAL'
      ? 'Esperar ruptura del rango Asia — London kill zone activa'
      : currentSession === 'OVERLAP' && sessionBias === 'BULLISH'
        ? 'Tendencia alcista confirmada — buscar longs en retrocesos'
        : currentSession === 'NEW_YORK' && sessionBias === 'BEARISH'
          ? 'Sesión NY confirma bajista — evitar longs'
          : 'Monitorear — sin señal clara de sesión';

  const result = {
    currentSession,
    asiaRange: { high: asiaHigh, low: asiaLow, mid: asiaMid },
    sessionBias,
    breakoutLevel: { up: asiaHigh * 1.002, down: asiaLow * 0.998 },
    recommendation,
  };

  await redis.set('trading:session:' + symbol, JSON.stringify(result), { ex: 1800 });
  await recordAgentEvent('Agent-Session-Bias', COMPANY_ID, 'success', symbol + ':' + currentSession + ':' + sessionBias);
  return result;
}

// ─── Agente 5: Liquidation Heatmap Agent ─────────────────────
export async function runLiquidationHeatmapAgent(): Promise<{
  symbol: string;
  liquidationLevels: { price: number; side: 'LONG' | 'SHORT'; amount: number }[];
  nearestMagnet: { price: number; side: 'LONG' | 'SHORT'; distance: number };
  priceTarget: number;
}[]> {
  const results = [];

  for (const symbol of PAIRS.slice(0, 3)) {
    try {
      const res = await fetch(
        `https://open-api.coinglass.com/public/v2/liquidation_chart?symbol=${symbol.replace('USDT', '')}&interval=12h`,
        { headers: { 'coinglassSecret': COINGLASS_KEY } }
      );
      const data = await res.json();
      const chart = data?.data?.chart ?? [];

      const currentRes = await fetch(`https://binance-proxy.trendtraderg11.workers.dev/api/v3/ticker/price?symbol=${symbol}`);
      const currentData = await currentRes.json();
      const currentPrice = parseFloat(currentData.price ?? '0');

      const levels = chart.slice(-20).map((point: any) => ({
        price: parseFloat(point.price ?? '0'),
        side: parseFloat(point.longLiquidationUsd ?? '0') > parseFloat(point.shortLiquidationUsd ?? '0') ? 'LONG' as const : 'SHORT' as const,
        amount: Math.max(parseFloat(point.longLiquidationUsd ?? '0'), parseFloat(point.shortLiquidationUsd ?? '0')),
      })).filter((l: any) => l.price > 0 && l.amount > 0)
        .sort((a: any, b: any) => b.amount - a.amount);

      const nearest = levels.reduce((prev: any, curr: any) =>
        Math.abs(curr.price - currentPrice) < Math.abs(prev.price - currentPrice) ? curr : prev,
        levels[0] ?? { price: currentPrice, side: 'LONG', amount: 0 }
      );

      results.push({
        symbol,
        liquidationLevels: levels.slice(0, 5),
        nearestMagnet: { ...nearest, distance: Math.abs(nearest.price - currentPrice) / currentPrice * 100 },
        priceTarget: nearest.price,
      });
    } catch { continue; }
  }

  await redis.set('trading:liquidations', JSON.stringify(results), { ex: 1800 });
  await recordAgentEvent('Agent-Liquidation-Heatmap', COMPANY_ID, 'success', 'symbols:' + results.length);
  return results;
}

// ─── Agente 6: Smart Money Divergence Agent ──────────────────
export async function runSmartMoneyAgent(symbol: string): Promise<{
  symbol: string;
  fairValueGaps: { high: number; low: number; filled: boolean; direction: 'UP' | 'DOWN' }[];
  orderBlocks: { price: number; type: 'BULLISH' | 'BEARISH'; strength: number }[];
  whaleActivity: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL';
  signal: 'BUY' | 'SELL' | 'HOLD';
}> {
  const klines = await getKlines(symbol, '1h', 100);
  const fairValueGaps = [];
  const orderBlocks = [];

  for (let i = 1; i < klines.length - 1; i++) {
    const prev = klines[i - 1];
    const curr = klines[i];
    const next = klines[i + 1];

    // Fair Value Gap alcista: gap entre low de vela anterior y high de vela siguiente
    if (next.low > prev.high) {
      fairValueGaps.push({
        high: next.low,
        low: prev.high,
        filled: false,
        direction: 'UP' as const,
      });
    }

    // Fair Value Gap bajista
    if (next.high < prev.low) {
      fairValueGaps.push({
        high: prev.low,
        low: next.high,
        filled: false,
        direction: 'DOWN' as const,
      });
    }

    // Order Block: vela de volumen alto seguida de movimiento fuerte
    const volumeAvg = klines.slice(Math.max(0, i - 10), i).reduce((a, k) => a + k.volume, 0) / 10;
    if (curr.volume > volumeAvg * 2) {
      const isBullish = curr.close > curr.open;
      orderBlocks.push({
        price: isBullish ? curr.low : curr.high,
        type: isBullish ? 'BULLISH' as const : 'BEARISH' as const,
        strength: Math.round((curr.volume / volumeAvg) * 100) / 100,
      });
    }
  }

  // Actividad de ballenas via volumen de grandes velas
  const recentKlines = klines.slice(-20);
  const avgVol = recentKlines.reduce((a, k) => a + k.volume, 0) / recentKlines.length;
  const buyPressure = recentKlines.filter(k => k.close > k.open && k.volume > avgVol * 1.5).length;
  const sellPressure = recentKlines.filter(k => k.close < k.open && k.volume > avgVol * 1.5).length;

  const whaleActivity: 'ACCUMULATING' | 'DISTRIBUTING' | 'NEUTRAL' =
    buyPressure > sellPressure * 1.5 ? 'ACCUMULATING' :
    sellPressure > buyPressure * 1.5 ? 'DISTRIBUTING' : 'NEUTRAL';

  const recentFVGs = fairValueGaps.slice(-3);
  const signal: 'BUY' | 'SELL' | 'HOLD' =
    whaleActivity === 'ACCUMULATING' && recentFVGs.some(g => g.direction === 'UP') ? 'BUY' :
    whaleActivity === 'DISTRIBUTING' && recentFVGs.some(g => g.direction === 'DOWN') ? 'SELL' : 'HOLD';

  const result = {
    symbol,
    fairValueGaps: fairValueGaps.slice(-5),
    orderBlocks: orderBlocks.slice(-5).sort((a, b) => b.strength - a.strength),
    whaleActivity,
    signal,
  };

  await redis.set('trading:smart_money:' + symbol, JSON.stringify(result), { ex: 300 });
  await recordAgentEvent('Agent-Smart-Money', COMPANY_ID, 'success', symbol + ':' + whaleActivity);
  return result;
}

// ─── Agente 7: Risk & Position Sizing Agent ──────────────────
export async function runRiskPositionAgent(
  symbol: string,
  side: 'BUY' | 'SELL',
  entryPrice: number,
  stopLoss: number
): Promise<{
  approved: boolean;
  reason: string;
  positionSizeUSDT: number;
  positionSizeCoin: number;
  kellyFraction: number;
  riskAmount: number;
  riskRewardRatio: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
}> {
  const balance = await getAccountBalance();
  const totalUSDT = balance['USDT'] ?? 0;
  const openOrders = await getOpenOrders();

  const riskPerTrade = Math.abs(entryPrice - stopLoss) / entryPrice;
  const winRate = 0.55; // Estimado conservador
  const avgWin = riskPerTrade * 2;
  const avgLoss = riskPerTrade;

  // Kelly Criterion
  const kelly = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
  const kellyFraction = Math.min(kelly * 0.25, 0.05); // 25% Kelly, máx 5% capital

  const riskAmount = totalUSDT * kellyFraction;
  const positionSizeUSDT = riskAmount / riskPerTrade;
  const positionSizeCoin = positionSizeUSDT / entryPrice;

  const tp1 = side === 'BUY' ? entryPrice * (1 + riskPerTrade * 1.5) : entryPrice * (1 - riskPerTrade * 1.5);
  const tp2 = side === 'BUY' ? entryPrice * (1 + riskPerTrade * 2.5) : entryPrice * (1 - riskPerTrade * 2.5);
  const tp3 = side === 'BUY' ? entryPrice * (1 + riskPerTrade * 4) : entryPrice * (1 - riskPerTrade * 4);

  let approved = true;
  let reason = 'Trade aprobado — Kelly OK';

  if (totalUSDT < 10) { approved = false; reason = 'Balance insuficiente: ' + totalUSDT + ' USDT'; }
  if (openOrders.length >= 5) { approved = false; reason = 'Máximo 5 órdenes abiertas'; }
  if (kellyFraction <= 0) { approved = false; reason = 'Kelly negativo — no operar'; }
  if (positionSizeUSDT < 1) { approved = false; reason = 'Posición demasiado pequeña'; }

  const result = {
    approved, reason,
    positionSizeUSDT: Math.round(positionSizeUSDT * 100) / 100,
    positionSizeCoin: Math.round(positionSizeCoin * 10000) / 10000,
    kellyFraction: Math.round(kellyFraction * 10000) / 100,
    riskAmount: Math.round(riskAmount * 100) / 100,
    riskRewardRatio: 2.5,
    takeProfit1: Math.round(tp1 * 100) / 100,
    takeProfit2: Math.round(tp2 * 100) / 100,
    takeProfit3: Math.round(tp3 * 100) / 100,
  };

  await redis.set('trading:risk:' + symbol, JSON.stringify(result), { ex: 300 });
  await recordAgentEvent('Agent-Risk-Position', COMPANY_ID, approved ? 'success' : 'missed_opportunity', symbol + ':kelly:' + kellyFraction.toFixed(4));
  return result;
}

// ─── Agente 8: Execution & Slippage Agent ────────────────────
export async function runExecutionAgent(
  symbol: string,
  side: 'BUY' | 'SELL',
  positionSizeUSDT: number,
  entryPrice: number,
  stopLoss: number
): Promise<{ executed: boolean; orders: any[]; totalSlippage: number; error?: string }> {
  try {
    const risk = await runRiskPositionAgent(symbol, side, entryPrice, stopLoss);
    if (!risk.approved) {
      await recordAgentEvent('Agent-Execution', COMPANY_ID, 'missed_opportunity', risk.reason);
      return { executed: false, orders: [], totalSlippage: 0, error: risk.reason };
    }

    // TWAP: dividir orden en 3 partes para minimizar slippage
    const partSize = risk.positionSizeCoin / 3;
    const orders = [];
    let totalSlippage = 0;

    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, i * 2000)); // 2s entre partes
      const order = await placeFuturesOrder(symbol, side, Math.round(partSize * 1000) / 1000, 10, 'MARKET');
      const executedPrice = parseFloat(order.fills?.[0]?.price ?? entryPrice.toString());
      const slippage = Math.abs(executedPrice - entryPrice) / entryPrice * 100;
      totalSlippage += slippage;
      orders.push({ ...order, slippage });
    }

    await writeProof('trading:execute_twap', { symbol, side, positionSizeUSDT }, orders, 'Agent-Execution', COMPANY_ID);
    await recordAgentEvent('Agent-Execution', COMPANY_ID, 'success', symbol + ':TWAP:slippage:' + totalSlippage.toFixed(4));
    await logOrchestratorAction('trading:executed:' + side + ':' + symbol + ':slippage:' + totalSlippage.toFixed(4));

    return { executed: true, orders, totalSlippage: Math.round(totalSlippage * 10000) / 10000 };
  } catch (e: any) {
    await recordAgentEvent('Agent-Execution', COMPANY_ID, 'error', symbol + ':' + e.message);
    return { executed: false, orders: [], totalSlippage: 0, error: e.message };
  }
}

// ─── Agente 9: AI Meta-Strategist ────────────────────────────
export async function runMetaStrategist(symbol: string): Promise<{
  symbol: string;
  decision: 'EXECUTE_LONG' | 'EXECUTE_SHORT' | 'WAIT' | 'CASH';
  confidence: number;
  reasoning: string;
  entryPrice: number;
  stopLoss: number;
  weights: Record<string, number>;
}> {
  // Recopilar señales de todos los agentes
  const [liquidity, cvd, session, smartMoney] = await Promise.all([
    runLiquidityMapAgent(symbol),
    runCVDDeltaAgent(symbol),
    runSessionBiasAgent(symbol),
    runSmartMoneyAgent(symbol),
  ]);

  const fundingOI = await runFundingOIAgent();
  const fundingData = fundingOI.pairs.find(p => p.symbol === symbol);

  // Ponderación de señales
  const signals: Record<string, number> = {
    liquidity: liquidity.bias === 'BULLISH' ? 1 : liquidity.bias === 'BEARISH' ? -1 : 0,
    cvd: cvd.signal === 'BUY' ? 1 : cvd.signal === 'SELL' ? -1 : 0,
    session: session.sessionBias === 'BULLISH' ? 1 : session.sessionBias === 'BEARISH' ? -1 : 0,
    smartMoney: smartMoney.signal === 'BUY' ? 1 : smartMoney.signal === 'SELL' ? -1 : 0,
    funding: fundingData?.confluence === 'SHORT_SQUEEZE' ? 1 : fundingData?.confluence === 'LONG_SQUEEZE' ? -1 : 0,
  };

  const weights = { liquidity: 0.25, cvd: 0.25, session: 0.15, smartMoney: 0.25, funding: 0.10 };
  const score = Object.entries(signals).reduce((total, [key, val]) => total + val * (weights[key as keyof typeof weights] ?? 0), 0);
  const confidence = Math.round(Math.abs(score) * 100);

  // Obtener precio actual
  const priceRes = await fetch(`https://binance-proxy.trendtraderg11.workers.dev/api/v3/ticker/price?symbol=${symbol}`);
  const priceData = await priceRes.json();
  const currentPrice = parseFloat(priceData.price ?? '0');

  const stopDistance = 0.015; // 1.5%
  const stopLoss = score > 0 ? currentPrice * (1 - stopDistance) : currentPrice * (1 + stopDistance);

  // LLM para contexto macro
  const llmContext = await callLLM({
    systemPrompt: `You are an elite crypto trading strategist. Analyze signals and provide a final decision. 
    Respond in JSON: {"decision": "EXECUTE_LONG"|"EXECUTE_SHORT"|"WAIT"|"CASH", "reasoning": "brief explanation in Spanish"}`,
    userMessage: `Symbol: ${symbol}
Score: ${score.toFixed(2)} (positive=bullish, negative=bearish)
Signals: ${JSON.stringify(signals)}
Liquidity bias: ${liquidity.bias}, nearest target: ${liquidity.nearestTarget.direction} at ${liquidity.nearestTarget.price}
CVD divergence: ${cvd.divergenceType}
Session: ${session.currentSession}, bias: ${session.sessionBias}
Smart money: ${smartMoney.whaleActivity}
Funding confluence: ${fundingData?.confluence ?? 'N/A'}
Confidence: ${confidence}%
Make the final trading decision.`,
    agentId: 'Agent-Meta-Strategist',
    companyId: COMPANY_ID,
    maxTokens: 300,
  });

  let decision: 'EXECUTE_LONG' | 'EXECUTE_SHORT' | 'WAIT' | 'CASH' = 'WAIT';
  let reasoning = '';

  try {
    const clean = llmContext.response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    decision = parsed.decision ?? 'WAIT';
    reasoning = parsed.reasoning ?? '';
  } catch {
    decision = score > 0.3 && confidence >= 60 ? 'EXECUTE_LONG' :
               score < -0.3 && confidence >= 60 ? 'EXECUTE_SHORT' : 'WAIT';
    reasoning = 'Decisión basada en score ponderado: ' + score.toFixed(2);
  }

  const result = { symbol, decision, confidence, reasoning, entryPrice: currentPrice, stopLoss, weights };
  await redis.set('trading:meta:' + symbol, JSON.stringify({ ...result, timestamp: Date.now() }), { ex: 300 });
  await recordAgentEvent('Agent-Meta-Strategist', COMPANY_ID, 'success', symbol + ':' + decision + ':confidence:' + confidence);
  await logOrchestratorAction('trading:meta:' + symbol + ':' + decision + ':' + confidence + '%');

  return result;
}

// ─── Ciclo completo de trading elite ─────────────────────────
export async function runEliteTradingCycle(): Promise<{
  decisions: { symbol: string; decision: string; confidence: number; reasoning: string }[];
  executed: { symbol: string; result: any }[];
  timestamp: number;
}> {
  await logOrchestratorAction('trading:elite_cycle:start');
  const decisions = [];
  const executed = [];

  for (const symbol of PAIRS.slice(0, 3)) {
    try {
      const meta = await runMetaStrategist(symbol);
      decisions.push({ symbol, decision: meta.decision, confidence: meta.confidence, reasoning: meta.reasoning });

      // Solo ejecutar si hay alta confianza
      if ((meta.decision === 'EXECUTE_LONG' || meta.decision === 'EXECUTE_SHORT') && meta.confidence >= 70) {
        const side = meta.decision === 'EXECUTE_LONG' ? 'BUY' : 'SELL';
        const execResult = await runExecutionAgent(symbol, side, 50, meta.entryPrice, meta.stopLoss);
        executed.push({ symbol, result: execResult });
      }
    } catch (e: any) {
      await recordAgentEvent('Agent-Meta-Strategist', COMPANY_ID, 'error', symbol + ':' + e.message);
    }
  }

  await logOrchestratorAction('trading:elite_cycle:done:decisions:' + decisions.length + ':executed:' + executed.length);
  return { decisions, executed, timestamp: Date.now() };
}
