import type { Page } from 'playwright';
import logger from '../config/logger';
import { browserService } from './browser.service';
import { isSameOrigin, normalizeUrl } from '../utils/url';
import type { DiscoverPage, DiscoverRequest, PageModel } from '../types/qa.types';

const HARD_MAX_DEPTH = 5;
const HARD_MAX_PAGES = 200;

type QueueItem = { url: string; depth: number };

type DiscoverSuccess = {
  ok: true;
  base_url: string;
  pages: DiscoverPage[];
  stats: { visited: number; skipped_external: number; errors: number };
};

type DiscoverFailure = {
  ok: false;
  retryable: boolean;
  error: { code: string; message: string };
};

async function extractPageModel(page: Page): Promise<PageModel> {
  return page.evaluate(() => {
    const textOf = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const labelFor = (el: Element): string | null => {
      const id = el.getAttribute('id');
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab) return textOf(lab) || null;
      }
      const parentLabel = el.closest('label');
      if (parentLabel) return textOf(parentLabel) || null;
      const aria = el.getAttribute('aria-label');
      return aria?.trim() || null;
    };

    const forms = Array.from(document.querySelectorAll('form')).slice(0, 20).map((form) => {
      const inputs = Array.from(
        form.querySelectorAll('input, textarea, select')
      )
        .slice(0, 40)
        .map((el) => ({
          label: labelFor(el),
          type: el.getAttribute('type') || el.tagName.toLowerCase(),
          placeholder: el.getAttribute('placeholder'),
          required: (el as HTMLInputElement).required === true,
          name: el.getAttribute('name'),
        }));
      const buttons = Array.from(
        form.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')
      )
        .slice(0, 20)
        .map((el) => ({
          text: textOf(el) || (el as HTMLInputElement).value || null,
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
        }));
      return {
        name: form.getAttribute('name') || form.getAttribute('id') || form.getAttribute('aria-label'),
        inputs,
        buttons,
      };
    });

    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')
    )
      .slice(0, 60)
      .map((el) => ({
        text: textOf(el) || (el as HTMLInputElement).value || null,
        role: el.getAttribute('role') || 'button',
      }));

    const links = Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 80)
      .map((el) => ({
        text: textOf(el) || null,
        href: el.getAttribute('href'),
      }));

    const dropdowns = Array.from(document.querySelectorAll('select'))
      .slice(0, 30)
      .map((sel) => ({
        label: labelFor(sel),
        options: Array.from(sel.querySelectorAll('option'))
          .slice(0, 30)
          .map((o) => textOf(o))
          .filter(Boolean),
      }));

    const checkboxes = Array.from(
      document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')
    )
      .slice(0, 40)
      .map((el) => ({
        label: labelFor(el),
        checked:
          (el as HTMLInputElement).checked === true ||
          el.getAttribute('aria-checked') === 'true',
      }));

    const tables = Array.from(document.querySelectorAll('table'))
      .slice(0, 10)
      .map((table) => {
        const headers = Array.from(table.querySelectorAll('th'))
          .slice(0, 20)
          .map((th) => textOf(th))
          .filter(Boolean);
        return {
          headers,
          row_count: table.querySelectorAll('tr').length,
        };
      });

    const visible_text: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()) && visible_text.length < 40) {
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && t.length <= 120) visible_text.push(t);
    }

    const labels = Array.from(document.querySelectorAll('label'))
      .slice(0, 60)
      .map((l) => textOf(l))
      .filter(Boolean);

    const aria_roles = Array.from(
      new Set(
        Array.from(document.querySelectorAll('[role]'))
          .map((el) => el.getAttribute('role') || '')
          .filter(Boolean)
          .slice(0, 40)
      )
    );

    return {
      forms,
      buttons,
      links,
      dropdowns,
      checkboxes,
      tables,
      visible_text,
      labels,
      aria_roles,
      locator_map: [],
    };
  });
}

async function collectSameOriginHrefs(page: Page, baseUrl: string): Promise<string[]> {
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href') || '')
      .filter(Boolean)
  );
  const out: string[] = [];
  for (const href of hrefs) {
    const n = normalizeUrl(href, baseUrl);
    if (n) out.push(n);
  }
  return out;
}

