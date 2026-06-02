// src/types/company.ts

export interface Agent {
  name: string;
  role: string;
  status: 'idle' | 'executing' | 'analyzing';
  model: string;
}

export interface Company {
  id: string;
  name: string;
  type: 'trading' | 'cinematography' | 'marketing' | string;
  budget: string;
  sector: string;
  metric: string;
  agents: Agent[];
}

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  errorCount: number;
  details: string;
}

export interface Diagnosis {
  overall: 'healthy' | 'degraded' | 'down' | 'critical';
  services: ServiceHealth[];
}

export interface OrchestratorLog {
  action: string;
  timestamp?: number;
}

export interface FundingPair {
  symbol: string;
  fundingRate: number;
  annualized: number;
  confluence: string;
}

export interface TradeOrder {
  side: 'BUY' | 'SELL';
  symbol: string;
  executedQty: string;
  price?: string;
  status: string;
}

export interface TradingMetrics {
  balance: Record<string, number>;
  openOrders: TradeOrder[];
  recentOrders: TradeOrder[];
  meta: {
    decision?: string;
    confidence?: number;
  } | null;
  funding: { pairs: FundingPair[] } | null;
  liquidity: any;
}

export const TYPE_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  trading:        { color: '#00c896', bg: 'rgba(0,200,150,0.08)',  border: 'rgba(0,200,150,0.2)'  },
  cinematography: { color: '#f0b429', bg: 'rgba(240,180,41,0.08)', border: 'rgba(240,180,41,0.2)' },
  marketing:      { color: '#4f8ef7', bg: 'rgba(79,142,247,0.08)', border: 'rgba(79,142,247,0.2)' },
};

export const DEFAULT_THEME = {
  color: '#a78bfa', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.2)'
};

export const STATUS_COLOR: Record<string, string> = {
  idle: '#8b949e', executing: '#00c896', analyzing: '#f0b429',
};