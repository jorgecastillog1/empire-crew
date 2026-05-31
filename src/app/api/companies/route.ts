import { NextRequest, NextResponse } from 'next/server';
import { getCompanies, saveCompany } from '@/lib/db';

export async function GET() {
  try {
    const companies = await getCompanies();
    return NextResponse.json(companies);
  } catch (error) {
    return NextResponse.json(
      { error: 'Error al obtener empresas' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, type, budget, sector } = body;

    if (!id || !name || !type || !budget || !sector) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos' },
        { status: 400 }
      );
    }

    const newCompany = await saveCompany({ id, name, type, budget, sector });
    return NextResponse.json(newCompany, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Error al guardar empresa' },
      { status: 500 }
    );
  }
}
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    const { updateCompany } = await import('../../../lib/db');
    const updated = await updateCompany(id, updates);
    if (!updated) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}