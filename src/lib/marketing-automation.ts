// src/lib/marketing-automation.ts
// Versión DEFINITIVA - Con video blueprint 9:16, voz ElevenLabs, validación de duración
// Incluye todas las recomendaciones para videos virales de venta (>60s, 5+ escenas)

import { redis } from './redis';
import { callLLM } from './orchestrator';
import { executeTool } from './thoth';
import { writeProof } from './omk';
import { logOrchestratorAction } from './orchestrator';

// ============================================================
// Tipos
// ============================================================

export interface AffiliateProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  commission: number;
  platform: string;
  affiliateUrl: string;
  imageUrl?: string;
  videoUrl?: string;
  category?: string;
  rating?: number;
}

export interface VideoScene {
  duration_sec: number;
  visual_prompt: string;
  narration_text: string;
  emotion: 'urgent' | 'inspiring' | 'trust' | 'curiosity';
}

export interface VideoBlueprint {
  strategy: 'AIDA' | 'PAS' | 'STORYBRAND' | 'BAB';
  totalDuration: number;
  scenes: VideoScene[];
  music_genre: 'energetic' | 'emotional' | 'corporate' | 'suspense';
  text_overlays: {
    hook_text: string;
    cta_text: string;
    price_text?: string;
  };
}

export interface CampaignContent {
  hook: string;
  uniqueValueProp: string;
  socialProof: string;
  urgentCallToAction: string;
  fullCopy: string;
  videoScript: string;
  leadMagnetMarkdown: string;
  videoBlueprint: VideoBlueprint;
}

export interface CampaignData {
  product: AffiliateProduct;
  hook: string;
  uniqueValueProp: string;
  socialProof: string;
  urgentCallToAction: string;
  fullCopy: string;
  leadMagnetUrl: string;
  funnelUrl: string;
  imageUrl: string;
  videoUrl: string;
  publishedAt: number;
  success: boolean;
  error?: string;
}

export interface MarketingCycleLog {
  timestamp: number;
  productsFound: number;
  productsFiltered: number;
  campaignsGenerated: number;
  published: number;
  errors: string[];
}

// ============================================================
// Configuración
// ============================================================

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const API_KEY = process.env.CLOUDINARY_API_KEY || '';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const UPLOAD_PRESET = 'empire_marketing_leadmagnets';

const HOTMART_CLIENT_ID = process.env.HOTMART_CLIENT_ID || '';
const HOTMART_CLIENT_SECRET = process.env.HOTMART_CLIENT_SECRET || '';
const HOTMART_AFFILIATE_ID = process.env.HOTMART_AFFILIATE_ID || '';
let hotmartAccessToken: string | null = null;
let tokenExpiresAt = 0;

const KAGGLE_VIDEO_API_URL = process.env.KAGGLE_VIDEO_API_URL || '';

// Constantes de video
const MIN_VIDEO_DURATION = 60;  // segundos mínimo para algoritmo
const MAX_VIDEO_DURATION = 90;  // segundos máximo para retención
const DEFAULT_FPS = 24;
const DEFAULT_ASPECT_RATIO = '9:16';
const DEFAULT_VOICE_ID = 'es-CO-LinaNeural';
const DEFAULT_MUSIC_GENRE = 'energetic';

// ============================================================
// Helper: Autenticación Hotmart
// ============================================================

