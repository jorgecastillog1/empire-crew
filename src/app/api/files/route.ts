import { NextRequest, NextResponse } from 'next/server';
import {
  writeFile, readFile, deleteFile, fileExists,
  listFiles, moveFile, copyFile, writeJSON, readJSON,
  appendFile, getFileStats, createDirectory, cleanDirectory,
  saveAgentOutput, saveReport, listAgentOutputs,
} from '@/lib/files';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, path, content, from, to, data, agentId, companyId, filename, reportName } = body;

    switch (action) {
      case 'write':
        await writeFile(path, content);
        return NextResponse.json({ success: true, path });

      case 'read': {
        const fileContent = await readFile(path);
        return NextResponse.json({ success: true, content: fileContent });
      }

      case 'delete':
        await deleteFile(path);
        return NextResponse.json({ success: true });

      case 'exists': {
        const exists = await fileExists(path);
        return NextResponse.json({ success: true, exists });
      }

      case 'list': {
        const files = await listFiles(path || '');
        return NextResponse.json({ success: true, files });
      }

      case 'move':
        await moveFile(from, to);
        return NextResponse.json({ success: true });

      case 'copy':
        await copyFile(from, to);
        return NextResponse.json({ success: true });

      case 'write_json':
        await writeJSON(path, data);
        return NextResponse.json({ success: true, path });

      case 'read_json': {
        const jsonData = await readJSON(path);
        return NextResponse.json({ success: true, data: jsonData });
      }

      case 'append':
        await appendFile(path, content);
        return NextResponse.json({ success: true });

      case 'stats': {
        const stats = await getFileStats(path);
        return NextResponse.json({ success: true, stats });
      }

      case 'mkdir':
        await createDirectory(path);
        return NextResponse.json({ success: true });

      case 'clean':
        await cleanDirectory(path);
        return NextResponse.json({ success: true });

      case 'save_agent_output': {
        const savedPath = await saveAgentOutput(agentId, companyId, filename, content);
        return NextResponse.json({ success: true, path: savedPath });
      }

      case 'save_report': {
        const reportPath = await saveReport(companyId, reportName, content);
        return NextResponse.json({ success: true, path: reportPath });
      }

      case 'list_agent_outputs': {
        const outputs = await listAgentOutputs(agentId, companyId);
        return NextResponse.json({ success: true, files: outputs });
      }

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
    const path = searchParams.get('path') || '';
    const files = await listFiles(path);
    return NextResponse.json({ success: true, files });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
