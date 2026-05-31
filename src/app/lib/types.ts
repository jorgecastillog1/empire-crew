export type CompanyType = 'cinematography' | 'marketing' | 'trading' | 'custom';

export type AgentStatus = 'idle' | 'analyzing' | 'executing' | 'error';

export interface ActivityLog {
  timestamp: string;
  action: string;
  details?: string;
}

export interface Company {
  id: string;          // ID único (slug de la URL ex: 'empire-trading')
  name: string;        // Nombre comercial de la empresa
  type: CompanyType;   // Sector industrial
  status: 'active' | 'suspended' | 'initializing';
  createdAt: string;
  budget: number;      // Presupuesto o fondos asignados
  sectors: string[];   // Sub-áreas protegidas o controladas
  settings: {
    theme: string;
    customUrl: string;
  };
}

export interface Agent {
  id: string;
  companyId: string;   // A qué empresa de la fábrica pertenece
  name: string;
  role: string;
  status: AgentStatus;
  coreModel: string;   // Modelo de IA que lo respalda (ex: 'gpt-4o', 'claude-3-5')
  targetMetric: string; // Qué optimiza (ex: 'ROI', 'RenderTime', 'CTR')
  logs: ActivityLog[];
}