async function getHotmartToken(): Promise<string> {
  if (hotmartAccessToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return hotmartAccessToken;
  }
  if (!HOTMART_CLIENT_ID || !HOTMART_CLIENT_SECRET) {
    throw new Error('Hotmart no configurado: faltan client ID/secret');
  }
  const auth = Buffer.from(`${HOTMART_CLIENT_ID}:${HOTMART_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://api.hotmart.com/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) {
    throw new Error(`Hotmart auth error: ${response.status}`);
  }
  const data = await response.json();
  hotmartAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);
  if (!hotmartAccessToken) throw new Error('Hotmart no devolvió token');
  return hotmartAccessToken;
}

// ============================================================
// Helper: Buscar productos en Hotmart
// ============================================================

async function searchHotmartProducts(query: string = ''): Promise<AffiliateProduct[]> {
  console.log(`🔍 [HOTMART DEBUG] Iniciando búsqueda...`);
  console.log(`🔍 [HOTMART DEBUG] Query: "${query}"`);
  
  const token = await getHotmartToken();
  console.log(`🔍 [HOTMART DEBUG] Token obtenido: ${token ? 'OK' : 'VACIO'}`);
  
  let url = 'https://api.hotmart.com/products/api/v2/products?product_status=ACTIVE&max_results=10';
  if (query) url += `&name=${encodeURIComponent(query)}`;
  
  console.log(`🔍 [HOTMART DEBUG] URL: ${url}`);
  
  const response = await fetch(url, {
    headers: { 
      'Authorization': `Bearer ${token}`, 
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
  });
  
  console.log(`🔍 [HOTMART DEBUG] Response status: ${response.status} ${response.statusText}`);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ [HOTMART DEBUG] Error body: ${errorText}`);
    throw new Error(`Hotmart API error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log(`🔍 [HOTMART DEBUG] Data recibida, items: ${data.items?.length || data.data?.length || 0}`);
  
  const items = data.items || data.data || [];
  if (!items.length) {
    console.warn(`⚠️ [HOTMART DEBUG] No se encontraron productos`);
    logOrchestratorAction('marketing:hotmart:no_products');
    return [];
  }
  
  const affiliateId = HOTMART_AFFILIATE_ID || 'sin_afiliado';
  console.log(`🔍 [HOTMART DEBUG] Affiliate ID: ${affiliateId}`);
  
  const products = items.map((item: any) => {
    const productId = item.id?.toString() || item.productId?.toString();
    let affiliateUrl = `https://hotmart.com/product/${productId}?affiliate_id=${affiliateId}`;
    if (!productId || affiliateId === 'sin_afiliado') {
      affiliateUrl = 'https://hotmart.com/error-no-affiliate-id';
      logOrchestratorAction(`marketing:hotmart:missing_affiliate_id for ${item.name}`);
    }
    return {
      id: productId || `hotmart-${Date.now()}`,
      name: item.name || 'Sin nombre',
      description: item.shortDescription || item.description || 'Sin descripción',
      price: item.price?.amount || 0,
      commission: item.commission?.percent || 0,
      platform: 'hotmart',
      affiliateUrl,
      category: item.category?.name || '',
      rating: item.rating || 0,
    };
  });
  
  console.log(`✅ [HOTMART DEBUG] Productos procesados: ${products.length}`);
  return products;
}

// ============================================================
// Helper: Subir lead magnet o funnel a Cloudinary
// ============================================================

async function uploadToCloudinary(content: string, publicId: string, contentType: 'text/markdown' | 'text/html'): Promise<string> {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) throw new Error('Cloudinary no configurado');
  const extension = contentType === 'text/markdown' ? 'md' : 'html';
  const mimeType = contentType === 'text/markdown' ? 'text/plain' : 'text/html';
  const blob = new Blob([content], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, `${publicId}.${extension}`);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('public_id', `marketing/${publicId}`);
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`;
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`Cloudinary error: ${response.status}`);
  const data = await response.json();
  return data.secure_url;
}

// ============================================================
// Helper: Imagen de Pexels
// ============================================================

async function searchPexelsImage(query: string): Promise<string> {
  const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
  if (!PEXELS_API_KEY) return '';
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`, {
    headers: { Authorization: PEXELS_API_KEY },
  });
  const data = await res.json();
  return data.photos?.[0]?.src?.original || '';
}

// ============================================================
// Helper: Scraping de plataforma
// ============================================================

async function scrapePlatform(platform: string): Promise<AffiliateProduct[]> {
  logOrchestratorAction(`marketing:scraping:${platform}`);
  if (platform === 'hotmart') {
    try {
      const raw = await redis.get<string>('empire:marketing:hotmart-watchlist');
      const products = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      if (!products.length) {
        logOrchestratorAction('marketing:hotmart:watchlist_vacia');
        return [];
      }
      logOrchestratorAction(`marketing:hotmart:watchlist:${products.length}_productos`);
      return products;
    } catch (error: any) {
      logOrchestratorAction(`marketing:hotmart_error:${error.message}`);
      return [];
    }
  }
  return [];
}

// ============================================================
// Filtrar productos con IA
// ============================================================

async function filterProductsByAI(products: AffiliateProduct[], forcedProductName?: string): Promise<AffiliateProduct[]> {
  if (products.length === 0) return [];

  if (forcedProductName) {
    const normalized = forcedProductName.toLowerCase();
    const match = products.find(p =>
      p.name.toLowerCase().includes(normalized) || p.id.toLowerCase().includes(normalized)
    );
    return match ? [match] : [];
  }

  const systemPrompt = `Eres un experto en marketing de afiliados. Selecciona los 3 mejores productos. Responde SOLO con un array de índices en JSON.`;
  const userMessage = `Productos:\n${products.map((p, i) => `${i}: ${p.name} - $${p.price} - ${p.commission}%`).join('\n')}`;
  const result = await callLLM({
    systemPrompt,
    userMessage,
    agentId: 'marketing-filter',
    maxTokens: 200,
  });
  try {
    const indices = JSON.parse(result.response);
    return products.filter((_, i) => indices.includes(i));
  } catch {
    return products.slice(0, 1);
  }
}

