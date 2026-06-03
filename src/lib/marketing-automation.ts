// src/lib/marketing-automation.ts
// Módulo de automatización de marketing - Sin dependencias de PDF (usa Markdown)

import { redis } from './redis';
import { callLLM } from './orchestrator';
import { executeTool } from './thoth';
import { writeProof } from './omk';
import { logOrchestratorAction } from './orchestrator';
import fs from 'fs/promises';
import path from 'path';

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
  leadMagnetMarkdown: string;  // Contenido del lead magnet en formato Markdown
  imageUrl: string;
  funnelHtml: string;
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
// Helper: Obtener settings
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
// 4. Guardar lead magnet como archivo .md (en lugar de PDF)
// ============================================================

async function saveLeadMagnet(markdown: string, productId: string): Promise<string> {
  const filename = `leadmagnet-${productId}-${Date.now()}.md`;
  const dir = path.join(process.cwd(), 'public', 'leadmagnets');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, markdown, 'utf-8');
  return `/leadmagnets/${filename}`;
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
  const message = `${campaign.hook}\n\n${campaign.fullCopy}\n\n${campaign.urgentCallToAction}\n\n🔗 ${campaign.product.affiliateUrl}`;
  if (await publishToTelegram(message)) publishedCount++;
  // Aquí se pueden añadir Twitter, Facebook, etc. según settings
  return publishedCount;
}

// ============================================================
// 7. Guardar funnel HTML
// ============================================================

async function saveFunnelHtml(html: string, productId: string): Promise<string> {
  const filename = `funnel-${productId}-${Date.now()}.html`;
  const dir = path.join(process.cwd(), 'public', 'funnels');
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, html, 'utf-8');
  return `/funnels/${filename}`;
}

// ============================================================
// 8. Ciclo principal
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
        const content = await generateCampaignContent(product);
        const leadMagnetUrl = await saveLeadMagnet(content.leadMagnetMarkdown, product.id);
        const imageUrl = await searchPexelsImage(product.name);
        const funnelHtml = `<html><body><h1>${product.name}</h1><p>${content.fullCopy}</p><a href="${product.affiliateUrl}">Comprar ahora</a><p>Lead Magnet: <a href="${leadMagnetUrl}">Descargar guía</a></p></body></html>`;
        const funnelUrl = await saveFunnelHtml(funnelHtml, product.id);

        const campaign: CampaignData = {
          product,
          ...content,
          leadMagnetMarkdown: content.leadMagnetMarkdown,
          imageUrl,
          funnelHtml: funnelUrl,
          publishedAt: Date.now(),
          success: true,
        };

        const pubCount = await publishCampaignToAllNetworks(campaign);
        published += pubCount;
        campaignsGenerated++;

        // Guardar campaña en Redis
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