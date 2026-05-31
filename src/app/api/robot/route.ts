import { NextRequest, NextResponse } from 'next/server';
import {
  dispatchRobotJob,
  executeRobotJob,
  getRobotJob,
  getRobotQueue,
  getRobotLog,
  scheduleTask,
  runScheduler,
  getScheduledTasks,
  RobotJobType,
} from '@/lib/robot';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') ?? 'queue';
  const companyId = searchParams.get('companyId') ?? '';
  const jobId = searchParams.get('jobId') ?? '';

  try {
    if (action === 'queue') {
      return NextResponse.json(await getRobotQueue());
    }
    if (action === 'log') {
      return NextResponse.json(await getRobotLog());
    }
    if (action === 'job' && jobId) {
      const job = await getRobotJob(jobId);
      if (!job) return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 });
      return NextResponse.json(job);
    }
    if (action === 'schedule' && companyId) {
      return NextResponse.json(await getScheduledTasks(companyId));
    }
    if (action === 'run_scheduler') {
      return NextResponse.json(await runScheduler());
    }
    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, type, companyId, companyType, payload, jobId, task } = body;

    if (action === 'dispatch') {
      if (!type || !companyId || !companyType) {
        return NextResponse.json({ error: 'type, companyId y companyType son requeridos' }, { status: 400 });
      }
      const job = await dispatchRobotJob(type as RobotJobType, companyId, companyType, payload ?? {});
      return NextResponse.json(job, { status: 201 });
    }

    if (action === 'execute') {
      if (!jobId) return NextResponse.json({ error: 'jobId requerido' }, { status: 400 });
      const job = await executeRobotJob(jobId);
      return NextResponse.json(job);
    }

    if (action === 'dispatch_and_execute') {
      if (!type || !companyId || !companyType) {
        return NextResponse.json({ error: 'type, companyId y companyType son requeridos' }, { status: 400 });
      }
      const job = await dispatchRobotJob(type as RobotJobType, companyId, companyType, payload ?? {});
      const result = await executeRobotJob(job.id);
      return NextResponse.json(result);
    }

    if (action === 'schedule') {
      if (!task) return NextResponse.json({ error: 'task requerido' }, { status: 400 });
      await scheduleTask(task);
      return NextResponse.json({ scheduled: true });
    }

    if (action === 'run_scheduler') {
      return NextResponse.json(await runScheduler());
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}