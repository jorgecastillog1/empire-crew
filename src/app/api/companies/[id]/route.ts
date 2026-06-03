import { NextRequest, NextResponse } from 'next/server';
import { getCompany, addAgentToCompany, updateCompany, Agent } from '@/lib/db';

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

// NUEVO: Actualizar cualquier campo de una empresa (ej: enabled, nombre, presupuesto, etc.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    // body puede contener { enabled: false } o cualquier otro campo a actualizar
    const updatedCompany = await updateCompany(id, body);
    
    if (!updatedCompany) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }
    
    return NextResponse.json(updatedCompany);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}