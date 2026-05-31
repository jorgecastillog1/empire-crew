'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Company, Diagnosis, OrchestratorLog, TradingMetrics } from '@/types/company';

const TRADING_POLL_MS = 30_000;

interface UseCompanyDataReturn {
  company: Company | null;
  diagnosis: Diagnosis | null;
  logs: OrchestratorLog[];
  tradingMetrics: TradingMetrics | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCompanyData(id: string): UseCompanyDataReturn {
  const [company, setCompany]               = useState<Company | null>(null);
  const [diagnosis, setDiagnosis]           = useState<Diagnosis | null>(null);
  const [logs, setLogs]                     = useState<OrchestratorLog[]>([]);
  const [tradingMetrics, setTradingMetrics] = useState<TradingMetrics | null>(null);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const companyTypeRef                      = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      const [companiesRes, diagRes, logsRes] = await Promise.allSettled([
        fetch('/api/companies').then(r => { if (!r.ok) throw new Error('companies'); return r.json(); }),
        fetch('/api/supervisor?action=diagnosis').then(r => { if (!r.ok) throw new Error('diagnosis'); return r.json(); }),
        fetch('/api/orchestrator?action=log').then(r => { if (!r.ok) throw new Error('log'); return r.json(); }),
      ]);

      const found: Company | null =
        companiesRes.status === 'fulfilled'
          ? (companiesRes.value as Company[]).find((c) => c.id === id) ?? null
          : null;

      setCompany(found ?? null);
      companyTypeRef.current = found?.type ?? null;

      if (diagRes.status === 'fulfilled') setDiagnosis(diagRes.value);
      if (logsRes.status === 'fulfilled') {
        const raw = logsRes.value;
        setLogs((Array.isArray(raw) ? raw : []).slice(0, 15));
      }

      if (found?.type === 'trading') {
        const [balanceRes, ordersRes, metaRes, fundingRes, liquidityRes] = await Promise.allSettled([
          fetch('/api/trading?action=balance').then(r => r.json()),
          fetch('/api/trading?action=history').then(r => r.json()),
          fetch('/api/trading?action=meta&symbol=BTCUSDT').then(r => r.json()),
          fetch('/api/trading?action=funding').then(r => r.json()),
          fetch('/api/trading?action=liquidity&symbol=BTCUSDT').then(r => r.json()),
        ]);

        setTradingMetrics({
          balance:      balanceRes.status === 'fulfilled' ? balanceRes.value : {},
          openOrders:   [],
          recentOrders: ordersRes.status === 'fulfilled' && Array.isArray(ordersRes.value)
                          ? ordersRes.value.slice(0, 10) : [],
          meta:         metaRes.status === 'fulfilled' ? metaRes.value : null,
          funding:      fundingRes.status === 'fulfilled' ? fundingRes.value : null,
          liquidity:    liquidityRes.status === 'fulfilled' ? liquidityRes.value : null,
        });
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchAll();
    let interval: ReturnType<typeof setInterval> | null = null;
    const setupTimer = setTimeout(() => {
      if (companyTypeRef.current === 'trading') {
        interval = setInterval(fetchAll, TRADING_POLL_MS);
      }
    }, 500);
    return () => {
      clearTimeout(setupTimer);
      if (interval) clearInterval(interval);
    };
  }, [id, fetchAll]);

  return { company, diagnosis, logs, tradingMetrics, loading, error, refetch: fetchAll };
}