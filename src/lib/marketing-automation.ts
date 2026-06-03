// src/lib/marketing-automation.ts
// Módulo de automatización de marketing con subida a Cloudinary (usando Blob)

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
  leadMagnetUrl: string;      // URL en Cloudinary del lead magnet (Markdown)
  funnelUrl: string;           // URL en Cloudinary del funnel HTML
  imageUrl: string;
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
// Configuración de Cloudinary (desde variables de entorno)
// ============================================================

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const API_KEY = process.env.CLOUDINARY_API_KEY || '';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const UPLOAD_PRESET = 'empire_marketing_leadmagnets';

// ============================================================
// Helper: Subir contenido a Cloudinary usando Blob
// ============================================================

async function uploadToCloudinary(content: string, publicId: string, contentType: 'text/markdown' | 'text/html'): Promise<string> {
  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    throw new Error('Cloudinary no configurado. Faltan variables de entorno.');
  }

  // Determinar la extensión y el MIME type correcto
  const extension = contentType === 'text/markdown' ? 'md' : 'html';
  const mimeType = contentType === 'text/markdown' ? 'text/plain' : 'text/html';
  
  // Crear un Blob a partir del contenido
  const blob = new Blob([content], { type: mimeType });
  
  // Crear FormData y adjuntar el blob como un archivo
  const formData = new FormData();
  formData.append('file', blob, `${publicId}.${extension}`);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('public_id', `marketing/${publicId}`);

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/raw/upload`;

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.secure_url;
}

// ============================================================
// Helper: Obtener settings (para plataformas de afiliados)
// ============================================================

async function getSettings() {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/settings`);
  if (!res.ok) throw new Error('No se pudo obtener settings');
  return res.json();
}

// ============================================================
// 1. Scraping de productos (stub - reemplazar con scraping real)
// ============================================================

async function scrapePlatform(platform: string): Promise<AffiliateProduct[]> {
  logOrchestratorAction(`marketing:scraping:${platform}`);
  // Datos de ejemplo. En producción, usar scrapeUrl de browser.ts
  if (platform === 'clickbank') {
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
  if (platform === 'hotmart') {
    return [
      {
        id: 'hm-1',
        name: 'Embudo de Ventas Avanzado',
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
// 3. Generar campaña (copy + lead magnet en Markdown)
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
    // fallback
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
// 4. Generar funnel HTML a partir del copy
// ============================================================

function generateFunnelHtml(product: AffiliateProduct, content: {
  hook: string;
  fullCopy: string;
  urgentCallToAction: string;
  leadMagnetUrl: string;
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
    .cta { background: #e67e22; color: white; padding: 12px 24px; text-decoration: none; display: inline-block; border-radius: 5px; margin-top: 20px; }
    .lead-magnet { background: #f9f9f9; padding: 15px; margin: 20px 0; border-left: 4px solid #e67e22; }
  </style>
</head>
<body>
<div class="container">
  <div class="hook">${content.hook}</div>
  <h1>${product.name}</h1>
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
// 5. Buscar imagen en Pexels
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
// 6. Publicación en Telegram (y stub para otras redes)
// ============================================================

async function publishToTelegram(message: string): Promise<boolean> {
  try {
    await executeTool('telegram_notify', { message: `📢 Nueva campaña automática:\n\n${message}` });
    return true;
  } catch {
    return false;
  }
}

async function publishCampaignToAllNetworks(campaign: CampaignData): Promise<number> {
  let publishedCount = 0;
  const message = `${campaign.hook}\n\n${campaign.fullCopy}\n\n${campaign.urgentCallToAction}\n\n🔗 ${campaign.product.affiliateUrl}\n\n📘 Lead Magnet: ${campaign.leadMagnetUrl}\n📄 Funnel: ${campaign.funnelUrl}`;
  if (await publishToTelegram(message)) publishedCount++;
  // Aquí se pueden añadir Twitter, Facebook, etc. según settings
  return publishedCount;
}

// ============================================================
// 7. Ciclo principal
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
    // Lista de plataformas (debería venir de settings)
    const platforms = ['clickbank', 'hotmart'];
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

        // 2. Subir lead magnet a Cloudinary (Markdown)
        const leadMagnetUrl = await uploadToCloudinary(
          content.leadMagnetMarkdown,
          `leadmagnet_${product.id}_${Date.now()}`,
          'text/markdown'
        );

        // 3. Generar funnel HTML y subirlo a Cloudinary
        const funnelHtml = generateFunnelHtml(product, {
          hook: content.hook,
          fullCopy: content.fullCopy,
          urgentCallToAction: content.urgentCallToAction,
          leadMagnetUrl,
        });
        const funnelUrl = await uploadToCloudinary(
          funnelHtml,
          `funnel_${product.id}_${Date.now()}`,
          'text/html'
        );

        // 4. Buscar imagen en Pexels
        const imageUrl = await searchPexelsImage(product.name);

        // 5. Construir objeto campaña
        const campaign: CampaignData = {
          product,
          hook: content.hook,
          uniqueValueProp: content.uniqueValueProp,
          socialProof: content.socialProof,
          urgentCallToAction: content.urgentCallToAction,
          fullCopy: content.fullCopy,
          leadMagnetUrl,
          funnelUrl,
          imageUrl,
          publishedAt: Date.now(),
          success: true,
        };

        // 6. Publicar en redes
        const pubCount = await publishCampaignToAllNetworks(campaign);
        published += pubCount;
        campaignsGenerated++;

        // 7. Guardar campaña en Redis
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