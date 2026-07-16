import type { Page } from 'playwright';
import logger from '../config/logger';
import { browserService } from './browser.service';
import { STRATEGY_ALLOWLIST } from '../utils/locator-resolve';
import type { ExtractedLocator, LocatorsRequest } from '../types/qa.types';

type RawLocator = {
  name: string | null;
  strategy: string;
  selector: string;
  role: string | null;
  accessible_name: string | null;
  meta: Record<string, unknown>;
};

async function extractLocatorsFromDom(page: Page, maxPerPage: number): Promise<RawLocator[]> {
  const raw = await page.evaluate((cap: number) => {
    type R = {
      name: string | null;
      strategy: string;
      selector: string;
      role: string | null;
      accessible_name: string | null;
      meta: Record<string, unknown>;
    };

    const results: R[] = [];
    const seen = new Set<string>();

    const push = (loc: R) => {
      const key = `${loc.strategy}|${loc.selector}|${loc.role || ''}|${loc.accessible_name || ''}`;
      if (seen.has(key) || results.length >= cap) return;
      seen.add(key);
      results.push(loc);
    };

    const accessibleName = (el: Element): string | null => {
      const aria = el.getAttribute('aria-label')?.trim();
      if (aria) return aria;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const parts = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim())
          .filter(Boolean);
        if (parts.length) return parts.join(' ');
      }
      const id = el.getAttribute('id');
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const t = lab?.textContent?.replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      const parentLabel = el.closest('label');
      if (parentLabel) {
        const t = parentLabel.textContent?.replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return text || null;
    };

    const cssPath = (el: Element): string => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1 && parts.length < 4) {
        let part = cur.tagName.toLowerCase();
        const parent: Element | null = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (c) => c.tagName === cur!.tagName
          );
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            part += `:nth-of-type(${idx})`;
          }
        }
        parts.unshift(part);
        cur = parent;
        if (cur?.tagName === 'BODY') break;
      }
      return parts.join(' > ');
    };

    const candidates = Array.from(
      document.querySelectorAll(
        [
          'a[href]',
          'button',
          'input',
          'select',
          'textarea',
          '[role="button"]',
          '[role="link"]',
          '[role="textbox"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="combobox"]',
          '[role="menuitem"]',
          '[role="tab"]',
          '[role="switch"]',
          '[data-testid]',
          '[data-test-id]',
          '[data-test]',
        ].join(',')
      )
    );

    for (const el of candidates) {
      if (results.length >= cap) break;
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type');
      const roleAttr = el.getAttribute('role');
      const testId =
        el.getAttribute('data-testid') ||
        el.getAttribute('data-test-id') ||
        el.getAttribute('data-test');
      const placeholder = el.getAttribute('placeholder');
      const nameAttr = el.getAttribute('name') || el.getAttribute('id');
      const acc = accessibleName(el);

      const meta: Record<string, unknown> = {
        tag,
        ...(type ? { type } : {}),
      };

      // Prefer testid → role → placeholder/label → css
      if (testId) {
        push({
          name: nameAttr || acc || testId,
          strategy: 'testid',
          selector: testId,
          role: roleAttr,
          accessible_name: acc,
          meta,
        });
        continue;
      }

      const role =
        roleAttr ||
        (tag === 'button' || type === 'submit' || type === 'button'
          ? 'button'
          : tag === 'a'
            ? 'link'
            : tag === 'input' || tag === 'textarea'
              ? 'textbox'
              : tag === 'select'
                ? 'combobox'
                : type === 'checkbox'
                  ? 'checkbox'
                  : type === 'radio'
                    ? 'radio'
                    : null);

      if (role && acc) {
        push({
          name: nameAttr || acc,
          strategy: 'role',
          selector: role,
          role,
          accessible_name: acc,
          meta,
        });
        continue;
      }

      if (placeholder) {
        push({
          name: nameAttr || placeholder,
          strategy: 'placeholder',
          selector: placeholder,
          role: roleAttr,
          accessible_name: acc,
          meta,
        });
        continue;
      }

      if (acc && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
        push({
          name: nameAttr || acc,
          strategy: 'label',
          selector: acc,
          role: roleAttr,
          accessible_name: acc,
          meta,
        });
        continue;
      }

      push({
        name: nameAttr || acc,
        strategy: 'css',
        selector: cssPath(el),
        role: roleAttr,
        accessible_name: acc,
        meta,
      });
    }

    return results;
  }, maxPerPage);

  return raw
    .filter((l) => STRATEGY_ALLOWLIST.has(l.strategy.toLowerCase()) && l.selector)
    .map((l) => ({
      ...l,
      strategy: l.strategy.toLowerCase(),
    }))
    .slice(0, maxPerPage);
}

export class LocatorsService {
  async extract(input: LocatorsRequest) {
    const maxPerPage = input.max_per_page ?? 80;
    const results: Array<{
      page_id: string;
      url: string;
      ok: boolean;
      locators: ExtractedLocator[];
      retryable?: boolean;
      error?: { code: string; message: string };
    }> = [];

    let page: Page | null = null;
    let locatorCount = 0;
    let pagesOk = 0;
    let pagesFailed = 0;

    try {
      page = await browserService.createPage(input.browser);

      for (const entry of input.pages) {
        try {
          await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          const locators = await extractLocatorsFromDom(page, maxPerPage);
          const withMeta = locators.map((l) => ({
            ...l,
            meta: { ...l.meta, url: entry.url },
          }));
          locatorCount += withMeta.length;
          pagesOk += 1;
          results.push({
            page_id: entry.page_id,
            url: entry.url,
            ok: true,
            locators: withMeta,
          });
        } catch (err) {
          pagesFailed += 1;
          const message = err instanceof Error ? err.message : 'Page locator extraction failed';
          const retryable = /timeout|net::|Target closed|Navigation/i.test(message);
          logger.warn(`Locators page error ${entry.page_id}:`, err);
          results.push({
            page_id: entry.page_id,
            url: entry.url,
            ok: false,
            retryable,
            error: {
              code: retryable ? 'NAVIGATION_TIMEOUT' : 'LOCATOR_EXTRACT_ERROR',
              message,
            },
            locators: [],
          });
        }
      }

      if (locatorCount === 0) {
        return {
          ok: false as const,
          retryable: false,
          error: {
            code: 'LOCATORS_EMPTY',
            message: 'Zero locators after all pages',
          },
          results,
          stats: { pages_ok: pagesOk, pages_failed: pagesFailed, locator_count: 0 },
        };
      }

      return {
        ok: true as const,
        results,
        stats: {
          pages_ok: pagesOk,
          pages_failed: pagesFailed,
          locator_count: locatorCount,
        },
      };
    } catch (err) {
      logger.error('Locators top-level failure:', err);
      const message = err instanceof Error ? err.message : 'Locators failed';
      const unavailable = /browser|launch|ECONNREFUSED|Target closed/i.test(message);
      return {
        ok: false as const,
        retryable: true,
        error: {
          code: unavailable ? 'PLAYWRIGHT_UNAVAILABLE' : 'PLAYWRIGHT_ERROR',
          message,
        },
      };
    } finally {
      if (page) await browserService.closePage(page);
    }
  }
}

export const locatorsService = new LocatorsService();