// ============================================================
// ⭐ GENERAR CONTENIDO DE CAMPAÑA (CON VIDEO BLUEPRINT)
// ============================================================

async function generateCampaignContent(product: AffiliateProduct): Promise<CampaignContent> {
  const systemPrompt = `Eres un estratega de video viral para TikTok/Reels/Shorts. Tu misión es diseñar un video que VENDA el producto.

REGLAS ESTRICTAS:
1. El video debe durar entre ${MIN_VIDEO_DURATION} y ${MAX_VIDEO_DURATION} SEGUNDOS (más de 60s para algoritmo, menos de 90s para retención)
2. Usa la estructura: HOOK (3s) → PROBLEMA (10s) → AGITACIÓN (15s) → SOLUCIÓN (20s) → PRUEBA SOCIAL (10s) → CTA (5s)
3. MÍNIMO 5 escenas, MÁXIMO 8 escenas
4. Cada escena debe tener:
   - duration_sec: entre 4 y 12 segundos (según complejidad)
   - visual_prompt: SOLO descripción visual en INGLÉS, sin texto, sin palabras de venta, incluye movimiento de cámara
   - narration_text: guión para voice-over en ESPAÑOL, conversacional, como amigo recomendando
   - emotion: "urgent" | "inspiring" | "trust" | "curiosity"
5. VOZ recomendada: "${DEFAULT_VOICE_ID}" (colombiana, cálida, persuasiva)
6. MÚSICA: "energetic" para energía, "emotional" para storytelling

Responde SOLO con JSON en este formato exacto:
{
  "strategy": "AIDA|PAS|STORYBRAND|BAB",
  "totalDuration": 75,
  "scenes": [
    {
      "duration_sec": 6,
      "visual_prompt": "A frustrated woman in her 30s sitting at a messy desk at night, dark circles under eyes, looking at phone showing 6am alarm. Low angle, slow zoom in on her face. Blue cold light from phone screen. Tired expression. Camera slowly pushes in.",
      "narration_text": "¿Te cuesta despertar cada mañana? Suena el despertador y ya quieres apagarlo...",
      "emotion": "urgent"
    }
  ],
  "music_genre": "energetic",
  "text_overlays": {
    "hook_text": "🔥 ¿CANSADO DE DESPERTAR ASÍ?",
    "cta_text": "🔗 LINK EN BIO - ÚLTIMAS 48H",
    "price_text": "🎁 OFERTA ESPECIAL $${product.price}"
  }
}`;

  const userMessage = `Producto: ${product.name}
Descripción: ${product.description}
Precio: $${product.price}
Comisión: ${product.commission}%
Plataforma: ${product.platform}`;

  const result = await callLLM({
    systemPrompt,
    userMessage,
    agentId: 'video-strategist',
    maxTokens: 2500,
    temperature: 0.7,
  });

  try {
    const clean = result.response.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    
    // Validar que tenga al menos 5 escenas
    if (!parsed.scenes || parsed.scenes.length < 5) {
      console.warn('⚠️ Blueprint con menos de 5 escenas, usando valores por defecto');
      throw new Error('Invalid blueprint');
    }
    
    // Validar duración total
    let totalDuration = parsed.scenes.reduce((sum: number, s: any) => sum + s.duration_sec, 0);
    if (totalDuration < MIN_VIDEO_DURATION) {
      console.warn(`⚠️ Video muy corto: ${totalDuration}s. Ajustando a ${MIN_VIDEO_DURATION}s...`);
      const scale = MIN_VIDEO_DURATION / totalDuration;
      for (const scene of parsed.scenes) {
        scene.duration_sec = Math.round(scene.duration_sec * scale);
      }
    }
    if (totalDuration > MAX_VIDEO_DURATION) {
      console.warn(`⚠️ Video muy largo: ${totalDuration}s. Ajustando a ${MAX_VIDEO_DURATION}s...`);
      const scale = MAX_VIDEO_DURATION / totalDuration;
      for (const scene of parsed.scenes) {
        scene.duration_sec = Math.round(scene.duration_sec * scale);
      }
    }
    
    // Asegurar que cada visual_prompt tenga movimiento explícito
    const movementKeywords = ['camera', 'move', 'pan', 'zoom', 'dolly', 'slow', 'rotate', 'push', 'track'];
    for (const scene of parsed.scenes) {
      const hasMovement = movementKeywords.some(kw => scene.visual_prompt.toLowerCase().includes(kw));
      if (!hasMovement && scene.duration_sec >= 6) {
        scene.visual_prompt += ' Slow camera dolly forward, subtle cinematic movement, professional tracking shot, not static.';
      } else if (!hasMovement && scene.duration_sec <= 5) {
        scene.visual_prompt += ' Micro camera movement, slightly dynamic, breathing motion, not completely static.';
      }
    }
    
    return {
      hook: parsed.text_overlays?.hook_text || `🔥 ¡ATENCIÓN!`,
      uniqueValueProp: product.description.slice(0, 100) || `La herramienta que necesitas`,
      socialProof: `Más de 1000 clientes satisfechos`,
      urgentCallToAction: parsed.text_overlays?.cta_text || `COMPRA ANTES DE 48H`,
      fullCopy: `${parsed.text_overlays?.hook_text || '🔥'} ${product.name}. ${parsed.text_overlays?.cta_text || 'Oferta limitada.'}`,
      videoScript: JSON.stringify(parsed.scenes),
      leadMagnetMarkdown: `# Guía gratuita: ${product.name}\n\n## ¿Qué vas a aprender?\n\nContenido exclusivo para ti...`,
      videoBlueprint: parsed,
    };
    
  } catch (error) {
    console.error('Error parsing blueprint, using fallback:', error);
    
    // FALLBACK: 5 escenas mínimas garantizadas
    const fallbackScenes: VideoScene[] = [
      {
        duration_sec: 8,
        visual_prompt: `Person frustrated with problem. Close up on face, tired expression. Slow zoom in. Professional lighting, cinematic quality.`,
        narration_text: `¿Te pasa esto a ti también?`,
        emotion: 'urgent'
      },
      {
        duration_sec: 12,
        visual_prompt: `The problem getting worse. Dramatic lighting, worried expression. Camera shake slightly, tension building.`,
        narration_text: `Y cada día es peor, ¿verdad?`,
        emotion: 'urgent'
      },
      {
        duration_sec: 15,
        visual_prompt: `Solution appears. Warm lighting, hopeful expression. Slow dolly forward towards the solution. Golden hour glow.`,
        narration_text: `Pero hay una solución. Y es más simple de lo que crees.`,
        emotion: 'inspiring'
      },
      {
        duration_sec: 20,
        visual_prompt: `Person using ${product.name}, seeing results. Smiling, confident. Medium shot, stable camera. Bright, energetic atmosphere.`,
        narration_text: `Mira los resultados. En solo 5 minutos al día. ${product.name} cambia todo.`,
        emotion: 'trust'
      },
      {
        duration_sec: 10,
        visual_prompt: `Person pointing to camera, confident smile. Direct eye contact, warm lighting. Final frame holds for 2 seconds.`,
        narration_text: `Link en bio. Oferta por tiempo limitado. No te lo pierdas.`,
        emotion: 'urgent'
      }
    ];
    
    const fallbackBlueprint: VideoBlueprint = {
      strategy: 'AIDA',
      totalDuration: fallbackScenes.reduce((sum, s) => sum + s.duration_sec, 0),
      scenes: fallbackScenes,
      music_genre: DEFAULT_MUSIC_GENRE,
      text_overlays: {
        hook_text: `🔥 ¿TE SIENTES IDENTIFICADO?`,
        cta_text: `🔗 LINK EN BIO - OFERTA LIMITADA`,
        price_text: product.price > 0 ? `🎁 $${product.price}` : undefined
      }
    };
    
    return {
      hook: `🔥 ¡ATENCIÓN!`,
      uniqueValueProp: product.description.slice(0, 100) || `La herramienta que necesitas`,
      socialProof: `Más de 1000 clientes satisfechos`,
      urgentCallToAction: `COMPRA ANTES DE 48H`,
      fullCopy: `¿Listo para transformar tu vida? ${product.name} es la clave. 🔥 Oferta limitada.`,
      videoScript: JSON.stringify(fallbackScenes),
      leadMagnetMarkdown: `# Guía gratuita: ${product.name}\n\nContenido exclusivo...`,
      videoBlueprint: fallbackBlueprint,
    };
  }
}

