import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, videoUrl } = body;
    if (!jobId || !videoUrl) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }
    // Guardar en Redis para después mostrarlo en el dashboard
    await redis.set(`video:job:${jobId}`, videoUrl, { ex: 86400 });
    console.log(`✅ Video recibido para ${jobId}: ${videoUrl}`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}