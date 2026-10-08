import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
const bundle = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('../src/playback/playback-model.ts', import.meta.url)),
    formats: ['iife'], name: 'PlaybackModelFixture' } }
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(item => item.type === 'chunk').code;
const context = {};
runInNewContext(code, context);
const createModel = context.PlaybackModelFixture.createPlaybackModel;
function snapshot(currentTime = 20, timeline = { start: 0, end: 100, ranges: [{ start: 0, end: 100 }], canSeek: true, isLive: false, atLiveEdge: false }) {
  return { video: { currentTime, duration: timeline.isLive ? Infinity : 100, paused: false, volume: .4, muted: false, timeline }, captionsEnabled: true, settingsOpen: false };
}
test('player updates preserve drag preview and confirmation sends exactly one seek', async () => {
  const seeks = [];
  const model = createModel({ activate() {}, seek: value => { seeks.push(value); return true; } });
  model.update(snapshot());
  model.previewAt(70);
  model.update(snapshot(25));
  assert.equal(model.state.value.currentTime, 70);
  assert.equal(seeks.length, 0);
  await model.confirmSeek();
  assert.deepEqual(seeks, [70]);
  model.update(snapshot(70));
  assert.equal(model.state.value.currentTime, 70);
  assert.equal(model.preview.value, null);
});
test('live timeline uses seekable bounds, gaps and sliding replay windows', async () => {
  const seeks = [];
  const model = createModel({ activate() {}, seek: value => { seeks.push(value); return true; } });
  const timeline = { start: 100, end: 200, ranges: [{ start: 100, end: 140 }, { start: 170, end: 200 }], canSeek: true, isLive: true, atLiveEdge: true };
  model.update(snapshot(199, timeline)); model.previewAt(150);
  assert.equal(model.state.value.currentTime, 140);
  assert.equal(model.state.value.atLiveEdge, false);
  model.previewAt(50); assert.equal(model.state.value.currentTime, 100);
  model.update(snapshot(199, { ...timeline, start: 120, ranges: [{ start: 120, end: 200 }] }));
  assert.equal(model.state.value.currentTime, 120);
  await model.confirmSeek(); assert.deepEqual(seeks, [120]);
});
test('unseekable playback cancels previews without issuing seek', async () => {
  let calls = 0;
  const model = createModel({ activate() {}, seek() { calls++; return true; } });
  model.update(snapshot()); model.previewAt(60);
  model.update(snapshot(25, { start: 0, end: 0, ranges: [], canSeek: false, isLive: true, atLiveEdge: false }));
  assert.equal(await model.confirmSeek(), false);
  assert.equal(model.preview.value, null); assert.equal(calls, 0);
});
test('failed seek is reported and stale completion cannot affect a new route', async () => {
  let complete;
  const model = createModel({ activate() {}, seek: () => new Promise(resolve => { complete = resolve; }) });
  model.update(snapshot()); model.previewAt(60);
  const pending = model.confirmSeek();
  model.reset(); model.update(snapshot(5)); model.previewAt(30);
  complete(false); assert.equal(await pending, false);
  assert.equal(model.state.value.currentTime, 30); assert.equal(model.error.value, '');
  model.cancelPreview();
  const failed = createModel({ activate() {}, seek: () => Promise.reject(new Error('unavailable')) });
  failed.update(snapshot()); failed.previewAt(60);
  assert.equal(await failed.confirmSeek(), false); assert.equal(failed.error.value, 'Unable to seek');
});
test('hidden or destroyed controls cancel drafts and volume intentions use the business interface', () => {
  const actions = [];
  const model = createModel({ activate: action => actions.push(action), seek: () => true });
  model.update(snapshot()); model.visible(true); model.previewAt(60);
  model.request('volumeUp'); model.request('mute');
  assert.deepEqual(actions, ['volumeUp', 'mute']);
  assert.equal(model.state.value.volume, .4); assert.equal(model.state.value.captionsEnabled, true);
  model.visible(false); assert.equal(model.preview.value, null);
  model.destroy(); model.request('playPause');
  assert.equal(actions.length, 2);
});
