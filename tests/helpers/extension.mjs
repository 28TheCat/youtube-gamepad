import { chromium } from 'playwright';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export const extensionRoot = process.env.YTG_EXTENSION_ROOT === 'latest-release'
  ? JSON.parse(readFileSync(resolve(repository, 'output/releases/latest.json'), 'utf8')).directory
  : resolve(process.env.YTG_EXTENSION_ROOT || repository);

export async function launchExtension(t) {
  const output = resolve(repository, 'output/playwright');
  mkdirSync(output, { recursive: true });
  const profile = mkdtempSync(resolve(output, 'extension-profile-'));
  // Branded Chrome/Edge no longer support command-line extension side-loading.
  // Use bundled Chromium; branded-browser/hardware acceptance is a separate gate.
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`]
  });
  t.after(async () => {
    await context.close();
    if (!profile.startsWith(output + '/') && !profile.startsWith(output + '\\')) throw new Error('Unsafe profile cleanup');
    rmSync(profile, { recursive: true, force: true });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.locator('fieldset').waitFor({ state: 'visible' });
  await options.waitForFunction(() => !document.querySelector('fieldset').disabled);
  return { context, worker, id, options };
}

export const fixture = `<!doctype html><html><head><style>
body{padding:24px}ytd-rich-item-renderer{display:inline-block;margin:12px}
a,button,input{display:inline-block;padding:24px}
</style></head><body><ytd-masthead><input id="search"><button id="search-icon-legacy">Search</button></ytd-masthead>
<ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=a">A</a></ytd-rich-item-renderer>
<ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=b">B</a></ytd-rich-item-renderer>
</body></html>`;

export async function ready(page) {
  await page.waitForFunction(() => !!window.YTGamepadCoordinator && !!window.YTGamepadInput);
}

// Replace only the physical input source, in BOTH actual manifest worlds.
// No extension scripts, chrome APIs, messages or background logic are mocked.
export async function virtualPad(context, page) {
  const cdp = await context.newCDPSession(page);
  const worlds = new Map();
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.set(context.id, context));
  cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => worlds.delete(executionContextId));
  await cdp.send('Runtime.enable');
  const main = [...worlds.values()].find(world => world.auxData?.isDefault);
  let isolated;
  for (const world of worlds.values()) {
    if (world.id === main?.id) continue;
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id,
      expression: 'typeof chrome !== "undefined" && !!chrome.runtime?.id && !!window.YTGamepadRuntime' });
    if (result.result.value) { isolated = world; break; }
  }
  if (!main || !isolated) throw new Error('Manifest MAIN and ISOLATED worlds were not both loaded');
  for (const world of [main, isolated]) {
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression: `
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
        const state = JSON.parse(document.documentElement.getAttribute('data-test-pad') || '{}');
        return state.connected ? [{ connected:true, mapping:'standard', index:0, axes:[state.x || 0,0],
          buttons:Array.from({length:17},(_,i)=>({pressed:state.button===i,value:state.button===i?1:0})) }] : [];
      } });` });
    if (result.exceptionDetails) throw new Error('Failed to install virtual input');
  }
  return state => page.evaluate(state => document.documentElement.setAttribute('data-test-pad', JSON.stringify(state)), state);
}
