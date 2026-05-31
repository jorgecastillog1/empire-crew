import { NextRequest, NextResponse } from 'next/server';
import { runVideoPipeline, getVideoJob, listVideoJobs } from '@/lib/video-pipeline';

export async function POST(request: NextRequest) {
  try {
    const { productDescription, companyId, platform } = await request.json();
    if (!productDescription || !companyId) {
      return NextResponse.json({ error: 'productDescription and companyId required' }, { status: 400 });
    }
    const job = await runVideoPipeline(productDescription, companyId, platform ?? 'tiktok');
    return NextResponse.json(job);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const companyId = searchParams.get('companyId');
  const action = searchParams.get('action');

  if (action === 'queue' && companyId) {
    const jobs = await listVideoJobs(companyId);
    return NextResponse.json(jobs);
  }

  if (jobId) {
    const job = await getVideoJob(jobId);
    return NextResponse.json(job ?? { error: 'Job not found' });
  }

  if (companyId) {
    const jobs = await listVideoJobs(companyId);
    return NextResponse.json(jobs);
  }

  return NextResponse.json({ error: 'jobId or companyId required' }, { status: 400 });
}