'use client';

import { useState, useEffect } from 'react';

const CARD = {
  background: '#0d1117',
  border: '1px solid #1e2433',
  borderRadius: 12,
  padding: 16,
};

const INPUT_STYLE = {
  background: '#161b22',
  border: '1px solid #1e2433',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  color: '#e6edf3' as const,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box' as const,
};

interface AffiliateProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  commission: number;
  platform: string;
  affiliateUrl: string;
  category?: string;
}

const EMPTY_FORM = {
  id: '',
  name: '',
  description: '',
  price: '',
  commission: '',
  affiliateUrl: '',
  category: '',
};

export default function ProductosPage() {
  const [products, setProducts] = useState<AffiliateProduct[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/productos');
      const data = await res.json();
      setProducts(data.products || []);
    } catch {
      setMessage('Error al cargar productos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const handleChange = (field: keyof typeof EMPTY_FORM, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!form.id || !form.name || !form.affiliateUrl) {
      setMessage('⚠️ ID, Nombre y Link de afiliado son obligatorios.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`❌ ${data.error || 'Error al guardar'}`);
      } else {
        setMessage(`✅ Producto "${form.name}" guardado correctamente.`);
        setForm(EMPTY_FORM);
        setProducts(data.products);
      }
    } catch {
      setMessage('❌ Error de conexión al guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este producto de la lista?')) return;
    try {
      const res = await fetch('/api/admin/productos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok) setProducts(data.products);
    } catch {
      setMessage('❌ Error al eliminar.');
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 700, margin: '0 auto', color: '#e6edf3', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📦 Productos Afiliados Hotmart</h1>
      <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 20 }}>
        Agrega aquí los productos a los que ya estás afiliado. El agente Affiliate-Scout los usará en el próximo ciclo.
      </p>

      <div style={{ ...CARD, marginBottom: 24 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>ID del producto (de Hotmart) *</label>
            <input style={INPUT_STYLE} value={form.id} onChange={e => handleChange('id', e.target.value)} placeholder="Ej: Q106300997Y" />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>Nombre del producto *</label>
            <input style={INPUT_STYLE} value={form.name} onChange={e => handleChange('name', e.target.value)} placeholder="Ej: DESPIERTA: Un Viaje de Crecimiento Personal" />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>Link de afiliado (hotlink) *</label>
            <input style={INPUT_STYLE} value={form.affiliateUrl} onChange={e => handleChange('affiliateUrl', e.target.value)} placeholder="https://go.hotmart.com/..." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>Precio (USD)</label>
              <input style={INPUT_STYLE} value={form.price} onChange={e => handleChange('price', e.target.value)} placeholder="19.99" inputMode="decimal" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>Comisión (%)</label>
              <input style={INPUT_STYLE} value={form.commission} onChange={e => handleChange('commission', e.target.value)} placeholder="50" inputMode="decimal" />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>Categoría</label>
            <input style={INPUT_STYLE} value={form.category} onChange={e => handleChange('category', e.target.value)} placeholder="crecimiento personal" />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 4 }}>Descripción corta</label>
            <textarea
              style={{ ...INPUT_STYLE, minHeight: 60, resize: 'vertical' as const }}
              value={form.description}
              onChange={e => handleChange('description', e.target.value)}
              placeholder="Breve descripción del producto..."
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              background: saving ? '#1e2433' : '#00c896',
              color: saving ? '#8b949e' : '#0d1117',
              border: 'none',
              borderRadius: 8,
              padding: '12px',
              fontSize: 13,
              fontWeight: 700,
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Guardando...' : '+ Agregar Producto'}
          </button>
          {message && <div style={{ fontSize: 12, marginTop: 4 }}>{message}</div>}
        </div>
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
        Productos en la lista {loading ? '' : `(${products.length})`}
      </h2>

      {loading && <div style={{ fontSize: 12, color: '#8b949e' }}>Cargando...</div>}
      {!loading && products.length === 0 && (
        <div style={{ fontSize: 12, color: '#8b949e' }}>No hay productos aún. Agrega el primero arriba.</div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {products.map(p => (
          <div key={p.id} style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: '#8b949e' }}>
                  ${p.price} · {p.commission}% comisión {p.category ? `· ${p.category}` : ''}
                </div>
                <div style={{ fontSize: 10, color: '#00c896', wordBreak: 'break-all', marginTop: 4 }}>{p.affiliateUrl}</div>
              </div>
              <button
                onClick={() => handleDelete(p.id)}
                style={{ background: 'transparent', border: '1px solid #f0444c', color: '#f0444c', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}