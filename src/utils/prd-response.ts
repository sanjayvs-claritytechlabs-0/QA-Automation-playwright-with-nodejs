import { Response } from 'express';

export type PrdError = { code: string; message: string; details?: unknown };

export function prdOk<T extends Record<string, unknown>>(res: Response, body: T, status = 200) {
  return res.status(status).json({ ok: true, ...body });
}

export function prdFail(
  res: Response,
  opts: { retryable: boolean; error: PrdError; extra?: Record<string, unknown> },
  status = 200
) {
  return res.status(status).json({
    ok: false,
    retryable: opts.retryable,
    error: opts.error,
    ...(opts.extra || {}),
  });
}
