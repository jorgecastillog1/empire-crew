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

    // 🔥 Sincronizar estados desde SuperAgentes (Redis: agente:<companyId>:<agentName>)
    if (company.type === 'marketing') {
      const updatedAgents = await Promise.all(
        company.agents.map(async (agent) => {
          // Probar variantes del nombre por si hay inconsistencia "Agent-" vs "Agente-"
          const candidates = [
            agent.name,
            agent.name.replace('Agente-', 'Agent-'),
            agent.name.replace('Agent-', 'Agente-'),
          ];
          const uniqueCandidates = Array.from(new Set(candidates));

          for (const candidate of uniqueCandidates) {
            const superKey = `agente:${id}:${candidate}`;
            const superRaw = await redis.get(superKey);
            if (superRaw) {
              try {
                const superAgent =
                  typeof superRaw === 'string' ? JSON.parse(superRaw) : superRaw;
                if (superAgent?.status) {
                  return { ...agent, status: superAgent.status };
                }
              } catch {
                // ignorar y probar siguiente candidato
              }
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