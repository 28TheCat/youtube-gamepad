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

test('collection tabs expose only their visible playable entries to controller focus', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.evaluate(code);
  await page.evaluate(styles => {
    const api = WatchSurfaceFixture, scope = api.YTGamepadRuntime.scope('collection-focus');
    const state = { row: 'recommendations', index: 0, panel: '', adjusting: false };
    const controllerStyle = { register: () => () => {}, badge() {}, hint() {}, bind() {} };
    window.surface = api.createWatchSurface({ controllerStyle,
      createView: port => api.createVueWatchView({ ...port, styles: { watch: styles } }),
      createPanels: port => api.YTGamepadWatchPanels.create(port)
    }, { state: () => state, controller: () => ({ state: { enabled: true } }),
      activate() {}, seek() {}, activity() {}, input() {}, focus() {}, send() { return { effects: [] }; }
    }, scope);
    surface.sync(true, 'controls');
    const queue = [
      { key: 'first', label: 'First episode', channel: 'Creator', thumbnail: '', queue: true },
      { key: 'current', label: 'Current episode', channel: 'Creator', thumbnail: '', queue: true, selected: true },
      { key: 'last', label: 'Last episode', channel: 'Creator', thumbnail: '', queue: true }
    ];
    surface.page({ title: 'Current episode', channel: 'Creator', description: '', queue,
      recommendations: [queue[0], queue[2], { key: 'related', label: 'Related video', channel: '', thumbnail: '' }] }, {});
  }, styles);
  assert.deepEqual(await page.evaluate(() => surface.snapshot().recommendations.map(item => item.itemKey)), ['first', 'last']);
  await page.locator('#ytg-watch').getByRole('tab', { name: 'Recommendations', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => surface.snapshot().recommendations.map(item => item.itemKey)), ['related']);
  await page.evaluate(() => surface.focus(surface.snapshot().recommendations[0], false, 'controls'));
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement.dataset.videoId), 'related');
  await page.evaluate(() => surface.cycleTab(-1));
  assert.deepEqual(await page.evaluate(() => surface.snapshot().recommendations.map(item => [item.itemKey, item.index])), [['first', 0], ['last', 1]]);
  await page.evaluate(() => surface.focus(surface.snapshot().recommendations[1], false, 'controls'));
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement.dataset.videoId), 'last');
});

