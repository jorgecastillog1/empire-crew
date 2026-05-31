import { chromium, Browser, Page, BrowserContext } from 'playwright';

let browserInstance: Browser | null = null;

const IS_SERVERLESS = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const BROWSERLESS_URL = process.env.BROWSERLESS_URL ?? '';

async function getBrowser(): Promise<Browser> {
  if (IS_SERVERLESS && BROWSERLESS_URL) {
    browserInstance = await chromium.connectOverCDP(BROWSERLESS_URL);
  } else if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserInstance;
}

export interface BrowserAction {
  action: 'navigate' | 'click' | 'type' | 'screenshot' | 'extract' | 'evaluate' | 'wait' | 'scroll' | 'select' | 'submit';
  selector?: string;
  value?: string;
  script?: string;
  url?: string;
  timeout?: number;
}

export interface BrowserResult {
  success: boolean;
  data?: any;
  screenshot?: string;
  error?: string;
  duration: number;
}

export interface BrowserSession {
  sessionId: string;
  companyId: string;
  agentId: string;
  url: string;
  actions: BrowserAction[];
  results: BrowserResult[];
  startedAt: number;
  status: 'running' | 'completed' | 'failed';
}

export async function executeBrowserTask(
  actions: BrowserAction[],
  options: {
    agentId?: string;
    companyId?: string;
    saveScreenshots?: boolean;
  } = {}
): Promise<BrowserResult[]> {
  const browser = await getBrowser();
  const context: BrowserContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  const page: Page = await context.newPage();
  const results: BrowserResult[] = [];

  for (const action of actions) {
    const start = Date.now();
    try {
      switch (action.action) {
        case 'navigate':
          await page.goto(action.url || '', { waitUntil: 'domcontentloaded', timeout: action.timeout || 30000 });
          results.push({ success: true, data: page.url(), duration: Date.now() - start });
          break;

        case 'click':
          await page.click(action.selector || '', { timeout: action.timeout || 10000 });
          results.push({ success: true, data: `Clicked: ${action.selector}`, duration: Date.now() - start });
          break;

        case 'type':
          await page.fill(action.selector || '', action.value || '');
          results.push({ success: true, data: `Typed in: ${action.selector}`, duration: Date.now() - start });
          break;

        case 'screenshot': {
          const screenshotBuffer = await page.screenshot({ fullPage: true });
          const base64 = screenshotBuffer.toString('base64');
          results.push({ success: true, screenshot: base64, data: 'Screenshot captured', duration: Date.now() - start });
          break;
        }

        case 'extract': {
          const extracted = await page.evaluate((sel: string) => {
            if (!sel || sel === 'body') return document.body.innerText;
            const elements = Array.from(document.querySelectorAll(sel));
            return elements.map(el => (el as HTMLElement).innerText).join('\n');
          }, action.selector || 'body');
          results.push({ success: true, data: extracted, duration: Date.now() - start });
          break;
        }

        case 'evaluate': {
          const evalResult = await page.evaluate(action.script || '');
          results.push({ success: true, data: evalResult, duration: Date.now() - start });
          break;
        }

        case 'wait':
          await page.waitForSelector(action.selector || '', { timeout: action.timeout || 10000 });
          results.push({ success: true, data: `Element found: ${action.selector}`, duration: Date.now() - start });
          break;

        case 'scroll':
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1000);
          results.push({ success: true, data: 'Scrolled to bottom', duration: Date.now() - start });
          break;

        case 'select':
          await page.selectOption(action.selector || '', action.value || '');
          results.push({ success: true, data: `Selected: ${action.value}`, duration: Date.now() - start });
          break;

        case 'submit':
          await page.click(action.selector || 'button[type="submit"]');
          await page.waitForLoadState('domcontentloaded');
          results.push({ success: true, data: 'Form submitted', duration: Date.now() - start });
          break;

        default:
          results.push({ success: false, error: `Acción desconocida: ${action.action}`, duration: Date.now() - start });
      }
    } catch (error: any) {
      results.push({ success: false, error: error.message, duration: Date.now() - start });
    }
  }

  await context.close();
  return results;
}

export async function scrapeUrl(url: string, selector?: string): Promise<string> {
  const results = await executeBrowserTask([
    { action: 'navigate', url },
    { action: 'extract', selector: selector || 'body' },
  ]);
  return results[1]?.data || '';
}

export async function scrapeMultipleUrls(urls: string[], selector?: string): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const url of urls) {
    try {
      results[url] = await scrapeUrl(url, selector);
    } catch {
      results[url] = '';
    }
  }
  return results;
}

export async function monitorPrice(url: string, priceSelector: string): Promise<string> {
  const results = await executeBrowserTask([
    { action: 'navigate', url },
    { action: 'extract', selector: priceSelector },
  ]);
  return results[1]?.data || 'Precio no encontrado';
}

export async function takeScreenshot(url: string): Promise<string> {
  const results = await executeBrowserTask([
    { action: 'navigate', url },
    { action: 'screenshot' },
  ]);
  return results[1]?.screenshot || '';
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
