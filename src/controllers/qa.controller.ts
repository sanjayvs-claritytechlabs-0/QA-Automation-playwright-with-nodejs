import { Request, Response } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { prdFail, prdOk } from '../utils/prd-response';
import {
  discoverRequestSchema,
  locatorsRequestSchema,
  executeRequestSchema,
} from '../schemas/qa.schema';
import { discoverService } from '../services/discover.service';
import { locatorsService } from '../services/locators.service';
import { executeService } from '../services/execute.service';

export const postDiscover = asyncHandler(async (req: Request, res: Response) => {
  const parsed = discoverRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return prdFail(res, {
      retryable: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid discover request',
        details: parsed.error.errors,
      },
    });
  }

  const result = await discoverService.discover(parsed.data);
  if (!result.ok) {
    return prdFail(res, {
      retryable: result.retryable,
      error: result.error,
    });
  }

  return prdOk(res, {
    base_url: result.base_url,
    pages: result.pages,
    stats: result.stats,
  });
});

export const postLocators = asyncHandler(async (req: Request, res: Response) => {
  const parsed = locatorsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return prdFail(res, {
      retryable: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid locators request',
        details: parsed.error.errors,
      },
    });
  }

  const result = await locatorsService.extract(parsed.data);
  if (!result.ok) {
    return prdFail(res, {
      retryable: result.retryable,
      error: result.error,
      extra:
        'results' in result
          ? { results: result.results, stats: result.stats }
          : undefined,
    });
  }

  return prdOk(res, {
    results: result.results,
    stats: result.stats,
  });
});

export const postExecute = asyncHandler(async (req: Request, res: Response) => {
  const parsed = executeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return prdFail(res, {
      retryable: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid execute request',
        details: parsed.error.errors,
      },
    });
  }

  const result = await executeService.execute(parsed.data);
  if (!result.ok) {
    return prdFail(res, {
      retryable: result.retryable,
      error: result.error,
    });
  }

  return prdOk(res, {
    results: result.results,
    stats: result.stats,
  });
});
