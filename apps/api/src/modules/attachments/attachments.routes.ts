import { randomUUID } from 'node:crypto';
import type { AttachmentEntityType } from '@prisma/client';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ATTACHMENT_ENTITY_TYPES, MAX_UPLOAD_BYTES } from '@qtm/shared';
import type { AppContext } from '../../context.js';
import { requireActiveProject, requirePermission } from '../../middleware/access.js';
import { sha256 } from '../../utils/crypto.js';
import { AppError, badRequest, notFound, parse } from '../../utils/errors.js';
import { userSummary, uuidParam } from '../../utils/guards.js';
import { projectAudit } from '../projects/project-audit.js';
import { sanitizeFileName, validateUpload } from './file-validation.js';
import { projectOf, userOf } from '../../utils/request-context.js';

const entitySchema = z.object({
  entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
  entityId: z.string().uuid(),
});
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function attachmentsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, fieldSize: 1024 },
  });

  /** The target entity must exist inside the current project. */
  const assertEntity = async (projectId: string, entityType: AttachmentEntityType, entityId: string) => {
    const exists =
      entityType === 'TEST_CASE'
        ? await ctx.prisma.testCase.count({ where: { id: entityId, projectId, deletedAt: null } })
        : entityType === 'BUG'
          ? await ctx.prisma.bug.count({ where: { id: entityId, projectId } })
          : await ctx.prisma.testResult.count({ where: { id: entityId, testRun: { projectId } } });
    if (!exists) throw notFound('Target entity');
  };

  const findAttachment = async (projectId: string, attachmentId: unknown) => {
    const attachment = await ctx.prisma.attachment.findFirst({
      where: { id: uuidParam(attachmentId, 'Attachment'), projectId },
    });
    if (!attachment) throw notFound('Attachment');
    return attachment;
  };

  router.get('/', async (req, res) => {
    const { entityType, entityId } = parse(entitySchema, req.query);
    const items = await ctx.prisma.attachment.findMany({
      where: { projectId: projectOf(req).id, entityType, entityId },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        size: true,
        scanStatus: true,
        createdAt: true,
        uploadedBy: userSummary,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ items });
  });

  router.post(
    '/',
    requirePermission('test:write'),
    requireActiveProject,
    upload.single('file'),
    async (req, res) => {
      if (!req.file) throw badRequest('A file field named "file" is required');
      const { entityType, entityId } = parse(entitySchema, req.body);
      await assertEntity(projectOf(req).id, entityType, entityId);
      const fileName = sanitizeFileName(req.file.originalname);
      const mimeType = await validateUpload(fileName, req.file.mimetype, req.file.buffer);
      const verdict = await ctx.scanner.scan(req.file.buffer, fileName);
      if (verdict.status === 'INFECTED') {
        await projectAudit(ctx, req, 'attachment.rejected_malware', 'attachment', null, {
          fileName,
          signature: verdict.signature,
          scanner: ctx.scanner.name,
        });
        throw new AppError(422, 'MALWARE_DETECTED', 'The file was rejected by the malware scanner');
      }
      const storageKey = `${projectOf(req).id}/${randomUUID()}`;
      await ctx.storage.put(storageKey, req.file.buffer);
      try {
        const attachment = await ctx.prisma.attachment.create({
          data: {
            projectId: projectOf(req).id,
            entityType,
            entityId,
            fileName,
            storageKey,
            mimeType,
            size: req.file.size,
            sha256: sha256(req.file.buffer),
            scanStatus: verdict.status,
            uploadedById: userOf(req).id,
          },
          select: { id: true, fileName: true, mimeType: true, size: true, scanStatus: true, createdAt: true },
        });
        await projectAudit(ctx, req, 'attachment.uploaded', 'attachment', attachment.id, {
          entityType,
          entityId,
          fileName,
        });
        res.status(201).json(attachment);
      } catch (error) {
        await ctx.storage.delete(storageKey);
        throw error;
      }
    },
  );

  router.get('/:attachmentId/download', async (req, res) => {
    const attachment = await findAttachment(projectOf(req).id, req.params.attachmentId);
    const data = await ctx.storage.get(attachment.storageKey);
    const inline = req.query.inline === '1' && INLINE_TYPES.has(attachment.mimeType);
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Length': String(data.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.send(data);
  });

  router.delete('/:attachmentId', requirePermission('test:write'), requireActiveProject, async (req, res) => {
    const attachment = await findAttachment(projectOf(req).id, req.params.attachmentId);
    await ctx.prisma.attachment.delete({ where: { id: attachment.id } });
    await ctx.storage.delete(attachment.storageKey);
    await projectAudit(ctx, req, 'attachment.deleted', 'attachment', attachment.id, { fileName: attachment.fileName });
    res.status(204).end();
  });

  return router;
}
