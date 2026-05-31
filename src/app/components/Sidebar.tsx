'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Shield, Building2, Cpu, BarChart3, Megaphone, Film, Settings, Brain, Plus, ChevronDown, ChevronUp } from 'lucide-react';

interface Company {
  id: string;
  name: string;
  type: string;
}

const typeIcon = (type: string) => {
  if (type === 'trading') return BarChart3;
  if (type === 'cinematography') return Film;
  if (type === 'marketing') return Megaphone;
  return Building2;
};

export default function Sidebar() {
  const pathname = usePathname();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    fetch('/api/companies')
      .then(res => res.json())
      .then(data => setCompanies(data))
      .catch(() => {});
  }, []);

  const isActive = (path: string) => pathname === path;

  return (
    <aside className="w-64 min-h-screen bg-slate-900 border-r border-slate-800 flex flex-col text-slate-300">
      <div className="p-6 border-b border-slate-800 flex items-center gap-3 bg-slate-950/40">
        <Shield className="w-7 h-7 text-cyan-400 animate-pulse" />
        <div>
          <h2 className="font-bold text-sm text-slate-100 tracking-wider">EMPIRE 2.0</h2>
          <p className="text-xs text-cyan-500 font-medium">Orquestador Central</p>
        </div>
      </div>

      <div className="flex-1 px-4 py-6 space-y-7 overflow-y-auto">
        <div>
          <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Fábrica Núcleo</p>
          <nav className="space-y-1">
            <Link href="/" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive('/') ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'}`}>
              <Building2 className="w-4 h-4" />
              Panel de Control
            </Link>
            <Link href="/factory" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive('/factory') ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'}`}>
              <Cpu className="w-4 h-4" />
              Instanciar Empresa
            </Link>
            <Link href="/orchestrator" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive('/orchestrator') ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'}`}>
              <Brain className="w-4 h-4" />
              Orquestador IA
            </Link>
          </nav>
        </div>

        <div>
          <div className="flex items-center justify-between px-3 mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Empresas Activas
              <span className="ml-1.5 text-cyan-500">({companies.length})</span>
            </p>
            <button onClick={() => setExpanded(!expanded)} className="text-slate-600 hover:text-slate-400 transition-colors">
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {expanded && (
            <nav className="space-y-1">
              {companies.length === 0 ? (
                <p className="px-3 text-xs text-slate-600 italic">Sin empresas activas</p>
              ) : (
                companies.map((company) => {
                  const CompanyIcon = typeIcon(company.type);
                  const companyPath = `/companies/${company.id}`;
                  return (
                    <Link key={company.id} href={companyPath} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive(companyPath) ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'}`}>
                      <CompanyIcon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{company.name}</span>
                    </Link>
                  );
                })
              )}
              <Link href="/factory" className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-slate-400 hover:bg-slate-800/50 transition-colors">
                <Plus className="w-3.5 h-3.5" />
                Nueva empresa
              </Link>
            </nav>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-slate-800 bg-slate-950/20 space-y-1">
        <Link href="/settings" className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive('/settings') ? 'bg-slate-800 text-slate-300' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}>
          <Settings className="w-4 h-4" />
          Configuración
        </Link>
      </div>
    </aside>
  );
}
