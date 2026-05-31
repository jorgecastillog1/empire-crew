'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cpu, ShieldAlert, Sparkles, DollarSign, Layers } from 'lucide-react';

export default function FactoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'trading',
    budget: '',
    sector: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const id = formData.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    try {
      const response = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: formData.name,
          type: formData.type,
          budget: `$${formData.budget} USD`,
          sector: formData.sector
        })
      });

      if (!response.ok) throw new Error('Error al crear empresa');

      router.push(`/companies/${id}`);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl space-y-8">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Cpu className="w-7 h-7 text-cyan-400" />
          Instanciar Nueva Subsidiaria
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Despliega una nueva entidad comercial autónoma con entornos aislados y asignación presupuestaria.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nombre de la Empresa</label>
              <input
                type="text"
                placeholder="Ex: Obsidian Quantum"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sector Industrial</label>
              <select
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-cyan-500 transition-colors"
                value={formData.type}
                onChange={(e) => setFormData({...formData, type: e.target.value})}
              >
                <option value="trading">Trading Algorítmico (Crypto / Cuantitativo)</option>
                <option value="cinematography">Producción Cinematográfica e IA</option>
                <option value="marketing">Marketing Digital & Conversión Automatizada</option>
                <option value="custom">Sector Personalizado</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-slate-500" /> Presupuesto Asignado (USD)
              </label>
              <input
                type="number"
                placeholder="0.00"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                value={formData.budget}
                onChange={(e) => setFormData({...formData, budget: e.target.value})}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-500" /> Sub-sector de Enfoque
              </label>
              <input
                type="text"
                placeholder="Ex: Arbitraje de Funding Rates"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
                value={formData.sector}
                onChange={(e) => setFormData({...formData, sector: e.target.value})}
                required
              />
            </div>
          </div>

          <div className="bg-cyan-950/20 border border-cyan-500/20 rounded-lg p-4 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-400 space-y-1">
              <p className="font-semibold text-slate-300">Aislamiento de Entorno (Sandboxing)</p>
              <p>Al instanciar esta empresa, el Orquestador generará un contenedor lógico con llaves criptográficas únicas. Ningún agente desplegado aquí tendrá acceso a los fondos o datos de tus otras subsidiarias.</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold px-6 py-2.5 rounded-lg text-sm flex items-center gap-2 transition-colors shadow-lg shadow-cyan-500/10"
            >
              <Sparkles className="w-4 h-4" />
              {loading ? 'Inicializando...' : 'Inicializar Estructura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}