for (const width of [767, 1280]) test(`windowed controller controls remain reachable at ${width}px`, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width, height: 720 });
  await page.setContent('<html class="ytg-gamepad-input" data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.evaluate(code);
  await page.evaluate(styles => {
    const api = WatchSurfaceFixture, scope = api.YTGamepadRuntime.scope('controller-strip');
    const state = { row: 'controls', index: 0, panel: '', adjusting: false };
    const controllerStyle = { register: () => () => {}, badge() {}, hint(node, text) { node.textContent = text; }, bind() {} };
    window.surface = api.createWatchSurface({ controllerStyle,
      createView: port => api.createVueWatchView({ ...port, styles: { watch: styles } }),
      createPanels: port => api.YTGamepadWatchPanels.create(port)
    }, { state: () => state, controller: () => ({ state: { enabled: true } }),
      activate() {}, seek() {}, activity() {}, input() {}, focus() {}, send() { return { effects: [] }; }
    }, scope);
    surface.sync(true, 'controls');
    surface.page({ title: 'Video', channel: 'Creator', description: '', recommendations: [] }, {});
    surface.playback({ video: { paused: true, currentTime: 10, duration: 100, volume: .5, muted: false,
      timeline: { canSeek: true, start: 0, end: 100, ranges: [] } } });
  }, styles);
  const result = await page.evaluate(() => {
    const root = document.querySelector('#ytg-watch').shadowRoot, toolbar = root.querySelector('.toolbar');
    const targets = surface.snapshot().controls.filter(target => target.available);
    const visits = [...targets, ...targets.toReversed()].map(target => {
      surface.focus(target, false, 'controls');
      const node = root.activeElement, box = node.getBoundingClientRect(), strip = toolbar.getBoundingClientRect();
      return { id: node.dataset.action, expected: target.id, width: box.width, height: box.height,
        visible: box.left >= strip.left && box.right <= strip.right };
    });
    return { visits, overflow: toolbar.scrollWidth > toolbar.clientWidth,
      hintVisible: getComputedStyle(root.querySelector('.hint')).display !== 'none', pageScroll: window.scrollY };
  });
  assert.equal(result.overflow, true);
  for (const visit of result.visits) {
    assert.equal(visit.id, visit.expected);
    assert.ok(visit.width >= 48 && visit.height >= 48, visit.id + ' has a large target');
    assert.equal(visit.visible, true, visit.id + ' scrolls fully into view');
  }
  assert.equal(result.hintVisible, true);
  assert.equal(result.pageScroll, 0);
  const appearances = await page.evaluate(() => {
    const root = document.querySelector('#ytg-watch').shadowRoot;
    const ids = ['fullscreen', 'like', 'dislike', 'comments', 'save', 'mute', 'captions', 'settings'];
    return ids.map(id => {
      const target = surface.snapshot().controls.find(item => item.id === id);
      surface.focus(target, false, 'controls');
      const node = root.querySelector(`[data-action="${id}"]`), style = getComputedStyle(node), icon = getComputedStyle(node.querySelector('svg'));
      return { id, width: style.width, height: style.height, radius: style.borderRadius, background: style.backgroundColor,
        color: style.color, outline: style.outlineWidth, outlineOffset: style.outlineOffset, iconWidth: icon.width, scale: style.scale };
    });
  });
  const { id: firstId, ...reference } = appearances[0];
  assert.equal(reference.width, '48px'); assert.equal(reference.height, '48px'); assert.equal(reference.radius, '12px');
  for (const { id, ...appearance } of appearances) assert.deepEqual(appearance, reference, `${id} shares the controller button appearance`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    surface.focus(surface.snapshot().controls.find(item => item.id === 'channel'), false, 'controls');
  });
  const normalAppearances = await page.evaluate(() => {
    const root = document.querySelector('#ytg-watch').shadowRoot;
    return ['fullscreen', 'like', 'dislike', 'comments', 'save', 'mute', 'captions', 'settings'].map(id => {
      const style = getComputedStyle(root.querySelector(`[data-action="${id}"]`));
      return { width: style.width, height: style.height, radius: style.borderRadius, background: style.backgroundColor, color: style.color };
    });
  });
  for (const appearance of normalAppearances) assert.deepEqual(appearance, normalAppearances[0], 'unselected controller icons share one appearance');
  await page.evaluate(() => surface.focus(surface.snapshot().controls.find(item => item.id === 'fullscreen'), false, 'controls'));
  mkdirSync('output/playwright', { recursive: true });
  await page.locator('#ytg-watch .toolbar').screenshot({ path: `output/playwright/controller-toolbar-${width}.png` });
  await page.evaluate(() => {
    const root = document.querySelector('#ytg-watch').shadowRoot;
    root.querySelectorAll('.selected').forEach(node => node.classList.remove('selected'));
    root.activeElement?.blur();
    document.documentElement.classList.remove('ytg-gamepad-input');
    document.documentElement.dataset.ytgInputMode = 'mouse';
  });
  assert.equal(await page.locator('#ytg-watch [data-action=like]').evaluate(node => getComputedStyle(node).borderRadius), '50%', 'mouse buttons retain their original appearance');
});

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
        focus() { view.close.focus({ preventScroll: true }); }, controller: { readRoute: () => ({ key: location.pathname + location.search }) },
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
  assert.equal(initial.controls.some(target => ['seekBack', 'playPause', 'seekForward'].includes(target.id)), false, 'windowed navigation omits the hidden transport controls');
  assert.equal(initial.controls.find(target => target.id === 'fullscreen').available, true);
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
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.evaluate(() => {
    surface.panel.close();
    document.documentElement.dataset.ytgInputMode = 'gamepad';
    surface.feedback({ label: 'Playing', icon: 'play' }, 'playPause');
  });
  assert.equal(await page.locator('#ytg-watch').getAttribute('data-feedback'), 'playPause');
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.toggleAttribute('dark', dark), dark);
    assert.equal(await page.locator('#ytg-watch .status svg').evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)');
  }
  await page.evaluate(() => {
    document.documentElement.dataset.ytgInputMode = 'mouse';
    surface.feedback({ label: 'Paused', icon: 'pause' }, 'playPause');
  });
  assert.equal(await page.locator('#ytg-watch').getAttribute('data-feedback'), null);
  assert.equal(await page.locator('#ytg-watch .status').textContent(), '');
  await page.evaluate(() => surface.feedback({ label: 'Volume 50%', level: 50 }, 'volumeUp'));
  assert.equal(await page.locator('#ytg-watch').getAttribute('data-feedback'), 'volumeUp');
  await page.evaluate(() => { disposeSurface(); surface.page({ isWatch: true, recommendations: [] }, {}); surface.feedback({ label: 'late completion' }); });
  assert.equal(await page.locator('#ytg-watch').count(), 0);
  assert.equal(await page.evaluate(() => WatchSurfaceFixture.ui.openPanel('comments')), false);
});
