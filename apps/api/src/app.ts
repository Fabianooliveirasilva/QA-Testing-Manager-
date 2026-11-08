import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context.js';
import { loadProject } from './middleware/access.js';
import { CSRF_HEADER, csrfProtection, loadSession, requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { attachmentsRouter } from './modules/attachments/attachments.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { automationRouter, automationTokenRouter } from './modules/automation/automation.routes.js';
import { bugsRouter } from './modules/bugs/bugs.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import { projectRouter } from './modules/projects/projects.routes.js';
import { testCasesRouter } from './modules/test-cases/test-cases.routes.js';
import { testPlansRouter } from './modules/test-plans/test-plans.routes.js';
import { testRunsRouter } from './modules/test-runs/test-runs.routes.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function createApp(ctx: AppContext): Express {
  const app = express();
  const isTest = ctx.config.NODE_ENV === 'test';
  if (ctx.config.TRUST_PROXY) app.set('trust proxy', 1);

  // Correlation id: reuse a well-formed X-Request-Id from the proxy, otherwise generate one.
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    res.set('X-Request-Id', req.requestId);
    next();
  });

  app.use(
    helmet({
      // The API only serves JSON and file downloads; nothing should ever render as a page.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  if (!isTest) {
    app.use(
      pinoHttp({
        logger: ctx.logger,
        genReqId: (req) => (req as express.Request).requestId,
        // Only method, path and status are logged — never bodies (AI prompts, passwords, reports).
        redact: ['req.headers.cookie', 'req.headers.authorization', `req.headers["${CSRF_HEADER}"]`, 'res.headers["set-cookie"]'],
      }),
    );
  }
  app.use(
    cors({
      origin: ctx.config.WEB_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', CSRF_HEADER, 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: isTest ? 10_000 : 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' } },
    }),
  );

  // Liveness: the process is up. Readiness: it can serve traffic (database reachable).
  app.get('/api/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  const readiness: express.RequestHandler = async (req, res) => {
    try {
      await ctx.prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', checks: { database: 'ok' } });
    } catch (err) {
      ctx.logger.error({ err, requestId: req.requestId }, 'readiness check failed');
      res.status(503).json({ status: 'unavailable', checks: { database: 'unavailable' } });
    }
  };
  app.get('/api/health/ready', readiness);
  app.get('/api/health', readiness);

  // Token-authenticated CI upload; registered before the JSON parser because it reads the raw body.
  app.use('/api/automation', automationTokenRouter(ctx));

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(loadSession(ctx));
  app.use(csrfProtection);

  app.use('/api/auth', authRouter(ctx));

  const api = Router();
  api.use(requireAuth);
  api.use('/organizations', organizationsRouter(ctx), aiRouter(ctx));

  const project = Router({ mergeParams: true });
  project.use(loadProject(ctx));
  project.use('/test-cases', testCasesRouter(ctx));
  project.use('/test-plans', testPlansRouter(ctx));
  project.use('/test-runs', testRunsRouter(ctx));
  project.use('/bugs', bugsRouter(ctx));
  project.use('/attachments', attachmentsRouter(ctx));
  project.use('/automation', automationRouter(ctx));
  project.use('/', projectRouter(ctx));
  api.use('/projects/:projectId', project);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler(ctx.logger));
  return app;
}
