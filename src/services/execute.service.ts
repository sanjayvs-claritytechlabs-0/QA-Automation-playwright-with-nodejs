import type { Page } from 'playwright';
import logger from '../config/logger';
import { browserService } from './browser.service';
import { buildPageLocator } from '../utils/locator-resolve';
import { normalizeUrl } from '../utils/url';
import type {
  ExecuteAssertion,
  ExecuteCase,
  ExecuteLocator,
  ExecuteRequest,
  ExecuteStep,
} from '../types/qa.types';

type CaseResult = {
  test_case_id: string;
  test_plan_id?: string;
  status: 'passed' | 'failed' | 'error';
  duration_ms: number;
  error_message: string | null;
  steps: Array<{ ordinal?: number; action: string; ok: boolean; error?: string }>;
  artifacts: Array<{
    kind: string;
    filename: string;
    content_type: string;
    encoding: 'base64';
    data: string;
  }>;
};

function resolveGotoUrl(baseUrl: string, value?: string | null): string {
  if (!value || !value.trim()) return baseUrl;
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  try {
    return new URL(v, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

async function runAssertion(page: Page, assertion: ExecuteAssertion): Promise<void> {
  const type = (assertion.type || '').toLowerCase();
  const expected = assertion.expected ?? '';

  switch (type) {
    case 'url_contains': {
      const url = page.url();
      if (!url.includes(String(expected))) {
        throw new Error(`url_contains failed: expected "${expected}" in "${url}"`);
      }
      return;
    }
    case 'url_equals': {
      const left = normalizeUrl(page.url()) || page.url();
      const right = normalizeUrl(String(expected), page.url()) || String(expected);
      if (left !== right) {
        throw new Error(`url_equals failed: got "${left}", expected "${right}"`);
      }
      return;
    }
    case 'title_contains': {
      const title = await page.title();
      if (!title.includes(String(expected))) {
        throw new Error(`title_contains failed: expected "${expected}" in "${title}"`);
      }
      return;
    }
    case 'visible': {
      if (!assertion.locator) throw new Error('visible assertion requires locator');
      const loc = buildPageLocator(page, assertion.locator);
      await loc.first().waitFor({ state: 'visible', timeout: 10000 });
      return;
    }
    case 'text_contains': {
      if (assertion.locator) {
        const loc = buildPageLocator(page, assertion.locator);
        const text = (await loc.first().textContent()) || '';
        if (!text.includes(String(expected))) {
          throw new Error(`text_contains failed on locator: expected "${expected}"`);
        }
      } else {
        const body = (await page.locator('body').textContent()) || '';
        if (!body.includes(String(expected))) {
          throw new Error(`text_contains failed: expected "${expected}" in page body`);
        }
      }
      return;
    }
    default:
      throw new Error(`Unsupported assertion type: ${assertion.type}`);
  }
}

async function runStep(page: Page, baseUrl: string, step: ExecuteStep): Promise<void> {
  const action = (step.action || '').toLowerCase();
  const value = step.value ?? null;
  const locInput = step.locator as ExecuteLocator | null | undefined;

  switch (action) {
    case 'goto': {
      const url = resolveGotoUrl(baseUrl, value);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return;
    }
    case 'fill': {
      if (!locInput) throw new Error('fill requires locator');
      await buildPageLocator(page, locInput).first().fill(String(value ?? ''));
      return;
    }
    case 'click': {
      if (!locInput) throw new Error('click requires locator');
      await buildPageLocator(page, locInput).first().click();
      return;
    }
    case 'check': {
      if (!locInput) throw new Error('check requires locator');
      await buildPageLocator(page, locInput).first().check();
      return;
    }
    case 'uncheck': {
      if (!locInput) throw new Error('uncheck requires locator');
      await buildPageLocator(page, locInput).first().uncheck();
      return;
    }
    case 'select': {
      if (!locInput) throw new Error('select requires locator');
      await buildPageLocator(page, locInput).first().selectOption(String(value ?? ''));
      return;
    }
    case 'press': {
      if (locInput) {
        await buildPageLocator(page, locInput).first().press(String(value || 'Enter'));
      } else {
        await page.keyboard.press(String(value || 'Enter'));
      }
      return;
    }
    case 'wait': {
      const ms = Number(value);
      if (Number.isFinite(ms) && ms >= 0) {
        // ponytail: capped wait; prefer locator waits when possible
        await page.waitForTimeout(Math.min(ms, 30000));
      } else if (locInput) {
        await buildPageLocator(page, locInput).first().waitFor({ state: 'visible' });
      } else {
        await page.waitForLoadState('domcontentloaded');
      }
      return;
    }
    case 'assert': {
      await runAssertion(page, {
        type: String(value || 'visible'),
        expected: step.description || null,
        locator: locInput || null,
      });
      return;
    }
    default:
      throw new Error(`Unsupported action: ${step.action}`);
  }
}

async function runCase(
  page: Page,
  baseUrl: string,
  c: ExecuteCase,
  screenshotOnFailure: boolean
): Promise<CaseResult> {
  const started = Date.now();
  const stepLog: CaseResult['steps'] = [];
  const artifacts: CaseResult['artifacts'] = [];

  try {
    // Fresh page state per case
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);

    for (const step of c.steps || []) {
      try {
        await runStep(page, baseUrl, step);
        stepLog.push({ ordinal: step.ordinal, action: step.action, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Step failed';
        stepLog.push({ ordinal: step.ordinal, action: step.action, ok: false, error: message });
        throw err;
      }
    }

    for (const assertion of c.assertions || []) {
      await runAssertion(page, assertion);
    }

    return {
      test_case_id: c.test_case_id,
      test_plan_id: c.test_plan_id,
      status: 'passed',
      duration_ms: Date.now() - started,
      error_message: null,
      steps: stepLog,
      artifacts,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Case failed';
    const isError = /Unsupported|requires locator|Missing/i.test(message);
    if (screenshotOnFailure) {
      try {
        const buf = await page.screenshot({ type: 'png', fullPage: false });
        artifacts.push({
          kind: 'screenshot',
          filename: `${c.test_case_id}-fail.png`,
          content_type: 'image/png',
          encoding: 'base64',
          data: buf.toString('base64'),
        });
      } catch (shotErr) {
        logger.warn('Screenshot on failure failed:', shotErr);
      }
    }
    return {
      test_case_id: c.test_case_id,
      test_plan_id: c.test_plan_id,
      status: isError ? 'error' : 'failed',
      duration_ms: Date.now() - started,
      error_message: message,
      steps: stepLog,
      artifacts,
    };
  }
}

export class ExecuteService {
  async execute(input: ExecuteRequest) {
    const screenshotOnFailure = input.capture?.screenshot_on_failure !== false;
    // video/trace: not enabled cheaply on shared singleton context — omit artifacts (do not fake)
    if (input.capture?.video || input.capture?.trace) {
      logger.info('execute: video/trace requested but not implemented on shared browser context');
    }

    let page: Page | null = null;

    try {
      page = await browserService.createPage(input.browser);
      const results: CaseResult[] = [];

      for (const c of input.cases) {
        const result = await runCase(page, input.base_url, c, screenshotOnFailure);
        results.push(result);
      }

      const stats = {
        passed: results.filter((r) => r.status === 'passed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        error: results.filter((r) => r.status === 'error').length,
      };

      return {
        ok: true as const,
        results,
        stats,
      };
    } catch (err) {
      logger.error('Execute top-level failure:', err);
      const message = err instanceof Error ? err.message : 'Execute failed';
      const timeout = /timeout/i.test(message);
      const unavailable = /browser|launch|ECONNREFUSED|Target closed/i.test(message);
      return {
        ok: false as const,
        retryable: true,
        error: {
          code: timeout
            ? 'PLAYWRIGHT_TIMEOUT'
            : unavailable
              ? 'PLAYWRIGHT_UNAVAILABLE'
              : 'PLAYWRIGHT_ERROR',
          message,
        },
      };
    } finally {
      if (page) await browserService.closePage(page);
    }
  }
}

export const executeService = new ExecuteService();
