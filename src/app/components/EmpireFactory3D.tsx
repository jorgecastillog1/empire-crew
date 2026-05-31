'use client';
// ─── components/EmpireFactory3D.tsx ──────────────────────────────────────────
// Vista 3D de la Fábrica de Empresas. Se carga SOLO cuando el usuario
// hace clic en "Vista Fábrica". No penaliza la carga inicial del dashboard.
//
// Dependencias requeridas:
//   npm install three @react-three/fiber @react-three/drei
//
// Arquitectura:
//   - Eje X/Z: posición espacial de subsidiarias
//   - Eje Y: altura = salud de la empresa (verde alto, rojo bajo)
//   - "Río del Tiempo": curva B-spline en el suelo (izq=pasado, centro=presente, der=futuro)
//   - Partículas de datos fluyendo por las conexiones entre nodos
//   - Click en nodo → dispara onSelectCompany callback
//
// Rendimiento:
//   - InstancedMesh para partículas (un solo draw call)
//   - Materiales compartidos via useRef (no recreados en cada frame)
//   - useFrame solo muta matrices de instancias, no setState
//   - Suspense + lazy para no bloquear el thread principal

import dynamic from 'next/dynamic';
import { Suspense, useState, useCallback } from 'react';

// ─── Tipos locales ────────────────────────────────────────────────────────────
interface CompanyNode {
  id: string;
  name: string;
  type: 'trading' | 'cinematography' | 'marketing' | string;
  health: number; // 0-1
  agents: number;
}

interface Props {
  companies: CompanyNode[];
  onSelectCompany: (id: string) => void;
  onClose: () => void;
}

// ─── Carga dinámica del canvas 3D ─────────────────────────────────────────────
const Factory3DScene = dynamic(() => import('./Factory3DScene'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
      <div style={{ width: 32, height: 32, border: '2px solid #00c896', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: '#8b949e', fontSize: 13 }}>Inicializando motor 3D…</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  ),
});

// ─── Wrapper principal (botón toggle + overlay) ───────────────────────────────
export function EmpireFactory3DToggle({
  companies,
  onSelectCompany,
}: Omit<Props, 'onClose'>) {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback((id: string) => {
    setOpen(false);
    onSelectCompany(id);
  }, [onSelectCompany]);

  return (
    <>
      {/* Botón de activación — flotante, no interrumpe el layout 2D */}
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'linear-gradient(135deg, rgba(0,200,150,0.15), rgba(79,142,247,0.15))',
          border: '1px solid rgba(0,200,150,0.4)',
          color: '#00c896', padding: '10px 20px', borderRadius: 10,
          cursor: 'pointer', fontSize: 13, fontWeight: 700,
          letterSpacing: 0.5, backdropFilter: 'blur(8px)',
          transition: 'all 0.2s', boxShadow: '0 0 20px rgba(0,200,150,0.1)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 30px rgba(0,200,150,0.3)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 20px rgba(0,200,150,0.1)'; }}
      >
        <span style={{ fontSize: 16 }}>🏭</span>
        Vista Fábrica 3D
      </button>

      {/* Overlay fullscreen */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(1,4,9,0.97)',
          backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Barra superior */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '16px 24px',
            borderBottom: '1px solid rgba(0,200,150,0.15)',
            background: 'rgba(13,17,23,0.8)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>🏭</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e6edf3', letterSpacing: -0.3 }}>EMPIRE CREW — Fábrica de Empresas</div>
                <div style={{ fontSize: 11, color: '#8b949e' }}>Vista 3D · Haz clic en un nodo para ir al dashboard</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Leyenda */}
              <div style={{ display: 'flex', gap: 12 }}>
                {[
                  { color: '#00c896', label: 'Trading' },
                  { color: '#f0b429', label: 'Cine' },
                  { color: '#4f8ef7', label: 'Marketing' },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
                    <span style={{ fontSize: 11, color: '#8b949e' }}>{label}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)',
                  color: '#ff5050', padding: '6px 14px', borderRadius: 8,
                  cursor: 'pointer', fontSize: 12, fontWeight: 700,
                }}
              >
                ✕ Cerrar
              </button>
            </div>
          </div>

          {/* Canvas 3D */}
          <div style={{ flex: 1, position: 'relative' }}>
            <Suspense fallback={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
                <div style={{ width: 32, height: 32, border: '2px solid #00c896', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ color: '#8b949e', fontSize: 13 }}>Inicializando motor 3D…</span>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            }>
              <Factory3DScene
                companies={companies}
                onSelectCompany={handleSelect}
              />
            </Suspense>

            {/* HUD esquina inferior */}
            <div style={{
              position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
              display: 'flex', gap: 24, alignItems: 'center',
              background: 'rgba(13,17,23,0.85)', border: '1px solid #1e2433',
              padding: '10px 24px', borderRadius: 30, backdropFilter: 'blur(8px)',
            }}>
              <span style={{ fontSize: 11, color: '#8b949e' }}>🖱️ Arrastrar — Orbitar</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>🔍 Scroll — Zoom</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>👆 Click — Entrar subsidiaria</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}