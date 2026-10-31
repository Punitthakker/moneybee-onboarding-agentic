import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { Ctx } from './context';
import type { JobQueue } from './queue';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { caseRoutes, downloadRoute } from './routes/cases';
import { onboardingRoutes } from './routes/onboarding';
import { uaepassRoutes } from './integrations/uaepass/routes';
import { errorHandler } from './routes/util';
import type { WhatsAppAdapter } from './channels/whatsapp/adapter';

export function createApp(ctx: Ctx, queue: JobQueue, opts: { whatsapp?: WhatsAppAdapter } = {}): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.reqId = req.header('x-request-id') ?? randomUUID();
    res.setHeader('x-request-id', req.reqId);
    next();
  });
  app.use(
    pinoHttp({
      logger: ctx.log,
      genReqId: (req) => (req as express.Request).reqId ?? randomUUID(),
      // never log the path of token endpoints: the token is part of the URL
      serializers: { req: (r) => ({ id: r.id, method: r.method, url: String(r.url).replace(/\/onboarding\/[^/]+\//, '/onboarding/[redacted]/') }), res: (r) => ({ statusCode: r.statusCode }) },
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  const origins = ctx.cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: true }));
  // channel webhooks verify an HMAC over the raw body, so they are mounted before the JSON parser
  if (opts.whatsapp) app.use('/api/v1', opts.whatsapp.router());
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/ready', async (_req, res) => {
    const sqlOk = await ctx.repo.ping();
    const ok = sqlOk;
    res.status(ok ? 200 : 503).json({ ok, sql: sqlOk, llm: ctx.llm.isMock ? 'mock' : 'live' });
  });

  const v1 = express.Router();
  v1.use('/auth', authRoutes(ctx));
  v1.use(onboardingRoutes(ctx));
  v1.use(downloadRoute(ctx));
  v1.use(caseRoutes(ctx, queue));
  v1.use(adminRoutes(ctx));
  v1.use(uaepassRoutes(ctx));
  app.use('/api/v1', v1);

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler(ctx));
  return app;
}
