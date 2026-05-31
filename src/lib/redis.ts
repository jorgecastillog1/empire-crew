import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? '';
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

export const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

export const KEY = {
  companies: 'empire:companies',
  company: (id: string) => `empire:company:${id}`,
  companyAgents: (id: string) => `empire:company:${id}:agents`,
  companyMetrics: (id: string) => `empire:company:${id}:metrics`,
  agent: (id: string) => `empire:agent:${id}`,
  groqAccounts: 'empire:groq:accounts',
  tavilyAccounts: 'empire:tavily:accounts',
  rateLimitGroq: (account: string) => `empire:ratelimit:groq:${account}`,
};

export async function getAvailableGroqKey(): Promise<string> {
  // Primero intenta desde Redis
  try {
    const accounts = await redis.lrange(KEY.groqAccounts, 0, -1);
    if (accounts && accounts.length > 0) {
      for (const account of accounts) {
        const parsed = typeof account === 'string' ? JSON.parse(account) : account;
        const limited = await redis.get(KEY.rateLimitGroq(parsed.id));
        if (!limited) return parsed.apiKey;
      }
    }
  } catch {}

  // Fallback a .env.local
  const envKey = process.env.GROQ_API_KEY;
  if (envKey) return envKey;

  throw new Error('No hay cuentas Groq disponibles');
}

export async function getAvailableTavilyKey(): Promise<string> {
  try {
    const accounts = await redis.lrange('empire:tavily:accounts', 0, -1);
    if (accounts && accounts.length > 0) {
      for (const account of accounts) {
        const parsed = typeof account === 'string' ? JSON.parse(account) : account;
        const limited = await redis.get(`empire:ratelimit:tavily:${parsed.id}`);
        if (!limited) return parsed.apiKey;
      }
    }
  } catch {}

  const envKey = process.env.TAVILY_API_KEY;
  if (envKey) return envKey;

  throw new Error('No hay cuentas Tavily disponibles');
}