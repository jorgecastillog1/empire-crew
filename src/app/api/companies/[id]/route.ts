import { NextRequest, NextResponse } from 'next/server';
import { getCompany, addAgentToCompany, updateCompany, Agent } from '@/lib/db';
import { redis } from '@/lib/redis';

// Obtener una empresa específica por su ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const company = await getCompany(id);
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }
    
    // 🔥 NUEVO: Para empresas de marketing, actualizar estados desde SuperAgentes
    if (company.type === 'marketing') {
      const updatedAgents = await Promise.all(
        company.agents.map(async (agent) => {
          // Buscar el SuperAgente en Redis
          const superKey = `agente:${id}:${agent.name.replace('Agente-', 'Agent-')}`;
          const superRaw = await redis.get(superKey);
          if (superRaw) {
            try {
              const superAgent = typeof superRaw === 'string' ? JSON.parse(superRaw) : superRaw;
              // Actualizar el estado del agente básico con el estado del SuperAgente
              return { ...agent, status: superAgent.status };
            } catch (e) {
              return agent;
            }
          }
          return agent;
        })
      );
      return NextResponse.json({ ...company, agents: updatedAgents });
    }
    
    return NextResponse.json(company);
  } catch (error) {
    return NextResponse.json({ error: 'Error al obtener empresa' }, { status: 500 });
  }
}

// Añadir un nuevo agente a una empresa
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { name, role, model } = body;

    if (!name || !role || !model) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }

    const newAgent: Agent = { name, role, status: 'idle', model };
    const updated = await addAgentToCompany(id, newAgent);

    if (!updated) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    return NextResponse.json(newAgent, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Error al crear agente' }, { status: 500 });
  }
}

// Actualizar cualquier campo de una empresa
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const updatedCompany = await updateCompany(id, body);
    
    if (!updatedCompany) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }
    
    return NextResponse.json(updatedCompany);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}