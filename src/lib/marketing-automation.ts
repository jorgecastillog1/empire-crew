// src/lib/marketing-automation.ts
// Versión definitiva y estable - CON INTEGRACIÓN CON KAGGLE PARA VIDEOS
// MODIFICADO: Actualiza el estado de los agentes en tiempo real (analyzing/executing/idle)
// Los nombres de agentes coinciden con los guardados en Redis (español)

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
// Configuración de Cloudinary
// ============================================================

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const API_KEY = process.env.CLOUDINARY_API_KEY || '';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const UPLOAD_PRESET = 'empire_marketing_leadmagnets';

// ============================================================
// Configuración de Hotmart
// ============================================================

const HOTMART_CLIENT_ID = process.env.HOTMART_CLIENT_ID || '';
const HOTMART_CLIENT_SECRET = process.env.HOTMART_CLIENT_SECRET || '';
const HOTMART_AFFILIATE_ID = process.env.HOTMART_AFFILIATE_ID || '';
let hotmartAccessToken: string | null = null;
let tokenExpiresAt = 0;

// ============================================================
// Configuración de Kaggle
// ============================================================

const KAGGLE_VIDEO_API_URL = process.env.KAGGLE_VIDEO_API_URL || '';

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
// Helper: Subir lead magnet o funnel a Cloudinary (raw)
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
// Helper: Scraping de plataforma (Hotmart real SIN fallback)
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

  // Si se pidió un producto específico, lo buscamos directamente sin pasar por la IA
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
// Generar contenido de campaña
// ============================================================

