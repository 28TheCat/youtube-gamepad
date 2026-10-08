import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { browserPage } from './helpers/bundles.mjs';

const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  plugins: [vue({ template: { compilerOptions: { hoistStatic: false } } })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('../src/ui/watch-panels.ts', import.meta.url)),
    formats: ['iife'], name: 'WatchPanelsFixture' } }
});
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;

for (const trustedTypes of [false, true]) {
  test(`Vue watch panels preserve focus, requests and cleanup (Trusted Types: ${trustedTypes})`, async t => {
    const page = await browserPage(t);
    await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html',
      body: '<html><body><video></video></body></html>',
      headers: trustedTypes ? { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" } : {} }));
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await page.evaluate(code);
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'panels'; document.body.append(host);
      const root = host.attachShadow({ mode: 'open' });
      const make = (tag, className = '') => { const node = document.createElement(tag); node.className = className; return node; };
      const dialog = make('div'), sheet = make('section'), description = make('div'), panelTitle = make('h2'), close = make('button'), surface = make('div');
      close.textContent = 'Back'; dialog.append(sheet); root.append(surface, dialog);
      window.state = { panel: '', panelIndex: 0 }; window.requests = []; window.routeKey = 'first'; window.failed = false;
      window.records = [{ key: 'one', author: 'Author', text: '<img onerror=alert(1)>', hasReplies: true, repliesLabel: 'Load replies', expanded: [] }];
      window.descriptionText = '<b>Description</b>\nSecond line';
      window.panels = WatchPanelsFixture.YTGamepadWatchPanels.create({ make, dialog, sheet, description, panelTitle, close, surface,
        watchState: () => window.state,
        send(event) { if (event.type === 'WATCH_PANEL') window.state.panel = event.panel;
          if (event.type === 'WATCH_FOCUS') window.state.panelIndex = event.index;
          if (event.type === 'WATCH_PANEL_COUNT') window.state.panelIndex = Math.min(window.state.panelIndex, event.count); },
        focus() { [close, ...window.panels.buttons][window.state.panelIndex]?.focus(); },
        controllerStyle: { hint(node, text) { node.textContent = text; return node; } },
        controller: { readRoute: () => ({ key: window.routeKey }), readComments: () => window.records,
          readWatchFeatures: () => ({ comments: window.failed ? 'failed' : 'available' }),
          request(type, value) { window.requests.push([type, value]);
            if (type === 'replies') window.records[0].expanded = ['<script>reply</script>']; return true; } },
        get descriptionText() { return window.descriptionText; }
      });
      close.addEventListener('click', () => window.panels.close());
      window.panels.open('description');
    });
    const host = page.locator('#panels');
    assert.equal(await host.locator('[data-vue-description]').textContent(), '<b>Description</b>\nSecond line');
    assert.equal(await host.locator('b').count(), 0);
    await page.evaluate(() => { window.descriptionText = 'Updated description'; window.panels.refresh(); });
    assert.equal(await host.locator('[data-vue-description]').textContent(), 'Updated description');
    await host.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await host.locator('[data-vue-description]').count(), 0);
    await page.evaluate(() => window.panels.open('comments'));
    assert.equal(await host.locator('img').count(), 0);
    await host.locator('.comment-header').click();
    assert.equal(await host.locator('.comment-header').getAttribute('aria-expanded'), 'false');
    assert.equal(await host.locator('.comment-body').isVisible(), false);
    await host.locator('.comment-header').click();
    await host.locator('.comment-replies').click();
    assert.equal(await host.locator('.comment-reply').textContent(), '↳ <script>reply</script>');
    // Prepending a native comment must preserve focus on the reply action by ID.
    await host.locator('.comment-replies').focus();
    await page.evaluate(() => { window.records.unshift({ key: 'zero', author: 'New', text: 'New comment', hasReplies: false, repliesLabel: '', expanded: [] }); window.panels.refresh(); });
    assert.equal(await page.evaluate(() => document.querySelector('#panels').shadowRoot.activeElement.dataset.focusId), 'replies:one');
    await host.getByRole('button', { name: 'Load more comments' }).click();
    assert.deepEqual(await page.evaluate(() => window.requests), [['comments', true], ['replies', 'one'], ['comments', undefined]]);
    await page.evaluate(() => { window.panels.hide(); window.routeKey = 'second'; window.records = []; window.panels.open('comments'); });
    assert.match(await host.getByRole('status').textContent(), /still loading/);
    await page.evaluate(() => { window.failed = true; window.panels.refresh(); });
    assert.match(await host.getByRole('status').textContent(), /unavailable/);
    await page.setViewportSize({ width: 390, height: 720 });
    await page.evaluate(() => { window.panels.destroy(); window.panels.refresh(); window.panels.open('comments'); window.panels.destroy(); });
    assert.equal(await host.locator('[data-vue-comments]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-comments')), false);
    assert.equal(await page.locator('video').count(), 1);
  });
}
