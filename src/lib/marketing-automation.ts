// src/lib/marketing-automation.ts
// Versión definitiva y estable - SIN REMOTION
// Funcionalidades: Hotmart, Pexels, Cloudinary, Telegram, Groq
// El ciclo principal genera campañas y dispara worker en GitHub Actions para video

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
  const token = await getHotmartToken();
  let url = 'https://api.hotmart.com/products/api/v2/products?product_status=ACTIVE&max_results=10';
  if (query) url += `&name=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Hotmart API error: ${response.status}`);
  }
  const data = await response.json();
  const items = data.items || data.data || [];
  if (!items.length) {
    logOrchestratorAction('marketing:hotmart:no_products');
    return [];
  }
  const affiliateId = HOTMART_AFFILIATE_ID || 'sin_afiliado';
  return items.map((item: any) => {
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
// Helper: Video de Pexels (búsqueda de clips)
// ============================================================

async function searchPexelsVideo(query: string): Promise<string> {
  const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
  if (!PEXELS_API_KEY) return '';
  try {
    const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=1&orientation=portrait`, {
      headers: { Authorization: PEXELS_API_KEY },
    });
    if (!res.ok) throw new Error(`Pexels video error: ${res.status}`);
    const data = await res.json();
    const video = data.videos?.[0];
    if (!video) return '';
    const videoFile = video.video_files?.find((f: any) => f.quality === 'hd' || f.quality === 'sd');
    return videoFile?.link || video.video_files?.[0]?.link || '';
  } catch (error) {
    return '';
  }
}

// ============================================================
// Helper: Scraping de plataforma (Hotmart real)
// ============================================================

async function scrapePlatform(platform: string): Promise<AffiliateProduct[]> {
  logOrchestratorAction(`marketing:scraping:${platform}`);
  if (platform === 'hotmart') {
    try {
      const hotmartProducts = await searchHotmartProducts('marketing');
      if (hotmartProducts.length > 0) {
        return hotmartProducts;
      }
      // Si Hotmart no devuelve nada, usar productos de prueba
      logOrchestratorAction('marketing:hotmart:no_real_products, usando productos de prueba');
    } catch (error: any) {
      logOrchestratorAction(`marketing:hotmart_error:${error.message}, usando productos de prueba`);
    }
    // Productos de prueba (para que el flujo continúe)
    return [
      {
        id: 'test-1',
        name: 'Curso de Marketing Digital Avanzado',
        description: 'Aprende a vender en TikTok e Instagram',
        price: 47,
        commission: 50,
        platform: 'hotmart',
        affiliateUrl: 'https://hotmart.com/test',
        imageUrl: '',
        category: 'marketing',
        rating: 4.5,
      },
      {
        id: 'test-2',
        name: 'Pack de Plantillas para Embudos',
        description: 'Diseños profesionales para alta conversión',
        price: 27,
        commission: 60,
        platform: 'hotmart',
        affiliateUrl: 'https://hotmart.com/test2',
        imageUrl: '',
        category: 'marketing',
        rating: 4.8,
      },
    ];
  }
  return [];
}

// ============================================================
// Filtrar productos con IA
// ============================================================

async function filterProductsByAI(products: AffiliateProduct[]): Promise<AffiliateProduct[]> {
  if (products.length === 0) return [];
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
    // fallback
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
// NUEVA FUNCIÓN: Disparar workflow en GitHub Actions
// ============================================================
async function triggerGitHubWorkflow(jobData: any) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    console.error('❌ GITHUB_TOKEN no configurado en Vercel');
    await logOrchestratorAction('video:workflow:missing_token');
    return;
  }

  // Cambia estos valores si tu usuario o repositorio son diferentes
  const owner = 'jorgecastillog1';
  const repo = 'empire-crew';

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/build-video.yml/dispatches`;

  const payload = {
    ref: 'main',
    inputs: {
      jobData: JSON.stringify(jobData)
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
    }

    console.log('✅ Workflow disparado correctamente');
    await logOrchestratorAction('video:workflow:triggered');
  } catch (error: any) {
    console.error('❌ Error al disparar workflow:', error.message);
    await logOrchestratorAction(`video:workflow:error:${error.message.slice(0, 80)}`);
  }
}

// ============================================================
// CICLO PRINCIPAL (con disparo a GitHub Actions)
// ============================================================

export async function runMarketingCycle(): Promise<MarketingCycleLog> {
  const startTime = Date.now();
  const errors: string[] = [];
  let productsFound = 0, productsFiltered = 0, campaignsGenerated = 0, published = 0;
  await logOrchestratorAction('marketing:cycle:start');

  try {
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

    const bestProducts = await filterProductsByAI(allProducts);
    productsFiltered = bestProducts.length;

    // 🔥 Disparar worker de GitHub Actions (solo una vez por ciclo) con el primer producto
    if (bestProducts.length > 0) {
      const firstProduct = bestProducts[0];
      const videoJobData = {
        jobId: `video-${Date.now()}`,
        productName: firstProduct.name,
        productId: firstProduct.id,
        productDescription: firstProduct.description,
        imageUrl: firstProduct.imageUrl || '',
        affiliateUrl: firstProduct.affiliateUrl,
        timestamp: Date.now(),
      };
      await triggerGitHubWorkflow(videoJobData);
    }

    for (const product of bestProducts) {
      try {
        const content = await generateCampaignContent(product);
        const imageUrl = await searchPexelsImage(product.name);
        const videoUrl = '';  // El video se generará en GitHub Actions

        const leadMagnetUrl = await uploadToCloudinary(content.leadMagnetMarkdown, `leadmagnet_${product.id}_${Date.now()}`, 'text/markdown');
        const funnelHtml = generateFunnelHtml(product, {
          hook: content.hook,
          fullCopy: content.fullCopy,
          urgentCallToAction: content.urgentCallToAction,
          leadMagnetUrl,
          imageUrl,
        });
        const funnelUrl = await uploadToCloudinary(funnelHtml, `funnel_${product.id}_${Date.now()}`, 'text/html');

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
          videoUrl,
          publishedAt: Date.now(),
          success: true,
        };

        const pubCount = await publishCampaignToAllNetworks(campaign);
        published += pubCount;
        campaignsGenerated++;
        await redis.lpush('empire:marketing:campaigns', JSON.stringify(campaign));
        await redis.ltrim('empire:marketing:campaigns', 0, 99);
      } catch (err: any) {
        errors.push(`Error con producto ${product.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`Ciclo fallido: ${err.message}`);
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

  return logEntry;
}