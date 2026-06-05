// src/lib/marketing-automation.ts
// Módulo de automatización de marketing con:
// - Integración real con API de Hotmart (búsqueda de productos)
// - Búsqueda de imágenes y videos en Pexels (gratuito)
// - Subida de lead magnets y funnels a Cloudinary

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
  videoUrl?: string;       // NUEVO: video promocional de Pexels
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
  videoUrl: string;        // NUEVO: URL del video
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
let hotmartAccessToken: string | null = null;
let tokenExpiresAt = 0;

// ============================================================
// Helper: Autenticación en Hotmart (obtener access token)
// ============================================================

async function getHotmartToken(): Promise<string> {
  // Si el token aún es válido (con margen de 5 minutos), reutilizarlo
  if (hotmartAccessToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return hotmartAccessToken;
  }

  if (!HOTMART_CLIENT_ID || !HOTMART_CLIENT_SECRET) {
    throw new Error('Hotmart no configurado: faltan HOTMART_CLIENT_ID o HOTMART_CLIENT_SECRET');
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
    const errorText = await response.text();
    throw new Error(`Hotmart auth error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  hotmartAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);
  
  // Aseguramos que el token no sea null/undefined
  if (!hotmartAccessToken) {
    throw new Error('Hotmart no devolvió access_token');
  }
  
  return hotmartAccessToken;
}

// ============================================================
// Helper: Buscar productos reales en Hotmart
// ============================================================

async function searchHotmartProducts(query: string = ''): Promise<AffiliateProduct[]> {
  const token = await getHotmartToken();
  // Usar el endpoint de productos de Hotmart (documentación: GET /products/api/v2/products)
  let url = 'https://api.hotmart.com/products/api/v2/products?product_status=ACTIVE&max_results=10';
  if (query) {
    url += `&name=${encodeURIComponent(query)}`;
  }

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Hotmart API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  // Mapear respuesta de Hotmart a nuestro formato AffiliateProduct
  // La estructura exacta depende de la respuesta; aquí asumo campos comunes
  const items = data.items || data.data || [];
  return items.map((item: any) => ({
    id: item.id?.toString() || `hotmart-${Date.now()}`,
    name: item.name || 'Sin nombre',
    description: item.shortDescription || item.description || 'Sin descripción',
    price: item.price?.amount || 0,
    commission: item.commission?.percent || 0,
    platform: 'hotmart',
    affiliateUrl: `https://hotmart.com/product/${item.id}?affiliate_id=TU_ID`, // Reemplazar con tu affiliate ID
    category: item.category?.name || '',
    rating: item.rating || 0,
  }));
}

// ============================================================
// Helper: Subir contenido a Cloudinary (Blob)
// ============================================================

async function uploadToCloudinary(content: string, publicId: string, contentType: 'text/markdown' | 'text/html'): Promise<string> {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    throw new Error('Cloudinary no configurado. Faltan variables de entorno.');
  }

  const extension = contentType === 'text/markdown' ? 'md' : 'html';
  const mimeType = contentType === 'text/markdown' ? 'text/plain' : 'text/html';
  const blob = new Blob([content], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, `${publicId}.${extension}`);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('public_id', `marketing/${publicId}`);

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`;
  const response = await fetch(url, { method: 'POST', body: formData });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.secure_url;
}

// ============================================================
// Helper: Obtener imagen de Pexels
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
// NUEVO: Buscar video en Pexels
// ============================================================

async function searchPexelsVideo(query: string): Promise<string> {
  const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
  if (!PEXELS_API_KEY) return '';
  const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=1`, {
    headers: { Authorization: PEXELS_API_KEY },
  });
  const data = await res.json();
  const video = data.videos?.[0];
  if (!video) return '';
  // Elegir la versión de menor resolución para evitar archivos pesados
  const videoFile = video.video_files?.find((f: any) => f.quality === 'hd' || f.quality === 'sd');
  return videoFile?.link || video.video_files?.[0]?.link || '';
}

// ============================================================
// 1. Scraping de productos (con Hotmart real + fallback a stub)
// ============================================================

async function scrapePlatform(platform: string): Promise<AffiliateProduct[]> {
  logOrchestratorAction(`marketing:scraping:${platform}`);
  if (platform === 'hotmart') {
    try {
      // Buscar productos con query "marketing" o "trading" (puedes parametrizar)
      return await searchHotmartProducts('marketing');
    } catch (error: any) {
      logOrchestratorAction(`marketing:hotmart_error:${error.message}`);
      // Fallback a datos de ejemplo si la API falla
      return [
        {
          id: 'hm-fallback',
          name: 'Embudo de Ventas Avanzado (demo)',
          description: 'Construye funnels que convierten al 5%',
          price: 97,
          commission: 50,
          platform: 'hotmart',
          affiliateUrl: 'https://hotmart.com/producto-ejemplo',
          category: 'funnels',
          rating: 4.9,
        },
      ];
    }
  } else if (platform === 'clickbank') {
    // Por ahora, stub para ClickBank
    return [
      {
        id: 'cb-1',
        name: 'Curso de Trading Algorítmico',
        description: 'Aprende a programar bots de trading en Python',
        price: 197,
        commission: 75,
        platform: 'clickbank',
        affiliateUrl: 'https://clickbank.com/producto-ejemplo',
        category: 'trading',
        rating: 4.8,
      },
    ];
  }
  return [];
}

// ============================================================
// 2. Filtrar productos con IA
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
    return products.slice(0, 3);
  }
}

// ============================================================
// 3. Generar campaña (copy + lead magnet)
// ============================================================

