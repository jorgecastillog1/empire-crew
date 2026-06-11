// src/app/api/marketing/video-callback/route.ts
// Endpoint que recibe el callback de Kaggle cuando el video está listo
// Kaggle envía: { job_id, status, video_url, format, error }

import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { executeTool } from '@/lib/thoth';
import { logOrchestratorAction } from '@/lib/orchestrator';

export async function POST(request: NextRequest) {
  try {
    // Leer el cuerpo de la petición
    const body = await request.json();
    const { job_id, status, video_url, format, error } = body;
    
    console.log(`📹 [callback] Recibido callback para job: ${job_id}`);
    console.log(`   Estado: ${status}`);
    console.log(`   Video URL: ${video_url || 'pendiente'}`);
    
    // Registrar en el log del orquestador
    await logOrchestratorAction(`video-callback:${job_id}:${status}`);
    
    // Caso 1: Video completado exitosamente
    if (status === 'completed' && video_url) {
      // Guardar en Redis (clave principal)
      const videoData = {
        jobId: job_id,
        status: 'done',
        videoUrl: video_url,
        format: format || 'mp4',
        completedAt: new Date().toISOString(),
        receivedAt: Date.now()
      };
      
      await redis.set(`video:job:${job_id}`, JSON.stringify(videoData));
      
      // También actualizar el registro de marketing si existe
      const marketingJobRaw = await redis.get(`marketing:video:${job_id}`);
      if (marketingJobRaw) {
        const marketingJob = typeof marketingJobRaw === 'string' 
          ? JSON.parse(marketingJobRaw) 
          : marketingJobRaw;
        marketingJob.status = 'done';
        marketingJob.videoUrl = video_url;
        marketingJob.completedAt = Date.now();
        await redis.set(`marketing:video:${job_id}`, JSON.stringify(marketingJob));
      }
      
      // Notificar por Telegram
      const telegramMessage = `🎬 **VIDEO LISTO**\n\n` +
        `📹 **Job:** ${job_id}\n` +
        `📱 **Formato:** ${format || 'mp4'}\n` +
        `🔗 **URL:** ${video_url}\n\n` +
        `_El video ha sido generado y está disponible para descargar o publicar._`;
      
      await executeTool('telegram_notify', { message: telegramMessage });
      
      console.log(`✅ [callback] Video guardado: ${video_url}`);
      
      return NextResponse.json({ 
        success: true, 
        message: 'Video callback procesado correctamente',
        job_id: job_id
      });
    }
    
    // Caso 2: Error en la generación
    if (status === 'error') {
      // Guardar error en Redis
      const errorData = {
        jobId: job_id,
        status: 'error',
        error: error || 'Error desconocido en Kaggle',
        completedAt: new Date().toISOString(),
        receivedAt: Date.now()
      };
      
      await redis.set(`video:job:${job_id}`, JSON.stringify(errorData));
      
      // También actualizar el registro de marketing
      const marketingJobRaw = await redis.get(`marketing:video:${job_id}`);
      if (marketingJobRaw) {
        const marketingJob = typeof marketingJobRaw === 'string' 
          ? JSON.parse(marketingJobRaw) 
          : marketingJobRaw;
        marketingJob.status = 'error';
        marketingJob.error = error;
        marketingJob.completedAt = Date.now();
        await redis.set(`marketing:video:${job_id}`, JSON.stringify(marketingJob));
      }
      
      // Notificar error por Telegram
      const errorMessage = `❌ **ERROR EN VIDEO**\n\n` +
        `📹 **Job:** ${job_id}\n` +
        `⚠️ **Error:** ${error || 'Desconocido'}\n\n` +
        `_Revisa el notebook de Kaggle para más detalles._`;
      
      await executeTool('telegram_notify', { message: errorMessage });
      
      console.error(`❌ [callback] Error en job ${job_id}: ${error}`);
      
      return NextResponse.json({ 
        success: false, 
        error: error,
        job_id: job_id
      });
    }
    
    // Caso 3: Estado desconocido o no manejado
    console.warn(`⚠️ [callback] Estado no reconocido: ${status} para job ${job_id}`);
    return NextResponse.json({ 
      success: true, 
      message: `Callback recibido pero estado '${status}' no requiere acción`,
      job_id: job_id
    });
    
  } catch (error: any) {
    console.error('❌ [callback] Error procesando callback:', error);
    await logOrchestratorAction(`video-callback:error:${error.message}`);
    
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

// Opcional: Endpoint GET para consultar el estado de un job
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  
  if (!jobId) {
    return NextResponse.json({ error: 'Se requiere parámetro jobId' }, { status: 400 });
  }
  
  try {
    const raw = await redis.get(`video:job:${jobId}`);
    if (!raw) {
      return NextResponse.json({ status: 'not_found', jobId }, { status: 404 });
    }
    
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return NextResponse.json(data);
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}