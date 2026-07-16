import {
  chromium,
  firefox,
  webkit,
  Browser,
  Page,
  BrowserContext,
  BrowserType,
} from 'playwright';
import logger from '../config/logger';
import env from '../config/env';

type BrowserName = 'chromium' | 'firefox' | 'webkit';

function resolveBrowserType(name?: string): { name: BrowserName; type: BrowserType } {
  const key = (name || 'chromium').toLowerCase() as BrowserName;
  if (key === 'firefox') return { name: 'firefox', type: firefox };
  if (key === 'webkit') return { name: 'webkit', type: webkit };
  return { name: 'chromium', type: chromium };
}

export class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private browserName: BrowserName | null = null;

  async initialize(browserName?: string): Promise<void> {
    const { name, type } = resolveBrowserType(browserName);

    if (this.browser && this.browserName === name) return;

    if (this.browser) {
      await this.close();
    }

    logger.info(`Initializing Playwright browser (${name})`);
    this.browser = await type.launch({
      headless: env.PLAYWRIGHT_HEADLESS,
    });
    this.browserName = name;

    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
  }

  async createPage(browserName?: string): Promise<Page> {
    await this.initialize(browserName);

    if (!this.context) {
      throw new Error('Browser context not initialized');
    }

    const page = await this.context.newPage();
    page.setDefaultTimeout(env.PLAYWRIGHT_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(env.PLAYWRIGHT_TIMEOUT_MS);

    return page;
  }

  async closePage(page: Page): Promise<void> {
    try {
      await page.close();
    } catch (error) {
      logger.warn('Error closing page:', error);
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch (error) {
        logger.warn('Error closing context:', error);
      }
      this.context = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        logger.warn('Error closing browser:', error);
      }
      this.browser = null;
    }

    this.browserName = null;
    logger.info('Browser closed');
  }

  isInitialized(): boolean {
    return this.browser !== null;
  }
}

export const browserService = new BrowserService();