async function generateCampaignContent(product: AffiliateProduct): Promise<{
  hook: string;
  uniqueValueProp: string;
  socialProof: string;
  urgentCallToAction: string;
  fullCopy: string;
  leadMagnetMarkdown: string;
}> {
  const systemPrompt = `Eres Agent-Neuro-Copywriter. Genera una campaña en JSON con: hook, uniqueValueProp, socialProof, urgentCallToAction, fullCopy, leadMagnetMarkdown (texto en Markdown de 1-2 páginas explicando el problema y la solución).`;
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
      hook: `🔥 ¡Descubre ${product.name}!`,
      uniqueValueProp: `La mejor solución para ${product.name}`,
      socialProof: `Más de 1000 clientes satisfechos`,
      urgentCallToAction: `Compra ahora - oferta limitada`,
      fullCopy: `No te pierdas esta oportunidad...`,
      leadMagnetMarkdown: `# Guía gratuita: Cómo resolver [problema]\n\nContenido valioso...`,
    };
  }
}

// ============================================================
// 4. Generar funnel HTML
// ============================================================

function generateFunnelHtml(product: AffiliateProduct, content: {
  hook: string;
  fullCopy: string;
  urgentCallToAction: string;
  leadMagnetUrl: string;
  videoUrl: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${product.name}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background: #f4f4f4; }
    .container { max-width: 800px; margin: auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    h1 { color: #333; }
    .hook { font-size: 1.5em; font-weight: bold; color: #e67e22; }
    video { width: 100%; border-radius: 8px; margin: 20px 0; }
    .cta { background: #e67e22; color: white; padding: 12px 24px; text-decoration: none; display: inline-block; border-radius: 5px; margin-top: 20px; }
    .lead-magnet { background: #f9f9f9; padding: 15px; margin: 20px 0; border-left: 4px solid #e67e22; }
  </style>
</head>
<body>
<div class="container">
  <div class="hook">${content.hook}</div>
  <h1>${product.name}</h1>
  ${content.videoUrl ? `<video src="${content.videoUrl}" controls poster="${product.imageUrl || ''}"></video>` : ''}
  <p>${content.fullCopy}</p>
  <div class="lead-magnet">
    <strong>📘 Bono exclusivo:</strong> Descarga nuestra guía gratuita <a href="${content.leadMagnetUrl}" target="_blank">aquí</a>.
  </div>
  <a href="${product.affiliateUrl}" class="cta" target="_blank">${content.urgentCallToAction}</a>
</div>
</body>
</html>`;
}

// ============================================================
// 5. Publicación en Telegram (incluyendo video)
// ============================================================

async function publishToTelegram(message: string, videoUrl?: string): Promise<boolean> {
  try {
    // Si hay video, intentar enviar como video (se requiere subir el archivo o enviar URL)
    // Por simplicidad, enviamos el enlace en el mensaje
    await executeTool('telegram_notify', { message: `📢 Nueva campaña automática:\n\n${message}\n\n🎥 Video: ${videoUrl || 'No disponible'}` });
    return true;
  } catch {
    return false;
  }
}

async function publishCampaignToAllNetworks(campaign: CampaignData): Promise<number> {
  let publishedCount = 0;
  const message = `${campaign.hook}\n\n${campaign.fullCopy}\n\n${campaign.urgentCallToAction}\n\n🔗 ${campaign.product.affiliateUrl}\n\n📘 Lead Magnet: ${campaign.leadMagnetUrl}\n📄 Funnel: ${campaign.funnelUrl}`;
  if (await publishToTelegram(message, campaign.videoUrl)) publishedCount++;
  return publishedCount;
}

// ============================================================
// 6. Ciclo principal
// ============================================================

export async function runMarketingCycle(): Promise<MarketingCycleLog> {
  const startTime = Date.now();
  const errors: string[] = [];
  let productsFound = 0;
  let productsFiltered = 0;
  let campaignsGenerated = 0;
  let published = 0;

  await logOrchestratorAction('marketing:cycle:start');

  try {
    // Priorizar Hotmart real, luego ClickBank (stub)
    const platforms = ['hotmart', 'clickbank'];
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

    for (const product of bestProducts) {
      try {
        // 1. Generar contenido con IA
        const content = await generateCampaignContent(product);

        // 2. Buscar imagen y video en Pexels (gratis)
        const imageUrl = await searchPexelsImage(product.name);
        const videoUrl = await searchPexelsVideo(product.name);

        // 3. Subir lead magnet a Cloudinary
        const leadMagnetUrl = await uploadToCloudinary(
          content.leadMagnetMarkdown,
          `leadmagnet_${product.id}_${Date.now()}`,
          'text/markdown'
        );

        // 4. Generar funnel HTML (incluye video) y subirlo
        const funnelHtml = generateFunnelHtml(product, {
          hook: content.hook,
          fullCopy: content.fullCopy,
          urgentCallToAction: content.urgentCallToAction,
          leadMagnetUrl,
          videoUrl,
        });
        const funnelUrl = await uploadToCloudinary(
          funnelHtml,
          `funnel_${product.id}_${Date.now()}`,
          'text/html'
        );

        // 5. Construir campaña
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

        // 6. Publicar
        const pubCount = await publishCampaignToAllNetworks(campaign);
        published += pubCount;
        campaignsGenerated++;

        // 7. Guardar en Redis
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
  await logOrchestratorAction(`marketing:cycle:done: products=${productsFound}, campaigns=${campaignsGenerated}, published=${published}, errors=${errors.length}`);
  return logEntry;
}