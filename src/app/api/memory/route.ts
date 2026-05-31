import { NextRequest, NextResponse } from 'next/server';
import {
  storeMemory,
  recallMemory,
  searchMemories,
  consolidateMemories,
  getWorkingMemory,
  setWorkingMemory,
  clearWorkingMemory,
  getMemoryStats,
} from '@/lib/memory';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, agentId, content, type, importance, metadata, memoryId, query, topK } = body;

    switch (action) {
      case 'store':
        return NextResponse.json({
          id: await storeMemory(agentId, content, type || 'episodic', importance || 0.5, metadata || {})
        });

      case 'recall':
        return NextResponse.json(await recallMemory(memoryId));

      case 'search':
        return NextResponse.json(await searchMemories(agentId, query, topK || 5));

      case 'consolidate':
        await consolidateMemories(agentId);
        return NextResponse.json({ success: true });

      case 'set_working':
        await setWorkingMemory(agentId, content);
        return NextResponse.json({ success: true });

      case 'clear_working':
        await clearWorkingMemory(agentId);
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json({ error: 'Accion no reconocida' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const agentId = searchParams.get('agentId') || '';

    if (action === 'working') {
      return NextResponse.json({ content: await getWorkingMemory(agentId) });
    }

    if (action === 'stats') {
      return NextResponse.json(await getMemoryStats(agentId));
    }

    return NextResponse.json({ error: 'Accion no reconocida' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
