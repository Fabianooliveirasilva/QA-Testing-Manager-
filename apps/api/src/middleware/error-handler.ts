import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import type { Logger } from 'pino';
import { AppError } from '../utils/errors.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return new AppError(status, 'UPLOAD_ERROR', err.message);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return new AppError(409, 'CONFLICT', 'A record with these values already exists');
    if (err.code === 'P2025') return new AppError(404, 'NOT_FOUND', 'Resource not found');
    if (err.code === 'P2003') return new AppError(409, 'CONFLICT', 'Operation violates a relationship constraint');
  }
  // body-parser errors (malformed JSON / payload too large) expose `status` and `type`.
  if (typeof err === 'object' && err !== null && 'type' in err && 'status' in err) {
    const { status, type } = err as { status: number; type: string };
    if (type === 'entity.parse.failed') return new AppError(400, 'BAD_REQUEST', 'Malformed JSON body');
    if (type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    if (status >= 400 && status < 500) return new AppError(status, 'BAD_REQUEST', 'Invalid request');
  }
  return null;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const appError = toAppError(err);
    if (appError) {
      res.status(appError.status).json({
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.details === undefined ? {} : { details: appError.details }),
        },
      });
      return;
    }
    logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
    // Never leak internals (stack traces, SQL) to clients.
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  };
}
