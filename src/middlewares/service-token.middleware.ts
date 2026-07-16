import { Request, Response, NextFunction } from 'express';
import env from '../config/env';
import { prdFail } from '../utils/prd-response';

/**
 * Optional shared-secret auth. Active only when PLAYWRIGHT_SERVICE_TOKEN is set.
 * Accepts Authorization: Bearer <token> or X-Service-Token: <token>.
 */
export function serviceTokenAuth(req: Request, res: Response, next: NextFunction) {
  const expected = env.PLAYWRIGHT_SERVICE_TOKEN;
  if (!expected) {
    return next();
  }

  const auth = req.headers.authorization;
  const bearer =
    typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : null;
  const header = req.headers['x-service-token'];
  const fromHeader = typeof header === 'string' ? header.trim() : null;
  const provided = bearer || fromHeader;

  if (!provided || provided !== expected) {
    return prdFail(
      res,
      {
        retryable: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid service token' },
      },
      401
    );
  }

  return next();
}
