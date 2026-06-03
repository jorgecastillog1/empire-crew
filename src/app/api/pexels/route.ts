// src/app/api/pexels/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
const PEXELS_API_URL = 'https://api.pexels.com/v1/search';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('query');

  if (!query) {
    return NextResponse.json({ error: 'Se requiere un término de búsqueda (query)' }, { status: 400 });
  }

  if (!PEXELS_API_KEY) {
    console.error('Falta la variable de entorno PEXELS_API_KEY');
    return NextResponse.json({ error: 'API de Pexels no configurada. Contacta al administrador.' }, { status: 500 });
  }

  try {
    const url = new URL(PEXELS_API_URL);
    url.searchParams.append('query', query);
    url.searchParams.append('per_page', '15');
    url.searchParams.append('orientation', 'landscape');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: PEXELS_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error de Pexels:', response.status, errorText);
      return NextResponse.json({ error: `Error de Pexels: ${response.status}` }, { status: response.status });
    }

    const data = await response.json();
    const photos = data.photos.map((photo: any) => ({
      id: photo.id,
      url: photo.src.original,
      thumbnail: photo.src.tiny,
      alt: photo.alt || 'Imagen de Pexels',
      photographer: photo.photographer,
    }));

    return NextResponse.json({ photos, total: data.total_results });
  } catch (error: any) {
    console.error('Error interno en API de Pexels:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}