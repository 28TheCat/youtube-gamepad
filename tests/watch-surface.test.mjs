import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
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

test('watch surface exposes data and restores recommendation identity after reorder', async t => {
  const page = await browserPage(t);
  await page.goto('about:blank');
  await page.evaluate(code);
  await page.evaluate(styles => {
    const api = WatchSurfaceFixture, scope = api.YTGamepadRuntime.scope('surface-test');
    const state = { row: 'controls', index: 4, controlIndex: 4, recommendationIndex: 0, adjusting: false, panel: '', panelIndex: 0, playIndex: 4 };
    const controller = { state: { enabled: true }, readRoute: () => ({ key: '/watch?v=test', isWatch: true }),
      readComments: () => [{ key: 'comment-a', author: 'Author', text: '<b>text</b>', hasReplies: false, repliesLabel: '', expanded: [] }],
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
    window.setPage = keys => surface.page({ key: '/watch?v=test', isWatch: true, title: 'Title', channel: 'Channel', description: 'Description',
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
  await page.evaluate(() => { disposeSurface(); surface.page({ isWatch: true, recommendations: [] }, {}); surface.feedback({ label: 'late completion' }); });
  assert.equal(await page.locator('#ytg-watch').count(), 0);
  assert.equal(await page.evaluate(() => WatchSurfaceFixture.ui.openPanel('comments')), false);
});
