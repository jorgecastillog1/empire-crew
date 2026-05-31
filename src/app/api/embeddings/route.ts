import { NextRequest, NextResponse } from 'next/server';
import {
  generateEmbedding,
  storeEmbedding,
  searchSimilar,
  storeAgentMemory,
  searchAgentMemory,
  storeMarketKnowledge,
  searchMarketKnowledge,
  deleteEmbedding,
  listEmbeddings,
} from '@/lib/embeddings';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, text, key, metadata, query, topK, agentId, event, outcome, topic, content, companyType } = body;

    switch (action) {
      case 'generate':
        return NextResponse.json({ embedding: await generateEmbedding(text) });

      case 'store':
        await storeEmbedding(key, text, metadata || {});
        return NextResponse.json({ success: true, key });

      case 'search':
        return NextResponse.json(await searchSimilar(query, topK || 5));

      case 'store_agent_memory':
        await storeAgentMemory(agentId, event, outcome);
        return NextResponse.json({ success: true });

      case 'search_agent_memory':
        return NextResponse.json(await searchAgentMemory(agentId, query, topK || 3));

      case 'store_market_knowledge':
        await storeMarketKnowledge(topic, content, companyType);
        return NextResponse.json({ success: true });

      case 'search_market_knowledge':
        return NextResponse.json(await searchMarketKnowledge(query, companyType, topK || 5));

      case 'delete':
        await deleteEmbedding(key);
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json({ error: 'Accion no reconocida' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const keys = await listEmbeddings();
    return NextResponse.json({ keys, total: keys.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