// ============================================================
// Generar funnel HTML
// ============================================================

function generateFunnelHtml(product: AffiliateProduct, content: {
  hook: string;
  fullCopy: string;
  urgentCallToAction: string;
  leadMagnetUrl: string;
  imageUrl: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${product.name}</title><style>
body{background:#000;color:#fff;font-family:system-ui;text-align:center;padding:20px;margin:0}.container{max-width:600px;margin:auto}.hook{font-size:2rem;font-weight:bold;margin:20px 0}img{max-width:100%;border-radius:16px;margin:20px 0}.cta{background:#ff4757;color:#fff;padding:14px 28px;border-radius:40px;text-decoration:none;display:inline-block;font-weight:bold;margin:20px 0}.lead-magnet{background:#1e1e1e;padding:15px;border-radius:12px;margin:20px}</style></head>
<body><div class="container"><div class="hook">${content.hook}</div><img src="${content.imageUrl}" /><p>${content.fullCopy}</p><div class="lead-magnet">📘 <a href="${content.leadMagnetUrl}" style="color:#ff4757;">Descarga tu guía gratuita</a></div><a href="${product.affiliateUrl}" class="cta">${content.urgentCallToAction}</a></div></body></html>`;
}

// ============================================================
// Publicación en Telegram
// ============================================================

async function publishToTelegram(message: string): Promise<boolean> {
  try {
    await executeTool('telegram_notify', { message: `📢 Nueva campaña automática\n\n${message}` });
    return true;
  } catch {
    return false;
  }
}

async function publishCampaignToAllNetworks(campaign: CampaignData): Promise<number> {
  let count = 0;
  const msg = `${campaign.hook}\n\n${campaign.fullCopy}\n\n${campaign.urgentCallToAction}\n🔗 ${campaign.product.affiliateUrl}\n📘 Lead Magnet: ${campaign.leadMagnetUrl}\n📄 Funnel: ${campaign.funnelUrl}`;
  if (await publishToTelegram(msg)) count++;
  return count;
}

// ============================================================
// ⭐ FUNCIÓN: Enviar a Kaggle con BLUEPRINT completo
// ============================================================

async function triggerKaggleVideoGeneration(
  product: AffiliateProduct, 
  content: CampaignContent,
  jobId?: string
): Promise<{ jobId: string; status: string; message?: string }> {
  
  if (!KAGGLE_VIDEO_API_URL) {
    console.error('❌ KAGGLE_VIDEO_API_URL no configurada');
    logOrchestratorAction('marketing:video:error:no_kaggle_url');
    return { jobId: 'error', status: 'no_kaggle_url', message: 'KAGGLE_VIDEO_API_URL no configurada' };
  }
  
  const finalJobId = jobId || `hotmart_${product.id}_${Date.now()}`;
  const callbackUrl = `${process.env.NEXTAUTH_URL || 'https://empire-crew.vercel.app'}/api/marketing/video-callback`;
  
  // Usar el blueprint generado por IA
  const blueprint = content.videoBlueprint;
  let scenes = [];
  
  if (blueprint && blueprint.scenes && blueprint.scenes.length >= 5) {
    scenes = blueprint.scenes.map((scene: VideoScene) => ({
      visual_prompt: scene.visual_prompt,
      duration_sec: scene.duration_sec,
      narration_text: scene.narration_text,
      emotion: scene.emotion
    }));
    
    // Validar duración total
    let totalDuration = scenes.reduce((sum: number, s: any) => sum + s.duration_sec, 0);
    
    if (totalDuration < MIN_VIDEO_DURATION) {
      console.warn(`⚠️ Video muy corto: ${totalDuration}s. Ajustando a ${MIN_VIDEO_DURATION}s...`);
      const scale = MIN_VIDEO_DURATION / totalDuration;
      for (const scene of scenes) {
        scene.duration_sec = Math.round(scene.duration_sec * scale);
      }
      totalDuration = MIN_VIDEO_DURATION;
      console.log(`   📏 Duración ajustada a ${totalDuration}s`);
    }
    
    if (totalDuration > MAX_VIDEO_DURATION) {
      console.warn(`⚠️ Video muy largo: ${totalDuration}s. Ajustando a ${MAX_VIDEO_DURATION}s...`);
      const scale = MAX_VIDEO_DURATION / totalDuration;
      for (const scene of scenes) {
        scene.duration_sec = Math.round(scene.duration_sec * scale);
      }
      totalDuration = MAX_VIDEO_DURATION;
      console.log(`   📏 Duración ajustada a ${totalDuration}s`);
    }
    
    console.log(`📹 Blueprint validado: ${scenes.length} escenas, ${totalDuration}s totales`);
    
  } else {
    // FALLBACK: construir 5 escenas manualmente
    console.warn('⚠️ No hay blueprint válido, usando escenas por defecto');
    scenes = [
      {
        visual_prompt: `Person frustrated with problem. Close up on face, tired expression. Slow zoom in. Professional lighting, cinematic quality.`,
        duration_sec: 8,
        narration_text: content.hook || `¿Te pasa esto a ti también?`,
        emotion: 'urgent'
      },
      {
        visual_prompt: `The problem getting worse. Dramatic lighting, worried expression. Camera shake slightly, tension building.`,
        duration_sec: 12,
        narration_text: content.uniqueValueProp || `Y cada día es peor, ¿verdad?`,
        emotion: 'urgent'
      },
      {
        visual_prompt: `Solution appears. Warm lighting, hopeful expression. Slow dolly forward towards the solution. Golden hour glow.`,
        duration_sec: 15,
        narration_text: content.socialProof || `Pero hay una solución. Y es más simple de lo que crees.`,
        emotion: 'inspiring'
      },
      {
        visual_prompt: `Person using the solution, seeing results. Smiling, confident. Medium shot, stable camera. Bright, energetic atmosphere.`,
        duration_sec: 20,
        narration_text: content.fullCopy || `Mira los resultados. En solo 5 minutos al día.`,
        emotion: 'trust'
      },
      {
        visual_prompt: `Person pointing to camera, confident smile. Direct eye contact, warm lighting. Final frame holds for 2 seconds.`,
        duration_sec: 10,
        narration_text: content.urgentCallToAction || `Link en bio. Oferta por tiempo limitado. No te lo pierdas.`,
        emotion: 'urgent'
      }
    ];
  }
  
  // Asegurar movimiento en cada escena (redundante pero seguro)
  const movementKeywords = ['camera', 'move', 'pan', 'zoom', 'dolly', 'slow', 'rotate', 'push', 'track'];
  for (const scene of scenes) {
    const hasMovement = movementKeywords.some(kw => scene.visual_prompt.toLowerCase().includes(kw));
    if (!hasMovement && scene.duration_sec >= 6) {
      scene.visual_prompt += ' Slow camera dolly forward, subtle cinematic movement, professional tracking shot, not static.';
    } else if (!hasMovement && scene.duration_sec <= 5) {
      scene.visual_prompt += ' Micro camera movement, slightly dynamic, breathing motion, not completely static.';
    }
  }
  
  const payload = {
    job_id: finalJobId,
    scenes: scenes,
    callback_url: callbackUrl,
    text_overlays: blueprint?.text_overlays || {
      hook_text: content.hook?.slice(0, 30) || '🔥 ¡ATENCIÓN!',
      cta_text: content.urgentCallToAction || '🔗 LINK EN BIO',
      price_text: product.price > 0 ? `🎁 $${product.price}` : undefined
    },
    music_genre: blueprint?.music_genre || DEFAULT_MUSIC_GENRE,
    voice_id: DEFAULT_VOICE_ID,
    aspect_ratio: DEFAULT_ASPECT_RATIO
  };
  
  const totalDuration = scenes.reduce((sum, s) => sum + s.duration_sec, 0);
  console.log(`📹 Enviando job ${finalJobId} a Kaggle...`);
  console.log(`   Escenas: ${scenes.length}, Duración total: ${totalDuration}s, Formato: ${DEFAULT_ASPECT_RATIO}`);
  logOrchestratorAction(`marketing:video:enviando:${finalJobId}`);
  
  try {
    const response = await fetch(`${KAGGLE_VIDEO_API_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`✅ Video job encolado: ${finalJobId} - ${data.status}`);
    logOrchestratorAction(`marketing:video:encolado:${finalJobId}`);
    
    await redis.set(`marketing:video:${finalJobId}`, JSON.stringify({
      productId: product.id,
      productName: product.name,
      status: 'queued',
      createdAt: Date.now(),
      scenes: scenes.length,
      totalDuration: totalDuration,
      aspectRatio: DEFAULT_ASPECT_RATIO
    }));
    
    return { 
      jobId: finalJobId, 
      status: data.status || 'queued',
      message: `Video encolado en Kaggle (${scenes.length} escenas, ${totalDuration}s, ${DEFAULT_ASPECT_RATIO})`
    };
    
  } catch (error: any) {
    console.error(`❌ Error enviando a Kaggle: ${error.message}`);
    logOrchestratorAction(`marketing:video:error:${error.message}`);
    return { jobId: finalJobId, status: 'error', message: error.message };
  }
}

// ============================================================
// FUNCIÓN AUXILIAR: Actualizar estado de un agente
// ============================================================

async function updateAgentStatus(agentName: string, status: 'idle' | 'analyzing' | 'executing' | 'deliberating' | 'vetoed'): Promise<void> {
  try {
    const { loadAgentState, saveAgentState } = await import('./orchestrator');
    const agent = await loadAgentState('marketing-pro', agentName);
    if (agent) {
      agent.status = status;
      await saveAgentState(agent);
      await logOrchestratorAction(`marketing:agent:${agentName}:${status}`);
      console.log(`📊 Agente ${agentName} → ${status}`);
    } else {
      console.log(`⚠️ Agente no encontrado: ${agentName}`);
    }
  } catch (e) {
    console.error(`Error actualizando estado de ${agentName}:`, e);
  }
}

// ============================================================
// ⭐ CICLO PRINCIPAL DE MARKETING (con todas las mejoras)
// ============================================================

export async function runMarketingCycle(forcedProductName?: string): Promise<MarketingCycleLog> {
  const startTime = Date.now();
  const errors: string[] = [];
  let productsFound = 0, productsFiltered = 0, campaignsGenerated = 0, published = 0;
  
  await logOrchestratorAction('marketing:cycle:start');
  
  // PASO 1: Poner agentes en "analyzing"
  const agentNames = [
    'Agent-Neuro-Copywriter',
    'Agent-Funnel-Architect',
    'Agent-Audience-Intel',
    'Agent-Affiliate-Scout',
    'Agent-SEO-Dominator',
    'Agent-Ad-Creative',
    'Agent-Analytics-Intelligence',
    'Agent-Budget-Allocator',
    'Agent-Campaign-Automator',
    'Agent-Video-Producer'
  ];
  
  console.log('🟡 Iniciando ciclo de marketing (Modo Viral 9:16)...');
  for (const name of agentNames) {
    await updateAgentStatus(name, 'analyzing');
  }
  
  try {
    // PASO 2: Agent-Affiliate-Scout busca productos
    await updateAgentStatus('Agent-Affiliate-Scout', 'executing');
    console.log('🔍 Buscando productos afiliados...');
    
    const platforms = ['hotmart'];
    let allProducts: AffiliateProduct[] = [];
    for (const platform of platforms) {
      try {
        const prods = await scrapePlatform(platform);
        allProducts.push(...prods);
        productsFound += prods.length;
      } catch (err: any) {
        errors.push(`Scraping ${platform}: ${err.message}`);
      }
    }
    console.log(`📦 Productos encontrados: ${productsFound}`);
    await updateAgentStatus('Agent-Affiliate-Scout', 'analyzing');
    
    // PASO 3: Agent-SEO-Dominator filtra productos
    await updateAgentStatus('Agent-SEO-Dominator', 'executing');
    console.log('🎯 Filtrando mejores productos...');
    
    const bestProducts = await filterProductsByAI(allProducts, forcedProductName);
    if (forcedProductName && bestProducts.length === 0) {
      errors.push(`No se encontró el producto "${forcedProductName}" en la watchlist`);
    }
    productsFiltered = bestProducts.length;
    console.log(`📌 Productos filtrados: ${productsFiltered}`);
    
    await updateAgentStatus('Agent-SEO-Dominator', 'analyzing');
    
    // PASO 4: Procesar cada producto
    for (const product of bestProducts) {
      try {
        console.log(`\n📹 Procesando producto: ${product.name}`);
        
        // 4.1 Agent-Neuro-Copywriter genera contenido (con video blueprint)
        await updateAgentStatus('Agent-Neuro-Copywriter', 'executing');
        console.log('✍️ Generando copy y blueprint de video...');
        const content = await generateCampaignContent(product);
        await updateAgentStatus('Agent-Neuro-Copywriter', 'analyzing');
        
        // 4.2 Agent-Ad-Creative busca imagen
        await updateAgentStatus('Agent-Ad-Creative', 'executing');
        console.log('🖼️ Buscando imagen para el producto...');
        const imageUrl = await searchPexelsImage(product.name);
        await updateAgentStatus('Agent-Ad-Creative', 'analyzing');
        
        // 4.3 Agent-Video-Producer envía blueprint a Kaggle
        let videoUrl = '';
        let videoJobId = '';
        
        if (KAGGLE_VIDEO_API_URL) {
          await updateAgentStatus('Agent-Video-Producer', 'executing');
          console.log('🎬 Enviando blueprint de video a Kaggle...');
          console.log(`   Estrategia: ${content.videoBlueprint.strategy}`);
          console.log(`   Escenas: ${content.videoBlueprint.scenes.length}`);
          console.log(`   Duración total: ${content.videoBlueprint.totalDuration}s`);
          console.log(`   Formato: ${DEFAULT_ASPECT_RATIO}`);
          console.log(`   Música: ${content.videoBlueprint.music_genre}`);
          
          const videoResult = await triggerKaggleVideoGeneration(product, content);
          videoJobId = videoResult.jobId;
          videoUrl = '';
          console.log(`📹 Video job ${videoJobId} encolado, esperando callback...`);
          await updateAgentStatus('Agent-Video-Producer', 'analyzing');
        } else {
          logOrchestratorAction('marketing:video:skip:no_kaggle_url');
          console.warn('⚠️ KAGGLE_VIDEO_API_URL no configurada, omitiendo generación de video');
        }
        
        // 4.4 Agent-Funnel-Architect construye funnel
        await updateAgentStatus('Agent-Funnel-Architect', 'executing');
        console.log('🏗️ Construyendo funnel de venta...');
        const leadMagnetUrl = await uploadToCloudinary(content.leadMagnetMarkdown, `leadmagnet_${product.id}_${Date.now()}`, 'text/markdown');
        const funnelHtml = generateFunnelHtml(product, {
          hook: content.hook,
          fullCopy: content.fullCopy,
          urgentCallToAction: content.urgentCallToAction,
          leadMagnetUrl,
          imageUrl,
        });
        const funnelUrl = await uploadToCloudinary(funnelHtml, `funnel_${product.id}_${Date.now()}`, 'text/html');
        await updateAgentStatus('Agent-Funnel-Architect', 'analyzing');
        
        // 4.5 Agent-Campaign-Automator publica
        await updateAgentStatus('Agent-Campaign-Automator', 'executing');
        console.log('📢 Publicando campaña en redes...');
        
        const campaign: CampaignData = {
          product: { ...product, imageUrl, videoUrl },
          hook: content.hook,
          uniqueValueProp: content.uniqueValueProp,
          socialProof: content.socialProof,
          urgentCallToAction: content.urgentCallToAction,
          fullCopy: content.fullCopy,
          leadMagnetUrl,
          funnelUrl,
          imageUrl,
          videoUrl: videoUrl,
          publishedAt: Date.now(),
          success: true,
        };
        
        const pubCount = await publishCampaignToAllNetworks(campaign);
        published += pubCount;
        campaignsGenerated++;
        await redis.lpush('empire:marketing:campaigns', JSON.stringify(campaign));
        await redis.ltrim('empire:marketing:campaigns', 0, 99);
        
        await updateAgentStatus('Agent-Campaign-Automator', 'analyzing');
        console.log(`✅ Campaña generada para: ${product.name}`);
        console.log(`   📹 Video job: ${videoJobId || 'N/A'}`);
        console.log(`   📊 Estrategia: ${content.videoBlueprint.strategy}`);
        console.log(`   🎬 Escenas: ${content.videoBlueprint.scenes.length}`);
        console.log(`   ⏱️ Duración: ${content.videoBlueprint.totalDuration}s`);
        
      } catch (err: any) {
        errors.push(`Error con producto ${product.id}: ${err.message}`);
        console.error(`❌ Error procesando ${product.name}: ${err.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`Ciclo fallido: ${err.message}`);
    console.error(`❌ Ciclo de marketing fallido: ${err.message}`);
  }
  
  // PASO 5: Poner todos los agentes en estado "idle"
  console.log('💤 Finalizando ciclo, agentes a idle...');
  for (const name of agentNames) {
    await updateAgentStatus(name, 'idle');
  }
  
  const logEntry: MarketingCycleLog = {
    timestamp: startTime,
    productsFound,
    productsFiltered,
    campaignsGenerated,
    published,
    errors,
  };
  
  await redis.lpush('empire:marketing:cycle-logs', JSON.stringify(logEntry));
  await redis.ltrim('empire:marketing:cycle-logs', 0, 49);
  await writeProof('marketing:cycle', { startTime, forcedProductName }, logEntry, 'marketing-automation', 'marketing-pro');
  await logOrchestratorAction(`marketing:cycle:done: prods=${productsFound}, filtered=${productsFiltered}, campaigns=${campaignsGenerated}, pub=${published}, errors=${errors.length}`);

  console.log(`\n📊 RESUMEN DEL CICLO:`);
  console.log(`   ✅ Productos encontrados: ${productsFound}`);
  console.log(`   🎯 Productos filtrados: ${productsFiltered}`);
  console.log(`   📹 Campañas generadas: ${campaignsGenerated}`);
  console.log(`   📢 Publicaciones: ${published}`);
  console.log(`   ⚠️ Errores: ${errors.length}`);
  if (errors.length > 0) {
    console.log(`   Detalle de errores:`, errors);
  }
  
  return logEntry;
}