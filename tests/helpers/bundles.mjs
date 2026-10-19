import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPageDOM } from './page-dom.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export const bundleRoot = process.env.YTG_EXTENSION_ROOT === 'latest-release'
  ? JSON.parse(readFileSync(resolve(repository, 'output/releases/latest.json'), 'utf8')).directory
  : resolve(process.env.YTG_EXTENSION_ROOT || resolve(repository, 'dist'));
export const bundleSource = file => readFileSync(resolve(bundleRoot, file), 'utf8');

export async function browserPage(t) {
  const browser = await chromium.launch({ headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    ...(process.env.YTG_BROWSER_EXECUTABLE ? { executablePath: process.env.YTG_BROWSER_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(installPageDOM);
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => { if (errors.length) throw new Error(errors.join('\n')); });
  return page;
}

// Page tests replace Chrome privileges with observable storage and message APIs.
// They load the actual bundled Vue application, not deleted DOM controllers.
export async function settingsPage(t, { pageName = 'options', stored = {}, hash = '', available = true } = {}) {
  const page = await browserPage(t);
  await page.route('https://extension.test/**', route => {
    const path = resolve(bundleRoot, '.' + new URL(route.request().url()).pathname);
    if (!path.startsWith(bundleRoot + sep)) return route.fulfill({ status: 403, body: '' });
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }[extname(path)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: readFileSync(path) });
  });
  await page.addInitScript(({ stored, available }) => {
    window.testStorage = { ...stored };
    window.testWrites = [];
    window.testMessages = [];
    window.testClosed = false;
    window.testSaveFailure = false;
    const listeners = new Set();
    window.close = () => { window.testClosed = true; };
    window.chrome = {
      runtime: { getURL: path => 'https://extension.test/' + path, getManifest: () => ({ version: '0.2.0' }) },
      tabs: { query: async () => [{ id: 3 }], sendMessage: async (id, message) => {
        window.testMessages.push({ id, ...message });
        if (!available) throw new Error('No content script');
        return { ok: true, connected: true };
      } },
      storage: {
        local: {
          get: async keys => {
            const values = keys == null ? { ...window.testStorage } : Array.isArray(keys) ? Object.fromEntries(keys.filter(key => key in window.testStorage).map(key => [key, window.testStorage[key]])) : typeof keys === 'string' ? { [keys]: window.testStorage[keys] } : { ...keys, ...window.testStorage };
            return values;
          },
          set: async values => {
            if (window.testSaveFailure) throw new Error('Storage unavailable');
            window.testWrites.push({ ...values });
            Object.assign(window.testStorage, values);
            const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
            for (const listener of listeners) listener(changes, 'local');
          },
          remove: async key => { delete window.testStorage[key]; }
        },
        onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }
      }
    };
  }, { stored, available });
  await page.goto(`https://extension.test/src/${pageName === 'popup' ? 'popup/popup' : 'settings/options'}.html${hash}`);
  await page.waitForFunction(() => !document.querySelector('#enabled').disabled);
  return page;
}
