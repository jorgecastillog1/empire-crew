import { NextRequest, NextResponse } from 'next/server';
import {
  runLiquidityMapAgent,
  runCVDDeltaAgent,
  runFundingOIAgent,
  runSessionBiasAgent,
  runLiquidationHeatmapAgent,
  runSmartMoneyAgent,
  runRiskPositionAgent,
  runExecutionAgent,
  runMetaStrategist,
  runEliteTradingCycle,
} from '@/lib/trading-agents';
import { redis } from '@/lib/redis';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') ?? 'status';
  const symbol = searchParams.get('symbol') ?? 'BTCUSDT';

  try {
    if (action === 'status') {
      const [liquidity, cvd, fundingOI, session, smartMoney, meta] = await Promise.all([
        redis.get<string>('trading:liquidity:' + symbol).then(r => r ? JSON.parse(r) : null),
        redis.get<string>('trading:cvd:' + symbol).then(r => r ? JSON.parse(r) : null),
        redis.get<string>('trading:funding_oi').then(r => r ? JSON.parse(r) : null),
        redis.get<string>('trading:session:' + symbol).then(r => r ? JSON.parse(r) : null),
        redis.get<string>('trading:smart_money:' + symbol).then(r => r ? JSON.parse(r) : null),
        redis.get<string>('trading:meta:' + symbol).then(r => r ? JSON.parse(r) : null),
      ]);
      return NextResponse.json({ symbol, liquidity, cvd, fundingOI, session, smartMoney, meta, timestamp: Date.now() });
    }

    if (action === 'liquidity') return NextResponse.json(await runLiquidityMapAgent(symbol));
    if (action === 'cvd') return NextResponse.json(await runCVDDeltaAgent(symbol));
    if (action === 'funding') return NextResponse.json(await runFundingOIAgent());
    if (action === 'session') return NextResponse.json(await runSessionBiasAgent(symbol));
    if (action === 'liquidations') return NextResponse.json(await runLiquidationHeatmapAgent());
    if (action === 'smart_money') return NextResponse.json(await runSmartMoneyAgent(symbol));
    if (action === 'meta') return NextResponse.json(await runMetaStrategist(symbol));

    if (action === 'cycle') {
      const result = await runEliteTradingCycle();
      return NextResponse.json(result);
    }

    if (action === 'futures_balance') {
      const { getFuturesBalance } = await import('@/lib/binance');
      const balance = await getFuturesBalance();
      return NextResponse.json(balance);
    }

    if (action === 'balance') {
      const { getAccountBalance } = await import('@/lib/binance');
      const balance = await getAccountBalance();
      return NextResponse.json(balance);
    }

    if (action === 'futures_balance') {
      return NextResponse.json({ USDT: 0, BTC: 0, timestamp: Date.now() });
    }

    if (action === 'open_orders') {
      const { getOpenOrders } = await import('@/lib/binance');
      const orders = await getOpenOrders(symbol);
      return NextResponse.json(orders);
    }

    if (action === 'history') {
      const orders = await redis.lrange('trading:orders', 0, 49) as string[];
      return NextResponse.json(orders.map(o => { try { return JSON.parse(o); } catch { return o; } }));
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, symbol, side, positionSizeUSDT, entryPrice, stopLoss } = await request.json();

    if (action === 'risk') {
      if (!symbol || !side || !entryPrice || !stopLoss)
        return NextResponse.json({ error: 'symbol, side, entryPrice, stopLoss requeridos' }, { status: 400 });
      return NextResponse.json(await runRiskPositionAgent(symbol, side, entryPrice, stopLoss));
    }

    if (action === 'execute') {
      if (!symbol || !side || !positionSizeUSDT || !entryPrice || !stopLoss)
        return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 });
      return NextResponse.json(await runExecutionAgent(symbol, side, positionSizeUSDT, entryPrice, stopLoss));
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}