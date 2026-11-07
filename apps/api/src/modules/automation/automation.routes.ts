import express, { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MAX_PLAYWRIGHT_REPORT_BYTES, paginationSchema } from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { requireActiveProject, requirePermission } from '../../middleware/access.js';
import { sha256 } from '../../utils/crypto.js';
import { badRequest, forbidden, notFound, parse, unauthorized } from '../../utils/errors.js';
import { paginate, uuidParam } from '../../utils/guards.js';
import { API_TOKEN_PREFIX } from '../projects/projects.routes.js';
import { importPlaywrightReport } from './automation.service.js';
import { projectOf, userOf } from '../../utils/request-context.js';

const importMetaSchema = z.object({
  runName: z.string().trim().max(150).optional(),
  environment: z.string().trim().max(120).optional(),
});

const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PLAYWRIGHT_REPORT_BYTES, files: 1, fields: 5, fieldSize: 1024 },
});

/** Session-authenticated, project-scoped routes (web UI). */
export function automationRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const { page, pageSize } = parse(paginationSchema, req.query);
    const where = { projectId: projectOf(req).id };
    const [items, total] = await Promise.all([
      ctx.prisma.automationExecution.findMany({
        where,
        include: { testRun: { select: { id: true, name: true, environment: true } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(page, pageSize),
      }),
      ctx.prisma.automationExecution.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  });

  router.get('/:executionId', async (req, res) => {
    const execution = await ctx.prisma.automationExecution.findFirst({
      where: { id: uuidParam(req.params.executionId, 'Execution'), projectId: projectOf(req).id },
      include: { testRun: { select: { id: true, name: true, environment: true, startedAt: true, finishedAt: true } } },
    });
    if (!execution) throw notFound('Execution');
    res.json(execution);
  });

  router.post(
    '/playwright',
    requirePermission('test:write'),
    requireActiveProject,
    reportUpload.single('report'),
    async (req, res) => {
      if (!req.file) throw badRequest('Upload the report as a multipart field named "report"');
      const meta = parse(importMetaSchema, req.body ?? {});
      const execution = await importPlaywrightReport(ctx, {
        projectId: projectOf(req).id,
        organizationId: projectOf(req).organizationId,
        userId: userOf(req).id,
        source: 'upload',
        runName: meta.runName,
        environment: meta.environment,
        raw: req.file.buffer,
      });
      res.status(201).json(execution);
    },
  );

  return router;
}

/**
 * CI endpoint authenticated by a project API token (Authorization: Bearer qtm_...).
 * Accepts the raw JSON report as the request body; the token only grants report import.
 */
export function automationTokenRouter(ctx: AppContext): Router {
  const router = Router();
  router.post(
    '/playwright',
    express.raw({ type: ['application/json', 'application/octet-stream'], limit: MAX_PLAYWRIGHT_REPORT_BYTES }),
    async (req, res) => {
      const header = req.get('authorization') ?? '';
      const [scheme, secret] = header.split(' ');
      if (scheme !== 'Bearer' || !secret?.startsWith(API_TOKEN_PREFIX)) throw unauthorized('API token required');
      const token = await ctx.prisma.apiToken.findUnique({
        where: { tokenHash: sha256(secret) },
        include: { project: true },
      });
      if (!token || token.revokedAt) throw unauthorized('Invalid or revoked API token');
      if (token.project.status === 'ARCHIVED') throw forbidden('Project is archived');
      if (!token.createdById) throw forbidden('Token owner no longer exists; create a new token');
      const owner = await ctx.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId: token.project.organizationId, userId: token.createdById },
        },
      });
      // A token stops working when its creator leaves the organization or loses write access.
      if (!owner || owner.role === 'VIEWER') throw forbidden('Token owner no longer has access to this project');
      if (!Buffer.isBuffer(req.body)) throw badRequest('Send the report JSON with Content-Type: application/json');

      const meta = parse(importMetaSchema, {
        runName: typeof req.query.runName === 'string' ? req.query.runName : undefined,
        environment: typeof req.query.environment === 'string' ? req.query.environment : undefined,
      });
      const execution = await importPlaywrightReport(ctx, {
        projectId: token.projectId,
        organizationId: token.project.organizationId,
        userId: token.createdById,
        source: `api-token:${token.prefix}`,
        runName: meta.runName,
        environment: meta.environment,
        raw: req.body,
      });
      await ctx.prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
      res.status(201).json(execution);
    },
  );
  return router;
}
