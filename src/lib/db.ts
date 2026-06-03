import { redis, KEY } from '@/lib/redis';
import { Company, Agent } from '@/types/company';

// Empresas de ejemplo que aparecen la primera vez que instalas el sistema
// Les añadimos enabled: true para que estén encendidas por defecto
const DEFAULT_COMPANIES: Company[] = [
  {
    id: 'alpha-trading',
    name: 'Alpha Trading Algorítmico',
    type: 'trading',
    budget: '$45,000 USD',
    sector: 'Arbitraje de Funding Rates',
    metric: 'Win Rate: 68.4%',
    agents: [
      { name: 'Agent-Funding-Bot', role: 'Arbitraje de Tasas', status: 'executing', model: 'GPT-4o' },
      { name: 'Agent-Trend-Alpha', role: 'Análisis Técnico Macroscópico', status: 'analyzing', model: 'Claude 3.5 Sonnet' }
    ],
    enabled: true,  // ← NUEVO
  },
  {
    id: 'cine-media',
    name: 'Empresa Cinematográfica',
    type: 'cinematography',
    budget: '$120,000 USD',
    sector: 'Guiones de Ciencia Ficción',
    metric: 'Escenas Renderizadas: 24/30',
    agents: [
      { name: 'Agent-Script-Writer', role: 'Generación de Guiones', status: 'idle', model: 'Claude 3.5 Sonnet' },
      { name: 'Agent-Story-Board', role: 'Orquestación de Prompts Visuales', status: 'executing', model: 'GPT-4o' }
    ],
    enabled: true,  // ← NUEVO
  },
  {
    id: 'marketing-pro',
    name: 'Marketing Digital Automático',
    type: 'marketing',
    budget: '$15,000 USD',
    sector: 'Embudos de Conversión',
    metric: 'CTR Promedio: 4.8%',
    agents: [
      { name: 'Agent-Copy-Ads', role: 'Optimización de Copys', status: 'analyzing', model: 'GPT-4o' },
      { name: 'Agent-Funnel-Analytic', role: 'Asignación de Presupuesto en RRSS', status: 'idle', model: 'Llama 3' }
    ],
    enabled: true,  // ← NUEVO
  }
];

export async function getCompanies(): Promise<Company[]> {
  try {
    const ids = await redis.smembers(KEY.companies);
    if (!ids || ids.length === 0) {
      for (const company of DEFAULT_COMPANIES) {
        await saveCompanyToRedis(company);
      }
      return DEFAULT_COMPANIES;
    }
    const companies = await Promise.all(
      ids.map(async (id: string) => {
        const data = await redis.get(KEY.company(id as string));
        return data as Company;
      })
    );
    return companies.filter(Boolean);
  } catch (error) {
    console.error('Error al obtener empresas de Redis:', error);
    return DEFAULT_COMPANIES;
  }
}

export async function getCompany(id: string): Promise<Company | null> {
  try {
    const data = await redis.get(KEY.company(id));
    return data as Company | null;
  } catch (error) {
    console.error('Error al obtener empresa:', error);
    return null;
  }
}

async function saveCompanyToRedis(company: Company): Promise<void> {
  await redis.sadd(KEY.companies, company.id);
  await redis.set(KEY.company(company.id), JSON.stringify(company));
}

export async function saveCompany(company: Omit<Company, 'metric' | 'agents'>): Promise<Company> {
  const newCompany: Company = {
    ...company,
    metric: '0.00% CTR / ROI',
    agents: [
      { name: 'Agent-Core-Bot', role: 'Supervisor de Entorno', status: 'idle', model: 'GPT-4o' }
    ],
    enabled: true,  // ← NUEVO: las nuevas empresas se crean encendidas
  };
  await saveCompanyToRedis(newCompany);
  return newCompany;
}

export async function addAgentToCompany(companyId: string, agent: Agent): Promise<Company | null> {
  const company = await getCompany(companyId);
  if (!company) return null;
  company.agents.push(agent);
  await redis.set(KEY.company(companyId), JSON.stringify(company));
  const agentId = companyId + ':' + agent.name;
  const independentAgent = { ...agent, id: agentId, companyId };
  await redis.set(KEY.agent(agentId), JSON.stringify(independentAgent));
  await redis.sadd(KEY.companyAgents(companyId), agentId);
  return company;
}

export async function updateCompany(id: string, updates: Partial<Company>): Promise<Company | null> {
  const company = await getCompany(id);
  if (!company) return null;
  const updated = { ...company, ...updates };
  await redis.set(KEY.company(id), JSON.stringify(updated));
  return updated;
}

export type { Company, Agent };