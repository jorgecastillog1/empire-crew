import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { groq, tavily, ads, affiliates, services, socialAccounts, kaggle, huggingface, telegram, cloudinary, ngrok } = body;

    if (groq?.length) {
      await redis.del('empire:groq:accounts');
      for (const account of groq) {
        await redis.rpush('empire:groq:accounts', JSON.stringify(account));
      }
    }

    if (tavily?.length) {
      await redis.del('empire:tavily:accounts');
      for (const account of tavily) {
        await redis.rpush('empire:tavily:accounts', JSON.stringify(account));
      }
    }

    if (ads?.length) await redis.set('empire:settings:ads', JSON.stringify(ads));
    if (affiliates?.length) await redis.set('empire:settings:affiliates', JSON.stringify(affiliates));
    if (services?.length) await redis.set('empire:settings:services', JSON.stringify(services));
    if (socialAccounts?.length) await redis.set('empire:settings:social', JSON.stringify(socialAccounts));
    if (kaggle?.length) await redis.set('empire:settings:kaggle', JSON.stringify(kaggle));
    if (huggingface?.length) await redis.set('empire:settings:huggingface', JSON.stringify(huggingface));
    if (telegram?.token) await redis.set('empire:settings:telegram', JSON.stringify(telegram));
    if (cloudinary?.cloudName) await redis.set('empire:settings:cloudinary', JSON.stringify(cloudinary));
    if (ngrok?.url) await redis.set('empire:settings:ngrok', JSON.stringify(ngrok));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const [groq, tavily, ads, affiliates, services, social, kaggle, huggingface, telegram, cloudinary, ngrok] = await Promise.all([
      redis.lrange('empire:groq:accounts', 0, -1),
      redis.lrange('empire:tavily:accounts', 0, -1),
      redis.get('empire:settings:ads'),
      redis.get('empire:settings:affiliates'),
      redis.get('empire:settings:services'),
      redis.get('empire:settings:social'),
      redis.get('empire:settings:kaggle'),
      redis.get('empire:settings:huggingface'),
      redis.get('empire:settings:telegram'),
      redis.get('empire:settings:cloudinary'),
      redis.get('empire:settings:ngrok'),
    ]);

    const parse = (val: any) => {
      if (!val) return [];
      try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return []; }
    };

    const parseObj = (val: any) => {
      if (!val) return null;
      try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return null; }
    };

    return NextResponse.json({
      groq: groq.map(a => typeof a === 'string' ? JSON.parse(a) : a),
      tavily: tavily.map(a => typeof a === 'string' ? JSON.parse(a) : a),
      ads: parse(ads),
      affiliates: parse(affiliates),
      services: parse(services),
      socialAccounts: parse(social),
      kaggle: parse(kaggle),
      huggingface: parse(huggingface),
      telegram: parseObj(telegram),
      cloudinary: parseObj(cloudinary),
      ngrok: parseObj(ngrok),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}