import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { AppError } from '../errors';

/**
 * Central Express error handler. Maps an AppError to its statusCode/code and
 * surfaces operational messages to the client; anything else is an unexpected
 * 500 with a generic message. 5xx are logged at error level (with stack), 4xx
 * at warn.
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  const isApp = err instanceof AppError;
  const statusCode = isApp ? err.statusCode : (err as { status?: number }).status ?? 500;
  const code = isApp ? err.code : 'INTERNAL_ERROR';

  logger.log(statusCode >= 500 ? 'error' : 'warn', err.message, {
    code,
    statusCode,
    method: req.method,
    path: req.path,
    stack: statusCode >= 500 ? err.stack : undefined,
  });

  const body: Record<string, unknown> = {
    error: isApp && err.isOperational ? err.message : statusCode < 500 ? err.message : 'Internal server error',
    code,
  };
  const details = (err as { details?: unknown }).details;
  if (details !== undefined) body.details = details;

  res.status(statusCode).json(body);
};
