// src/app/api/marketing/test-video/route.ts
// Endpoint de prueba para enviar un prompt a Kaggle y verificar que la integración funciona

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Leer la URL de Kaggle desde variables de entorno
  const KAGGLE_URL = process.env.KAGGLE_VIDEO_API_URL;
  
  if (!KAGGLE_URL) {
    console.error('❌ KAGGLE_VIDEO_API_URL no configurada en .env.local');
    return NextResponse.json({ 
      success: false, 
      error: 'KAGGLE_VIDEO_API_URL no configurada. Añade esta variable a .env.local' 
    }, { status: 500 });
  }
  
  // Generar un ID único para este job de prueba
  const jobId = `empire_test_${Date.now()}`;
  
  // Obtener la URL base para el callback (tu sistema)
  const baseUrl = process.env.NEXTAUTH_URL || 'https://empire-crew.vercel.app';
  const callbackUrl = `${baseUrl}/api/marketing/video-callback`;
  
  // Escenas de prueba (prompts optimizados para LTX Singularity)
  // Siguiendo la estructura óptima: personaje → ambiente → acción → cámara → iluminación
  const scenes = [
    {
      prompt: "Una mujer joven de cabello negro, piel bronceada, vestido dorado, de pie en una sala de trono iluminada por antorchas de piedra antigua, niebla baja. La cámara hace un lento acercamiento hacia su rostro. Iluminación cálida lateral, sombras dramáticas, tonos ámbar. Movimiento suave y continuo, sin cortes.",
      duration_sec: 6
    },
    {
      prompt: "La mujer extiende lentamente su brazo derecho hacia adelante, con la palma hacia arriba. En su mano aparece una luz dorada brillante. Sus ojos reflejan el brillo. Fondo de columnas de piedra. Cámara estable, plano medio. Iluminación cálida que resalta el brillo de la luz en su mano.",
      duration_sec: 6
    },
    {
      prompt: "La mujer sonríe con confianza mientras cierra su mano, la luz dorada se desvanece. Mira directamente a la cámara. Iluminación cálida. Final en estático sobre su mirada, manteniendo la expresión durante 2 segundos.",
      duration_sec: 5
    }
  ];
  
  console.log(`📹 [test-video] Enviando job ${jobId} a Kaggle...`);
  console.log(`   URL Kaggle: ${KAGGLE_URL}`);
  console.log(`   Callback: ${callbackUrl}`);
  console.log(`   Escenas: ${scenes.length}`);
  
  try {
    // Enviar la solicitud a Kaggle
    const response = await fetch(`${KAGGLE_URL}/generate`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: jobId,
        scenes: scenes,
        callback_url: callbackUrl
      })
    });
    
    // Leer la respuesta
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }
    
    if (!response.ok) {
      console.error(`❌ [test-video] Kaggle respondió con error: ${response.status}`);
      console.error(`   Respuesta: ${responseText.slice(0, 500)}`);
      return NextResponse.json({ 
        success: false, 
        error: `Kaggle error: ${response.status} - ${responseText.slice(0, 200)}`,
        kaggleUrl: KAGGLE_URL
      }, { status: response.status });
    }
    
    console.log(`✅ [test-video] Job enviado exitosamente: ${jobId}`);
    console.log(`   Respuesta Kaggle: ${JSON.stringify(data)}`);
    
    return NextResponse.json({ 
      success: true, 
      jobId: data.job_id || jobId,
      status: data.status || 'queued',
      message: `Job ${jobId} encolado en Kaggle. El video se generará en segundo plano.`,
      kaggleUrl: KAGGLE_URL,
      kaggleDashboard: `${KAGGLE_URL}/dashboard`
    });
    
  } catch (error: any) {
    console.error(`❌ [test-video] Error de red: ${error.message}`);
    return NextResponse.json({ 
      success: false, 
      error: `Error de conexión: ${error.message}. Verifica que el notebook de Kaggle esté ejecutándose.`,
      kaggleUrl: KAGGLE_URL
    }, { status: 500 });
  }
}