async function generateCampaignContent(product: AffiliateProduct): Promise<{
  hook: string;
  uniqueValueProp: string;
  socialProof: string;
  urgentCallToAction: string;
  fullCopy: string;
  videoScript: string;
  leadMagnetMarkdown: string;
}> {
  const systemPrompt = `Eres un creador de contenido para TikTok/Reels. Genera una campaña en JSON para vender un producto. Formato:
{
  "hook": "Frase gancho (máx 8 palabras)",
  "uniqueValueProp": "qué lo hace único (15 palabras)",
  "socialProof": "testimonio o dato (10 palabras)",
  "urgentCallToAction": "acción urgente (máx 6 palabras)",
  "fullCopy": "texto para post de red social (60-80 palabras, estilo conversacional con emojis)",
  "videoScript": "guión para video de 30 segundos, dividido en escenas.",
  "leadMagnetMarkdown": "contenido del lead magnet en Markdown (1 página)"
}`;
  const userMessage = `Producto: ${product.name}\nDescripción: ${product.description}\nPrecio: $${product.price}\nComisión: ${product.commission}%`;
  const result = await callLLM({
    systemPrompt,
    userMessage,
    agentId: 'marketing-copywriter',
    maxTokens: 2000,
  });
  try {
    const clean = result.response.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      hook: `🔥 ¡ATENCIÓN!`,
      uniqueValueProp: `La herramienta que todo afiliado necesita`,
      socialProof: `Más de 1000 ventas confirmadas`,
      urgentCallToAction: `COMPRA ANTES DE 48H`,
      fullCopy: `¿Listo para multiplicar tus ventas? Este producto es la clave. 🔥 Oferta limitada.`,
      videoScript: `[ESCENA 1] ¿Estás perdiendo ventas? [ESCENA 2] Este producto te ayudará...`,
      leadMagnetMarkdown: `# Guía gratuita\n\nContenido descargable...`,
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
// FUNCIÓN: Enviar prompts a Kaggle para generar video
// ============================================================

async function triggerKaggleVideoGeneration(
  product: AffiliateProduct, 
  content: any,
  jobId?: string
): Promise<{ jobId: string; status: string; message?: string }> {
  
  if (!KAGGLE_VIDEO_API_URL) {
    console.error('❌ KAGGLE_VIDEO_API_URL no configurada en .env.local');
    logOrchestratorAction('marketing:video:error:no_kaggle_url');
    return { jobId: 'error', status: 'no_kaggle_url', message: 'KAGGLE_VIDEO_API_URL no configurada' };
  }
  
  const finalJobId = jobId || `hotmart_${product.id}_${Date.now()}`;
  const callbackUrl = `${process.env.NEXTAUTH_URL || 'https://empire-crew.vercel.app'}/api/marketing/video-callback`;
  
  const scenes = [
    {
      prompt: `${content.hook} ${content.uniqueValueProp} Iluminación cálida, cámara lenta.`.slice(0, 250),
      duration_sec: 5
    },
    {
      prompt: `${content.fullCopy} Movimiento suave de cámara, expresión confiada.`.slice(0, 250),
      duration_sec: 8
    },
    {
      prompt: `${content.socialProof} ${content.urgentCallToAction} Cámara hace zoom, tono urgente.`.slice(0, 250),
      duration_sec: 4
    }
  ];
  
  console.log(`📹 Enviando job ${finalJobId} a Kaggle...`);
  logOrchestratorAction(`marketing:video:enviando:${finalJobId}`);
  
  try {
    const response = await fetch(`${KAGGLE_VIDEO_API_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: finalJobId,
        scenes: scenes,
        callback_url: callbackUrl
      })
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
      scenes: scenes.length
    }));
    
    return { 
      jobId: finalJobId, 
      status: data.status || 'queued',
      message: `Video encolado en Kaggle`
    };
    
  } catch (error: any) {
    console.error(`❌ Error enviando a Kaggle: ${error.message}`);
    logOrchestratorAction(`marketing:video:error:${error.message}`);
    return { jobId: finalJobId, status: 'error', message: error.message };
  }
}

// ============================================================
// FUNCIÓN AUXILIAR: Actualizar estado de un agente específico
// ============================================================

async function updateAgentStatus(agentName: string, status: 'idle' | 'analyzing' | 'executing' | 'deliberating' | 'vetoed'): Promise<void> {
  try {
    const { loadAgentState, saveAgentState } = await import('./orchestrator');
    // El ID del agente en Redis es el nombre exacto (ej: "Agent-Ad-Creative")
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
// CICLO PRINCIPAL (con actualización de estado de agentes)
// ============================================================

export async function runMarketingCycle(forcedProductName?: string): Promise<MarketingCycleLog> {
  const startTime = Date.now();
  const errors: string[] = [];
  let productsFound = 0, productsFiltered = 0, campaignsGenerated = 0, published = 0;
  
  await logOrchestratorAction('marketing:cycle:start');
  
  // ============================================================
  // PASO 1: Poner todos los agentes en estado "analyzing"
  // ============================================================
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
  
  console.log('🟡 Iniciando ciclo de marketing...');
  for (const name of agentNames) {
    await updateAgentStatus(name, 'analyzing');
  }
  
  try {
    // ============================================================
    // PASO 2: Agent-Affiliate-Scout busca productos
    // ============================================================
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
    
    // ============================================================
    // PASO 3: Agent-SEO-Dominator filtra productos
    // ============================================================
    await updateAgentStatus('Agent-SEO-Dominator', 'executing');
    console.log('🎯 Filtrando mejores productos...');
    
    const bestProducts = await filterProductsByAI(allProducts, forcedProductName);
    if (forcedProductName && bestProducts.length === 0) {
      errors.push(`No se encontró el producto "${forcedProductName}" en la watchlist`);
    }
    productsFiltered = bestProducts.length;
    console.log(`📌 Productos filtrados: ${productsFiltered}`);
    
    await updateAgentStatus('Agent-SEO-Dominator', 'analyzing');
    
    // ============================================================
    // PASO 4: Procesar cada producto (varios agentes trabajan)
    // ============================================================
    for (const product of bestProducts) {
      try {
        console.log(`\n📹 Procesando producto: ${product.name}`);
        
        // 4.1 Agent-Neuro-Copywriter genera contenido
        await updateAgentStatus('Agent-Neuro-Copywriter', 'executing');
        console.log('✍️ Generando copy...');
        const content = await generateCampaignContent(product);
        await updateAgentStatus('Agent-Neuro-Copywriter', 'analyzing');
        
        // 4.2 Agent-Ad-Creative busca imagen
        await updateAgentStatus('Agent-Ad-Creative', 'executing');
        console.log('🖼️ Buscando imagen...');
        const imageUrl = await searchPexelsImage(product.name);
        await updateAgentStatus('Agent-Ad-Creative', 'analyzing');
        
        // 4.3 Agent-Video-Producer envía a Kaggle
        let videoUrl = '';
        let videoJobId = '';
        
        if (KAGGLE_VIDEO_API_URL) {
          await updateAgentStatus('Agent-Video-Producer', 'executing');
          console.log('🎬 Enviando a Kaggle...');
          const videoResult = await triggerKaggleVideoGeneration(product, content);
          videoJobId = videoResult.jobId;
          videoUrl = '';
          console.log(`📹 Video job ${videoJobId} encolado, esperando callback...`);
          await updateAgentStatus('Agent-Video-Producer', 'analyzing');
        } else {
          logOrchestratorAction('marketing:video:skip:no_kaggle_url');
        }
        
        // 4.4 Agent-Funnel-Architect construye funnel
        await updateAgentStatus('Agent-Funnel-Architect', 'executing');
        console.log('🏗️ Construyendo funnel...');
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
        console.log('📢 Publicando campaña...');
        
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
        
      } catch (err: any) {
        errors.push(`Error con producto ${product.id}: ${err.message}`);
        console.error(`❌ Error: ${err.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`Ciclo fallido: ${err.message}`);
    console.error(`❌ Ciclo fallido: ${err.message}`);
  }
  
  // ============================================================
  // PASO 5: Poner todos los agentes en estado "idle"
  // ============================================================
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
  await writeProof('marketing:cycle', { startTime }, logEntry, 'marketing-automation', 'marketing-pro');
  await logOrchestratorAction(`marketing:cycle:done: prods=${productsFound}, campaigns=${campaignsGenerated}, pub=${published}, errors=${errors.length}`);

  console.log(`\n📊 RESUMEN: Productos: ${productsFound}, Filtrados: ${productsFiltered}, Campañas: ${campaignsGenerated}, Publicaciones: ${published}, Errores: ${errors.length}`);
  
  return logEntry;
}