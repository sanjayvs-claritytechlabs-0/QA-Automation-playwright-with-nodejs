import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from 'playwright';
import logger from '../config/logger';
import env from '../config/env';
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

type CaseArtifact = {
  kind: string;
  filename: string;
  content_type: string;
  encoding: 'base64';
  data: string;
};

type CaseResult = {
  test_case_id: string;
  test_plan_id?: string;
  status: 'passed' | 'failed' | 'error';
  duration_ms: number;
  error_message: string | null;
  steps: Array<{ ordinal?: number; action: string; ok: boolean; error?: string }>;
  artifacts: CaseArtifact[];
};

type BrowserName = 'chromium' | 'firefox' | 'webkit';

function resolveBrowserType(name?: string): { name: BrowserName; type: BrowserType } {
  const key = (name || 'chromium').toLowerCase() as BrowserName;
  if (key === 'firefox') return { name: 'firefox', type: firefox };
  if (key === 'webkit') return { name: 'webkit', type: webkit };
  return { name: 'chromium', type: chromium };
}

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

async function captureScreenshot(
  page: Page,
  artifacts: CaseArtifact[],
  testCaseId: string,
  suffix: string
): Promise<void> {
  try {
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    artifacts.push({
      kind: 'screenshot',
      filename: `${testCaseId}-${suffix}.png`,
      content_type: 'image/png',
      encoding: 'base64',
      data: buf.toString('base64'),
    });
  } catch (shotErr) {
    logger.warn('Screenshot capture failed:', shotErr);
  }
}

async function runCase(
  page: Page,
  baseUrl: string,
  c: ExecuteCase,
  captureScreenshotEnabled: boolean
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

    if (captureScreenshotEnabled) {
      await captureScreenshot(page, artifacts, c.test_case_id, 'pass');
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
    if (captureScreenshotEnabled) {
      await captureScreenshot(page, artifacts, c.test_case_id, 'fail');
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

async function readVideoArtifact(
  page: Page,
  context: BrowserContext,
  testCaseId: string,
  videoDir: string
): Promise<CaseArtifact | null> {
  const video = page.video();
  try {
    await page.close().catch(() => undefined);
    await context.close();
  } catch (closeErr) {
    logger.warn('Context close after video failed:', closeErr);
  }

  if (!video) {
    await fs.rm(videoDir, { recursive: true, force: true }).catch(() => undefined);
    return null;
  }

  try {
    const videoPath = await video.path();
    const buf = await fs.readFile(videoPath);
    return {
      kind: 'video',
      filename: `${testCaseId}.webm`,
      content_type: 'video/webm',
      encoding: 'base64',
      data: buf.toString('base64'),
    };
  } catch (vidErr) {
    logger.warn('Video artifact read failed:', vidErr);
    return null;
  } finally {
    await fs.rm(videoDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export class ExecuteService {
  async execute(input: ExecuteRequest) {
    // screenshot_on_failure=true (default) → screenshot every case (pass + fail)
    const captureScreenshotEnabled = input.capture?.screenshot_on_failure !== false;
    const captureVideo = input.capture?.video === true;
    if (input.capture?.trace) {
      logger.info('execute: trace requested but not implemented (no fake artifacts)');
    }

    try {
      if (captureVideo) {
        return await this.executeWithVideo(input, captureScreenshotEnabled);
      }
      return await this.executeSharedPage(input, captureScreenshotEnabled);
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
    }
  }

  /** Fast path: one shared page, screenshot per case when enabled. */
  private async executeSharedPage(input: ExecuteRequest, captureScreenshotEnabled: boolean) {
    let page: Page | null = null;
    try {
      page = await browserService.createPage(input.browser);
      const results: CaseResult[] = [];
      for (const c of input.cases) {
        results.push(await runCase(page, input.base_url, c, captureScreenshotEnabled));
      }
      return {
        ok: true as const,
        results,
        stats: statsFrom(results),
      };
    } finally {
      if (page) await browserService.closePage(page);
    }
  }

  /**
   * Video requires recordVideo on a dedicated context per case.
   * One browser launch; new context+page per case; video finalized on context close.
   */
  private async executeWithVideo(input: ExecuteRequest, captureScreenshotEnabled: boolean) {
    const { type } = resolveBrowserType(input.browser);
    let browser: Browser | null = null;

    try {
      browser = await type.launch({ headless: env.PLAYWRIGHT_HEADLESS });
      const results: CaseResult[] = [];

      for (const c of input.cases) {
        const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-vid-'));
        let context: BrowserContext | null = null;
        let page: Page | null = null;
        try {
          context = await browser.newContext({
            userAgent:
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
          });
          page = await context.newPage();
          page.setDefaultTimeout(env.PLAYWRIGHT_TIMEOUT_MS);
          page.setDefaultNavigationTimeout(env.PLAYWRIGHT_TIMEOUT_MS);

          const result = await runCase(page, input.base_url, c, captureScreenshotEnabled);
          const videoArt = await readVideoArtifact(page, context, c.test_case_id, videoDir);
          page = null;
          context = null;
          if (videoArt) result.artifacts.push(videoArt);
          results.push(result);
        } catch (caseErr) {
          if (page) await page.close().catch(() => undefined);
          if (context) await context.close().catch(() => undefined);
          await fs.rm(videoDir, { recursive: true, force: true }).catch(() => undefined);
          throw caseErr;
        }
      }

      return {
        ok: true as const,
        results,
        stats: statsFrom(results),
      };
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          logger.warn('Video browser close failed:', closeErr);
        }
      }
    }
  }
}

function statsFrom(results: CaseResult[]) {
  return {
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    error: results.filter((r) => r.status === 'error').length,
  };
}

export const executeService = new ExecuteService();
