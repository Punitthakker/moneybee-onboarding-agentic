import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
import { tenantRoutes } from './routes/tenants';
import { uaepassRoutes } from './integrations/uaepass/routes';
import { portalRoutes } from './portal/routes';
import { errorHandler } from './routes/util';

export function createApp(ctx: Ctx, queue: JobQueue): Express {
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
  // Without Docker there is no nginx: the API serves the built web app itself (same headers as apps/web/nginx.conf).
  if (ctx.cfg.WEB_DIST) app.use(webApp(path.resolve(ctx.cfg.WEB_DIST)));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  const origins = ctx.cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/ready', async (_req, res) => {
    const recordOk = await ctx.repo.ping();
    const ok = recordOk;
    res.status(ok ? 200 : 503).json({ ok, systemOfRecord: { engine: ctx.cfg.REPO, ok: recordOk }, llm: ctx.llm.isMock ? 'mock' : 'live' });
  });

  const v1 = express.Router();
  v1.use('/auth', authRoutes(ctx));
  v1.use(tenantRoutes(ctx));
  v1.use(onboardingRoutes(ctx));
  v1.use(portalRoutes(ctx, queue));
  v1.use(downloadRoute(ctx));
  v1.use(caseRoutes(ctx, queue));
  v1.use(adminRoutes(ctx));
  v1.use(uaepassRoutes(ctx));
  app.use('/api/v1', v1);

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler(ctx));
  return app;
}

/** Static web app with SPA fallback. Leaves /api, /health and /ready to the API routes. */
function webApp(dist: string): express.RequestHandler {
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) throw new Error(`WEB_DIST has no index.html: ${dist}`);
  const files = express.static(dist, {
    index: false,
    setHeaders(res, file) {
      if (file.endsWith('.mjs')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8'); // pdf.js worker
      res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=2592000, immutable' : 'no-cache');
    },
  });
  // gzip the built assets once and keep them in memory: the bundle is ~1 MB raw, ~0.3 MB compressed
  const gz = new Map<string, Buffer | null>();
  const types: Record<string, string> = { '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  const assetsDir = path.resolve(dist, 'assets');
  const gzipped = (reqPath: string): { body: Buffer; type: string } | null => {
    const type = types[path.extname(reqPath)];
    if (!type || !reqPath.startsWith('/assets/')) return null;
    const file = path.resolve(dist, `.${decodeURIComponent(reqPath)}`);
    if (!file.startsWith(assetsDir + path.sep)) return null;
    if (!gz.has(file)) gz.set(file, fs.existsSync(file) ? zlib.gzipSync(fs.readFileSync(file), { level: 9 }) : null);
    const body = gz.get(file);
    return body ? { body, type } : null;
  };
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || /^\/(api|health$|ready$)/.test(req.path)) return next();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      const g = gzipped(req.path);
      if (g) {
        res.setHeader('Content-Type', g.type);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        res.setHeader('Content-Length', String(g.body.length));
        return void (req.method === 'HEAD' ? res.end() : res.end(g.body));
      }
    }
    files(req, res, () => {
      if (req.path.startsWith('/assets/')) return void res.status(404).end();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  };
}
