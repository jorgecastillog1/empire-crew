import { NextRequest, NextResponse } from 'next/server';
import { getCompany, addAgentToCompany, Agent } from '@/lib/db';

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
    return NextResponse.json(company);
  } catch (error) {
    return NextResponse.json({ error: 'Error al obtener empresa' }, { status: 500 });
  }
}

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