import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import type { Ctx } from './context';
import { runPipeline, type RunFrom } from './agents/orchestrator';
import { deliverWebhook } from './webhook';

export interface PipelineJob {
  caseId: string;
  runSeq: number;
  from: RunFrom;
}
/** Jobs carry only the delivery id. The (encrypted) body is loaded from the store so the token never sits in Redis. */
export interface WebhookJob {
  deliveryId: string;
  /** inline queue only: attempt counter (BullMQ tracks attempts itself) */
  attempt?: number;
}

export interface JobQueue {
  enqueuePipeline(j: PipelineJob): Promise<void>;
  enqueueWebhook(j: WebhookJob, delayMs?: number): Promise<void>;
  close(): Promise<void>;
}

/** Inline queue: runs jobs in-process (tests, QUEUE_MODE=inline). Webhook retries run on timers. */
export function createInlineQueue(getCtx: () => Ctx, opts: { awaitPipeline?: boolean } = {}): JobQueue {
  const pending = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>) => {
    pending.add(p);
    p.finally(() => pending.delete(p));
    return p;
  };
  const q: JobQueue & { idle(): Promise<void> } = {
    async enqueuePipeline(j) {
      const p = runPipeline(getCtx(), j.caseId, j.runSeq, j.from).catch(() => undefined);
      track(p);
      if (opts.awaitPipeline) await p;
    },
    async enqueueWebhook(j, delayMs = 0) {
      const run = async () => {
        const attempt = j.attempt ?? 1;
        const out = await deliverWebhook(getCtx(), j, attempt);
        if (!out.ok && out.retry) await q.enqueueWebhook({ ...j, attempt: attempt + 1 }, getCtx().cfg.WEBHOOK_BACKOFF_MS * 2 ** (attempt - 1));
      };
      if (delayMs > 0) setTimeout(() => void track(run()), delayMs).unref();
      else track(run());
    },
    async idle() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    async close() {
      await q.idle();
    },
  };
  return q;
}

export function createBullQueue(getCtx: () => Ctx): JobQueue {
  const ctx = getCtx();
  const connection = new IORedis(ctx.cfg.REDIS_URL, { maxRetriesPerRequest: null });
  const pipelineQ = new Queue('pipeline', { connection });
  const webhookQ = new Queue('webhook', { connection });

  const pipelineWorker = new Worker<PipelineJob>(
    'pipeline',
    async (job: Job<PipelineJob>) => {
      await runPipeline(getCtx(), job.data.caseId, job.data.runSeq, job.data.from);
    },
    { connection, concurrency: 2 },
  );
  const webhookWorker = new Worker<WebhookJob>(
    'webhook',
    async (job: Job<WebhookJob>) => {
      const out = await deliverWebhook(getCtx(), job.data, job.attemptsMade + 1);
      if (!out.ok && out.retry) throw new Error(out.error ?? 'delivery failed');
    },
    { connection, concurrency: 4 },
  );
  webhookWorker.on('failed', async (job, err) => {
    // attempts exhausted -> dead letter
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) await getCtx().store.webhooks.update(job.data.deliveryId, { status: 'DEAD', lastError: err.message });
  });
  pipelineWorker.on('error', (e) => getCtx().log.error({ err: e }, 'pipeline worker error'));
  webhookWorker.on('error', (e) => getCtx().log.error({ err: e }, 'webhook worker error'));

  return {
    async enqueuePipeline(j) {
      // idempotent: same case + run sequence is the same job
      await pipelineQ.add('run', j, { jobId: `run-${j.caseId}-${j.runSeq}`, attempts: 2, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 100, removeOnFail: 100 });
    },
    async enqueueWebhook(j, delayMs = 0) {
      await webhookQ.add('deliver', j, {
        jobId: `wh-${j.deliveryId}-${Date.now()}`,
        delay: delayMs,
        attempts: getCtx().cfg.WEBHOOK_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: getCtx().cfg.WEBHOOK_BACKOFF_MS },
        removeOnComplete: 100,
        removeOnFail: false,
      });
    },
    async close() {
      await Promise.all([pipelineWorker.close(), webhookWorker.close(), pipelineQ.close(), webhookQ.close()]);
      connection.disconnect();
    },
  };
}
