import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browserPage } from './helpers/bundles.mjs';

const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  plugins: [vue({ template: { compilerOptions: { hoistStatic: false } } })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('../src/ui/vue-watch-view.ts', import.meta.url)),
    formats: ['iife'], name: 'PlaybackViewFixture' } }
});
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
const styles = readFileSync(new URL('../src/ui/watch.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8');
for (const trustedTypes of [false, true]) {
  test(`Vue playback drag preserves snapshot preview and native video (Trusted Types: ${trustedTypes})`, { timeout: 30000 }, async t => {
    const page = await browserPage(t);
    await page.route('https://www.youtube.com/**', route => route.fulfill({
      contentType: 'text/html', body: `<html><head><style>${theme}</style></head><body><video id="native-video"></video></body></html>`,
      headers: trustedTypes ? { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" } : {}
    }));
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await page.evaluate(code);
    await page.evaluate(styles => {
      window.nativeVideo = document.querySelector('video');
      window.commands = []; window.seeks = [];
      window.view = PlaybackViewFixture.createVueWatchView({
        activate: action => window.commands.push(action), seek: seconds => { window.seeks.push(seconds); return true; }, closePanel() {},
        styles: { watch: styles }, controllerStyle: {
          badge(node, value) { node.textContent = value; return node; },
          hint(node, value) { node.textContent = value; return node; },
          bind(node, value, attribute) { node.setAttribute(attribute, value); }
        }
      });
      window.setSnapshot = (currentTime, live = false) => window.view.presentation.playback({
        video: { paused: true, currentTime, duration: live ? Infinity : 100, volume: .4, muted: false,
          timeline: { isLive: live, canSeek: true, start: live ? 100 : 0, end: live ? 200 : 100,
            ranges: [{ start: live ? 100 : 0, end: live ? 200 : 100 }], atLiveEdge: false } },
        captionsEnabled: true, settingsOpen: false
      });
      window.view.host.hidden = false; window.view.presentation.visible(true); window.setSnapshot(20);
    }, styles);
    const host = page.locator('#ytg-watch'), slider = host.getByRole('slider');
    await host.getByRole('button', { name: 'Play', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.commands), ['playPause']);
    await host.getByRole('button', { name: 'Volume up', exact: true }).click();
    assert.equal(await host.locator('[data-view="volume"]').textContent(), '40%');
    const bounds = await slider.boundingBox();
    assert.ok(bounds?.width > 0);
    await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.evaluate(() => window.setSnapshot(25));
    assert.ok(Math.abs(Number(await slider.getAttribute('aria-valuenow')) - 70) < .01);
    assert.equal(await page.evaluate(() => window.seeks.length), 0);
    await page.mouse.up();
    await page.waitForFunction(() => window.seeks.length === 1);
    assert.equal(Math.round(await page.evaluate(() => window.seeks[0])), 70);
    await page.evaluate(() => window.setSnapshot(150, true));
    assert.equal(await slider.getAttribute('aria-valuemin'), '100');
    assert.equal(await slider.getAttribute('aria-valuemax'), '200');
    assert.equal(await page.evaluate(() => document.querySelector('video') === window.nativeVideo), true);
    await page.evaluate(() => window.view.presentation.destroy());
    assert.equal(await page.evaluate(() => document.querySelector('video') === window.nativeVideo), true);
  });
}
