import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import { browserPage } from './helpers/bundles.mjs';

const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  plugins: [vue({ template: { compilerOptions: { hoistStatic: false } } })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('./helpers/watch-surface-fixture.ts', import.meta.url)),
    formats: ['iife'], name: 'WatchSurfaceFixture' } }
});
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
const styles = readFileSync(new URL('../src/ui/watch.css', import.meta.url), 'utf8');

for (const layout of ['windowed', 'fullscreen']) for (const dark of [false, true]) {
  test(`long descriptions stay readable with a visible close button (${layout}, ${dark ? 'dark' : 'light'})`, async t => {
    const page = await browserPage(t);
    await page.setViewportSize({ width: 767, height: 610 });
    await page.setContent(`<html class="ytg-watch-layout" data-ytg-playback-layout="${layout}"${dark ? ' dark' : ''}><body></body></html>`);
    for (const file of ['src/ui/theme.css', 'src/app/theater.css'])
      await page.addStyleTag({ content: readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') });
    await page.evaluate(code);
    await page.evaluate(styles => {
      const api = WatchSurfaceFixture, state = { panel: '', panelIndex: 0 };
      const controllerStyle = { badge() {}, hint() {}, bind(node, text, attribute) {
        if (attribute) node.setAttribute(attribute, text); else node.textContent = text;
      } };
      const view = api.createVueWatchView({ activate() {}, closePanel: () => window.descriptionPanels.close(), controllerStyle, styles: { watch: styles } });
      view.host.hidden = false;
      window.descriptionPanels = api.YTGamepadWatchPanels.create({ ...view, controllerStyle,
        watchState: () => state, send(event) { if (event.type === 'WATCH_PANEL') state.panel = event.panel; },
        focus() { view.close.focus({ preventScroll: true }); }, controller: {},
        descriptionText: '视频简介\n这是一段需要清晰阅读的中文简介。\n\n'.repeat(80)
      });
      window.descriptionPanels.open('description');
    }, styles);
    const dialog = page.locator('#ytg-watch .description-panel'), sheet = dialog.locator('.sheet');
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await close.waitFor();
    const contrast = await dialog.locator('.description').evaluate(node => {
      const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = color => rgb(color).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const text = luminance(getComputedStyle(node).color), background = luminance(getComputedStyle(node.closest('.sheet')).backgroundColor);
      return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
    });
    assert.ok(contrast >= 4.5, `description text contrast ${contrast} meets readable text contrast`);
    await sheet.evaluate(node => { node.scrollTop = node.scrollHeight; });
    assert.ok(await sheet.evaluate(node => node.scrollTop > 100));
    const buttonBounds = await close.boundingBox(), sheetBounds = await sheet.boundingBox();
    assert.ok(buttonBounds.y >= sheetBounds.y && buttonBounds.y + buttonBounds.height <= sheetBounds.y + sheetBounds.height,
      'close remains inside the visible sheet after scrolling to the end');
    mkdirSync(new URL('../output/playwright/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL(`../output/playwright/description-${layout}-${dark ? 'dark' : 'light'}.png`, import.meta.url)) });
    await close.click();
    await dialog.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.descriptionPanels.open('description'));
    assert.equal(await sheet.evaluate(node => node.scrollTop), 0, 'reopening starts at the description heading');
  });
}

test('watch surface exposes data and restores recommendation identity after reorder', async t => {
  const page = await browserPage(t);
  await page.goto('about:blank');
  await page.evaluate(code);
  await page.evaluate(styles => {
    const api = WatchSurfaceFixture, scope = api.YTGamepadRuntime.scope('surface-test');
    const state = { row: 'controls', index: 4, controlIndex: 4, recommendationIndex: 0, adjusting: false, panel: '', panelIndex: 0, playIndex: 4 };
    const controller = { state: { enabled: true }, readRoute: () => ({ key: '/watch?v=test', isWatch: true }),
      readComments: () => [{ key: 'comment-a', author: 'Author', text: window.longComments || '<b>text</b>', hasReplies: false, repliesLabel: '', replies: [] }],
      readWatchFeatures: () => ({}), request() { return true; }
    };
    const style = { register: () => () => {}, badge(node, value) { node.textContent = value; return node; },
      hint(node, value) { node.textContent = value; return node; }, bind(node, value, attribute) { node.setAttribute(attribute, value); } };
    window.surface = api.createWatchSurface({ controllerStyle: style,
      createView: port => api.createVueWatchView({ ...port, styles: { watch: styles } }),
      createPanels: port => api.YTGamepadWatchPanels.create(port)
    }, { state: () => state, controller: () => controller, activate() {}, seek: () => true, activity() {}, input() {}, focus() {},
      send(event) {
        if (event.type === 'WATCH_PANEL') state.panel = event.panel;
        if (event.type === 'WATCH_FOCUS') { if (event.region === 'panel') state.panelIndex = event.index; else { state.row = event.region; state.index = event.index; } }
        return { effects: [], disposition: 'handled' };
      }
    }, scope);
    surface.sync(true, 'controls');
    window.setPlayback = canSeek => surface.playback({ video: { paused: true, currentTime: 20, duration: 100, volume: .5, muted: false,
      timeline: { canSeek, isLive: false, atLiveEdge: false, start: 0, end: 100, ranges: canSeek ? [{ start: 0, end: 100 }] : [] } }, captionsEnabled: false, settingsOpen: false });
    window.setPage = keys => surface.page({ key: '/watch?v=test', isWatch: true, title: 'Title', channel: 'Channel', description: window.longDescription || 'Description',
      recommendations: keys.map(key => ({ key, label: key, channel: 'Channel', thumbnail: '', thumbnailFallback: '' })) }, {});
    window.disposeSurface = () => { surface.destroy(); scope.destroy(); };
    setPlayback(false); setPage(['b', 'a']); window.originalTarget = surface.snapshot().recommendations[0];
  }, styles);
  const initial = await page.evaluate(() => surface.snapshot());
  assert.equal(initial.canSeek, false);
  assert.equal(initial.controls.find(target => target.id === 'seekForward').available, false);
  assert.equal(initial.controls.find(target => target.id === 'goLive').available, false);
  assert.deepEqual(Object.keys(initial.recommendations[0]).sort(), ['available', 'id', 'index', 'itemKey', 'region']);
  await page.evaluate(() => { setPlayback(true); setPage(['a', 'b']); surface.focus(originalTarget, false, 'controls'); });
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement.dataset.videoId), 'b');
  assert.equal(await page.locator('#ytg-watch .card.selected').getAttribute('data-video-id'), 'b');
  assert.equal(await page.evaluate(() => surface.snapshot().canSeek), true);
  await page.evaluate(() => { setPage(['b', 'a', 'b']); surface.focus(surface.snapshot().recommendations[2], false, 'controls'); });
  assert.equal(await page.locator('#ytg-watch .card.selected').count(), 1, 'duplicate videos have separate focus identities');
  assert.equal(await page.locator('#ytg-watch .card.selected').getAttribute('data-focus-id'), 'recommendation:b:1');
  await page.evaluate(() => {
    setPage(Array.from({ length: 24 }, (_, index) => 'video-' + index));
    surface.focus(surface.snapshot().recommendations[20], false, 'controls');
  });
  const grid = await page.locator('#ytg-watch .recommendations').evaluate(node => {
    const cards = [...node.querySelectorAll('.card')];
    return { visible: cards.filter(card => !card.hidden).length,
      firstRow: cards[0].offsetTop, secondRow: cards[4].offsetTop,
      scrollTop: node.scrollTop, horizontalOverflow: node.scrollWidth > node.clientWidth };
  });
  assert.equal(grid.visible, 24, 'recommendations keep all rows rendered');
  assert.ok(grid.secondRow > grid.firstRow, 'recommendations form rows below one another');
  assert.ok(grid.scrollTop > 0, 'focusing a lower row scrolls the recommendation grid vertically');
  assert.equal(grid.horizontalOverflow, false);
  assert.equal(await page.locator('#ytg-watch .card.selected').getAttribute('data-video-id'), 'video-20');
  await page.evaluate(() => surface.panel.open('comments'));
  assert.equal(await page.evaluate(() => WatchSurfaceFixture.ui.state.openPanels.includes('comments')), true);
  const targets = await page.evaluate(() => surface.snapshot().panel);
  const comment = targets.find(target => target.id === 'comment:comment-a');
  assert.ok(comment, 'comment focus uses a stable identity');
  await page.evaluate(target => surface.focus(target, false, 'controls'), comment);
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement.dataset.focusId), 'comment:comment-a');
  assert.equal(await page.locator('#ytg-watch .comment-body').textContent(), '<b>text</b>');
  await page.evaluate(() => {
    surface.panel.close(); window.longDescription = 'Long description\n'.repeat(200); setPage(['a', 'b']); surface.panel.open('description');
  });
  const sheet = page.locator('#ytg-watch .sheet');
  await sheet.waitFor();
  await page.evaluate(() => { window.scrollFocus = document.querySelector('#ytg-watch').shadowRoot.activeElement; surface.scroll(180); });
  assert.ok(await sheet.evaluate(node => node.scrollTop > 100), 'the description scrolls even while the close button owns focus');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement === window.scrollFocus), true);
  await page.evaluate(() => { surface.scroll(0); surface.panel.close(); window.longComments = 'Long comment\n'.repeat(200); surface.panel.open('comments'); });
  await page.locator('#ytg-watch .comment-body').waitFor();
  await page.evaluate(() => surface.scroll(200));
  assert.ok(await sheet.evaluate(node => node.scrollTop > 100), 'comment text scrolls independently of recommendation cards');
  assert.equal(await page.locator('#ytg-watch .recommendations').evaluate(node => node.scrollTop), 0);
  await page.evaluate(() => { disposeSurface(); surface.page({ isWatch: true, recommendations: [] }, {}); surface.feedback({ label: 'late completion' }); });
  assert.equal(await page.locator('#ytg-watch').count(), 0);
  assert.equal(await page.evaluate(() => WatchSurfaceFixture.ui.openPanel('comments')), false);
});
