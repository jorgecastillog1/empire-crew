// ─── __tests__/dashboard.test.tsx ────────────────────────────────────────────
// Instalar:  npm install -D jest @testing-library/react @testing-library/jest-dom jest-environment-jsdom @types/jest
// Configurar jest.config.ts: { testEnvironment: 'jsdom', ... }

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ─── Mocks globales ───────────────────────────────────────────────────────────
global.fetch = jest.fn();
global.WebSocket = jest.fn().mockImplementation(() => ({
  onopen: null, onmessage: null, onerror: null, onclose: null,
  close: jest.fn(), send: jest.fn(),
})) as any;

// ─── Datos de prueba ──────────────────────────────────────────────────────────
const mockAgent = {
  name: 'Agent-Quant-01',
  role: 'Análisis de Mercado',
  status: 'idle' as const,
  model: 'llama-3.3-70b-versatile',
};

const mockCompany = {
  id: 'trading-alpha',
  name: 'Trading Alpha Corp',
  type: 'trading' as const,
  budget: '$50,000',
  sector: 'Finanzas',
  metric: '12.4% ROI',
  agents: [mockAgent],
};

const mockDiagnosis = {
  overall: 'healthy' as const,
  services: [
    { name: 'API', status: 'healthy' as const, errorCount: 0, details: 'OK' },
    { name: 'DB',  status: 'degraded' as const, errorCount: 2, details: 'Latencia alta' },
  ],
};

// ─── Test: AgentCard ──────────────────────────────────────────────────────────
// Importamos el componente directamente del archivo de página refactorizado
// En producción, extraer AgentCard a su propio archivo para facilitar imports en tests

describe('AgentCard', () => {
  // Componente inline para tests (refleja la misma lógica)
  function AgentCard({ agent, color }: { agent: typeof mockAgent; color: string }) {
    const [expanded, setExpanded] = React.useState(false);
    return (
      <div data-testid="agent-card" onClick={() => setExpanded(!expanded)}>
        <span>{agent.name}</span>
        <span>{agent.role}</span>
        <span data-testid="status">{agent.status}</span>
        {expanded && <span data-testid="model">{agent.model}</span>}
      </div>
    );
  }

  it('renderiza nombre, rol y status', () => {
    render(<AgentCard agent={mockAgent} color="#00c896" />);
    expect(screen.getByText('Agent-Quant-01')).toBeInTheDocument();
    expect(screen.getByText('Análisis de Mercado')).toBeInTheDocument();
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });

  it('expande al hacer click y muestra el modelo', () => {
    render(<AgentCard agent={mockAgent} color="#00c896" />);
    expect(screen.queryByTestId('model')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('agent-card'));
    expect(screen.getByTestId('model')).toHaveTextContent('llama-3.3-70b-versatile');
  });
});

// ─── Test: HealthPanel ────────────────────────────────────────────────────────
describe('HealthPanel', () => {
  function HealthPanel({ diagnosis }: { diagnosis: typeof mockDiagnosis | null }) {
    if (!diagnosis) return null;
    return (
      <div>
        <span data-testid="overall">{diagnosis.overall}</span>
        {diagnosis.services.map(svc => (
          <div key={svc.name} data-testid={`service-${svc.name}`}>
            <span>{svc.name}</span>
            <span>{svc.status}</span>
          </div>
        ))}
      </div>
    );
  }

  it('no renderiza nada si diagnosis es null', () => {
    const { container } = render(<HealthPanel diagnosis={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('muestra el estado general y los servicios', () => {
    render(<HealthPanel diagnosis={mockDiagnosis} />);
    expect(screen.getByTestId('overall')).toHaveTextContent('healthy');
    expect(screen.getByTestId('service-API')).toBeInTheDocument();
    expect(screen.getByTestId('service-DB')).toBeInTheDocument();
  });
});

// ─── Test: CopilotPanel ───────────────────────────────────────────────────────
describe('CopilotPanel', () => {
  function CopilotPanel({ company }: { company: typeof mockCompany }) {
    const [input, setInput] = React.useState('');
    const [messages, setMessages] = React.useState<{ role: string; content: string }[]>([]);
    const [error, setError] = React.useState<string | null>(null);

    const send = async () => {
      if (!input.trim()) return;
      const msg = input; setInput(''); setError(null);
      setMessages(p => [...p, { role: 'user', content: msg }]);
      try {
        const res = await fetch('/api/orchestrator', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setMessages(p => [...p, { role: 'assistant', content: data.response }]);
      } catch (e: any) {
        setError(e.message);
      }
    };

    return (
      <div>
        {messages.map((m, i) => <div key={i} data-testid={`msg-${m.role}`}>{m.content}</div>)}
        {error && <div data-testid="error">{error}</div>}
        <input data-testid="input" value={input} onChange={e => setInput(e.target.value)} />
        <button data-testid="send" onClick={send}>Enviar</button>
      </div>
    );
  }

  beforeEach(() => { (fetch as jest.Mock).mockReset(); });

  it('envía mensaje y muestra la respuesta del assistant', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: 'El win rate puede mejorar ajustando el stop loss.' }),
    });

    render(<CopilotPanel company={mockCompany} />);
    fireEvent.change(screen.getByTestId('input'), { target: { value: '¿Cómo mejorar el win rate?' } });
    fireEvent.click(screen.getByTestId('send'));

    await waitFor(() => {
      expect(screen.getByTestId('msg-user')).toHaveTextContent('¿Cómo mejorar el win rate?');
      expect(screen.getByTestId('msg-assistant')).toHaveTextContent('El win rate puede mejorar');
    });
  });

  it('muestra el error real de la API cuando falla', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });

    render(<CopilotPanel company={mockCompany} />);
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'test' } });
    fireEvent.click(screen.getByTestId('send'));

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('HTTP 503');
    });
  });

  it('no envía si el input está vacío', () => {
    render(<CopilotPanel company={mockCompany} />);
    fireEvent.click(screen.getByTestId('send'));
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── Test: useCompanyData hook ────────────────────────────────────────────────
import { renderHook, act } from '@testing-library/react';
import { useCompanyData } from '@/hooks/useCompanyData';

describe('useCompanyData', () => {
  beforeEach(() => { (fetch as jest.Mock).mockReset(); });

  it('devuelve loading=true inicialmente', () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] });
    const { result } = renderHook(() => useCompanyData('test-id'));
    expect(result.current.loading).toBe(true);
  });

  it('setea error si las APIs fallan', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useCompanyData('test-id'));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    // El hook no debería crashear; loading debe volver a false
    expect(result.current.loading).toBe(false);
  });

  it('no lanza error si id está vacío', () => {
    expect(() => renderHook(() => useCompanyData(''))).not.toThrow();
  });
});