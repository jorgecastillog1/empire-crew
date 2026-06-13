import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

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

const HOTMART_WATCHLIST_KEY = 'empire:marketing:hotmart-watchlist';

export async function GET() {
  try {
    const raw = await redis.get<string>(HOTMART_WATCHLIST_KEY);
    const products: AffiliateProduct[] = raw
      ? (typeof raw === 'string' ? JSON.parse(raw) : raw)
      : [];
    return NextResponse.json({ products });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description, price, commission, affiliateUrl, category } = body;

    if (!id || !name || !affiliateUrl) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: id, nombre, link de afiliado' },
        { status: 400 }
      );
    }

    const newProduct: AffiliateProduct = {
      id,
      name,
      description: description || '',
      price: Number(price) || 0,
      commission: Number(commission) || 0,
      platform: 'hotmart',
      affiliateUrl,
      imageUrl: '',
      category: category || '',
      rating: 5,
    };

    const raw = await redis.get<string>(HOTMART_WATCHLIST_KEY);
    const current: AffiliateProduct[] = raw
      ? (typeof raw === 'string' ? JSON.parse(raw) : raw)
      : [];

    const idx = current.findIndex(p => p.id === newProduct.id);
    if (idx >= 0) {
      current[idx] = newProduct;
    } else {
      current.push(newProduct);
    }

    await redis.set(HOTMART_WATCHLIST_KEY, JSON.stringify(current));

    return NextResponse.json({ success: true, products: current });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    const raw = await redis.get<string>(HOTMART_WATCHLIST_KEY);
    const current: AffiliateProduct[] = raw
      ? (typeof raw === 'string' ? JSON.parse(raw) : raw)
      : [];
    const filtered = current.filter(p => p.id !== id);
    await redis.set(HOTMART_WATCHLIST_KEY, JSON.stringify(filtered));
    return NextResponse.json({ success: true, products: filtered });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}