export class DiscoverService {
  async discover(input: DiscoverRequest): Promise<DiscoverSuccess | DiscoverFailure> {
    const baseNormalized = normalizeUrl(input.base_url);
    if (!baseNormalized) {
      return {
        ok: false,
        retryable: false,
        error: { code: 'VALIDATION_ERROR', message: 'base_url must be a valid http(s) URL' },
      };
    }

    const maxDepth = Math.min(input.max_depth ?? 2, HARD_MAX_DEPTH);
    const maxPages = Math.min(input.max_pages ?? 50, HARD_MAX_PAGES);
    const sameOrigin = input.same_origin !== false;
    const capture = {
      html_snapshot: input.capture?.html_snapshot !== false,
      screenshot: input.capture?.screenshot !== false,
      meta_description: input.capture?.meta_description !== false,
      page_model: input.capture?.page_model !== false,
    };

    let page: Page | null = null;
    let visited = 0;
    let skippedExternal = 0;
    let errors = 0;
    const pages: DiscoverPage[] = [];
    const seen = new Set<string>();

    // When seed_urls present: visit those (same-origin) up to max_pages; skip BFS link expansion
    // so CSV/manual jobs don't wander into slow demo pages first.
    const seedCandidates: string[] = [];
    for (const raw of input.seed_urls ?? []) {
      const n = normalizeUrl(raw);
      if (!n) continue;
      if (sameOrigin && !isSameOrigin(baseNormalized, n)) {
        skippedExternal += 1;
        continue;
      }
      if (!seedCandidates.includes(n)) seedCandidates.push(n);
    }
    const seedMode = seedCandidates.length > 0;
    const queue: QueueItem[] = seedMode
      ? seedCandidates.slice(0, maxPages).map((url) => ({ url, depth: 0 }))
      : [{ url: baseNormalized, depth: 0 }];

    try {
      page = await browserService.createPage(input.browser);

      while (queue.length > 0 && pages.length < maxPages) {
        const item = queue.shift()!;
        if (seen.has(item.url)) continue;
        if (item.depth > maxDepth) continue;
        seen.add(item.url);
        visited += 1;

        try {
          const response = await page.goto(item.url, {
            waitUntil: 'domcontentloaded',
            // Keep under Railway proxy budget; slow pages skip rather than burn 60s each.
            timeout: 20000,
          });
          const status = response?.status() ?? 0;
          const finalUrl = normalizeUrl(page.url()) || item.url;
          seen.add(finalUrl);

          const title = await page.title();
          let metaDescription: string | null = null;
          if (capture.meta_description) {
            metaDescription = await page
              .locator('meta[name="description"]')
              .getAttribute('content')
              .catch(() => null);
          }

          const discovered: DiscoverPage = {
            url: finalUrl,
            title: title || '',
            meta_description: metaDescription,
            depth: item.depth,
            status,
            meta: {},
          };

          if (capture.html_snapshot) {
            try {
              discovered.html = await page.content();
            } catch (e) {
              discovered.meta.snapshot_error =
                e instanceof Error ? e.message : 'html_snapshot failed';
            }
          }

          if (capture.screenshot) {
            try {
              const buf = await page.screenshot({ type: 'png', fullPage: false });
              discovered.screenshot = {
                content_type: 'image/png',
                encoding: 'base64',
                data: buf.toString('base64'),
              };
            } catch (e) {
              discovered.meta.screenshot_error =
                e instanceof Error ? e.message : 'screenshot failed';
            }
          }

          if (capture.page_model) {
            try {
              discovered.page_model = await extractPageModel(page);
            } catch (e) {
              discovered.page_model = {
                forms: [],
                buttons: [],
                links: [],
                dropdowns: [],
                checkboxes: [],
                tables: [],
                visible_text: [],
                labels: [],
                aria_roles: [],
                locator_map: [],
              };
              discovered.meta.page_model_error =
                e instanceof Error ? e.message : 'page_model failed';
            }
          }

          pages.push(discovered);

          // Seed mode: only visit listed URLs (no BFS). Otherwise expand same-origin links.
          if (!seedMode && item.depth < maxDepth && pages.length < maxPages) {
            const links = await collectSameOriginHrefs(page, finalUrl);
            for (const link of links) {
              if (sameOrigin && !isSameOrigin(baseNormalized, link)) {
                skippedExternal += 1;
                continue;
              }
              if (!seen.has(link) && !queue.some((q) => q.url === link)) {
                queue.push({ url: link, depth: item.depth + 1 });
              }
            }
          }
        } catch (err) {
          errors += 1;
          logger.warn(`Discover page error for ${item.url}:`, err);
          // Continue crawl; do not add a broken page row unless we got something useful
        }
      }

      if (pages.length === 0) {
        return {
          ok: false,
          retryable: false,
          error: {
            code: 'DISCOVERY_EMPTY',
            message: 'No usable pages after crawl',
          },
        };
      }

      return {
        ok: true,
        base_url: baseNormalized,
        pages,
        stats: { visited, skipped_external: skippedExternal, errors },
      };
    } catch (err) {
      logger.error('Discover top-level failure:', err);
      const message = err instanceof Error ? err.message : 'Discover failed';
      const unavailable =
        /browser|launch|ECONNREFUSED|timeout|Target closed/i.test(message);
      return {
        ok: false,
        retryable: unavailable,
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

export const discoverService = new DiscoverService();
