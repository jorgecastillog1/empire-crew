import { NextRequest, NextResponse } from 'next/server';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const CRON_SECRET = process.env.CRON_SECRET || 'empire-cron-secret-2025';
const BASE_URL = process.env.NEXTAUTH_URL || 'https://empire-crew.vercel.app';

async function sendTelegramMessage(text: string) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
    }),
  });
}

async function runCycle(forcedProductName?: string) {
  if (forcedProductName) {
    await sendTelegramMessage(`⏳ Iniciando ciclo de marketing para *${forcedProductName}*...`);
  } else {
    await sendTelegramMessage('⏳ Iniciando ciclo de marketing...');
  }
  try {
    const res = await fetch(`${BASE_URL}/api/marketing/cycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: CRON_SECRET, forcedProductName }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      const log = data.cycleLog;
      if (forcedProductName && log?.productsFiltered === 0) {
        await sendTelegramMessage(`⚠️ No se encontró ningún producto que coincida con "${forcedProductName}" en la watchlist.`);
      } else {
        await sendTelegramMessage(`✅ Ciclo completado.\nProductos encontrados: ${log?.productsFound ?? '?'}\nFiltrados: ${log?.productsFiltered ?? '?'}\nCampañas generadas: ${log?.campaignsGenerated ?? '?'}`);
      }
    } else {
      await sendTelegramMessage(`❌ Error en el ciclo: ${data?.error || res.status}`);
    }
  } catch (e: any) {
    await sendTelegramMessage(`❌ Error al ejecutar el ciclo: ${e.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const update = await request.json();
    const message = update.message;
    if (!message || !message.text) {
      return NextResponse.json({ ok: true });
    }

    // Seguridad: solo responder a tu chat
    if (String(message.chat?.id) !== String(TELEGRAM_CHAT_ID)) {
      return NextResponse.json({ ok: true });
    }

    const text: string = message.text.trim();

    // ── /forzar_ciclo  o  /forzar_ciclo_<nombre> ───────────────
    if (text === '/forzar_ciclo') {
      await runCycle();
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/forzar_ciclo_')) {
      const productName = text.replace('/forzar_ciclo_', '').replace(/_/g, ' ').trim();
      if (!productName) {
        await sendTelegramMessage('⚠️ Escribe el nombre del producto después de /forzar_ciclo_, ej: /forzar_ciclo_despierta');
        return NextResponse.json({ ok: true });
      }
      await runCycle(productName);
      return NextResponse.json({ ok: true });
    }

    // ── /productos_hotmart ─────────────────────────────────────
    // Formato: /productos_hotmart ID | Nombre | Link | Precio | Comisión | Categoría | Descripción
    if (text.startsWith('/productos_hotmart')) {
      const body = text.replace('/productos_hotmart', '').trim();
      const parts = body.split('|').map(p => p.trim());

      if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
        await sendTelegramMessage(
          '⚠️ Formato:\n`/productos_hotmart ID | Nombre | Link | Precio | Comisión | Categoría | Descripción`\n\n' +
          'Solo ID, Nombre y Link son obligatorios.\n\n' +
          'Ejemplo:\n`/productos_hotmart Q106300997Y | DESPIERTA | https://go.hotmart.com/Q106300997Y?affiliate_id=1981002753 | 19.99 | 50 | crecimiento personal | Libro de desarrollo personal`'
        );
        return NextResponse.json({ ok: true });
      }

      const [id, name, affiliateUrl, price, commission, category, description] = parts;

      try {
        const res = await fetch(`${BASE_URL}/api/admin/productos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            name,
            affiliateUrl,
            price: price || '0',
            commission: commission || '0',
            category: category || '',
            description: description || '',
          }),
        });
        const data = await res.json();
        if (res.ok) {
          const saved = data.products?.find((p: any) => p.id === id);
          let msg = `✅ Producto guardado: *${name}*\nTotal en lista: ${data.products?.length ?? '?'}`;
          if (saved?.imageUrl) msg += `\n🖼️ Imagen detectada automáticamente.`;
          await sendTelegramMessage(msg);
        } else {
          await sendTelegramMessage(`❌ Error: ${data?.error || res.status}`);
        }
      } catch (e: any) {
        await sendTelegramMessage(`❌ Error al guardar: ${e.message}`);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: true });
  }
}