import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { captureMediaFrame, createMediaFrameReadiness } = await importSettingsModel('src/playback/media-frame.ts');
function media() {
  const callbacks = new Map(), cancelled = [];
  let sequence = 0;
  return { readyState: 2, videoWidth: 640, videoHeight: 360, paused: false, callbacks, cancelled,
    requestVideoFrameCallback(fn) { const id = ++sequence; callbacks.set(id, fn); return id; },
    cancelVideoFrameCallback(id) { cancelled.push(id); callbacks.delete(id); } };
}
test('capture keeps dimensions and handles unavailable or protected media', () => {
  const video = media(), draws = [];
  const canvas = { getContext: () => ({ drawImage: (...args) => draws.push(args) }) };
  assert.equal(captureMediaFrame(canvas, video), true);
  assert.equal(canvas.width, 640); assert.equal(canvas.height, 360);
  assert.deepEqual(draws, [[video, 0, 0]]);
  video.readyState = 1; assert.equal(captureMediaFrame(canvas, video), false);
  video.readyState = 2; canvas.getContext = () => null;
  assert.equal(captureMediaFrame(canvas, video), false);
  canvas.getContext = () => ({ drawImage() { throw Error('protected'); } });
  assert.equal(captureMediaFrame(canvas, video), false);
});
test('presentation requests are shared until the frame arrives', () => {
  const gate = createMediaFrameReadiness(), video = media(); let presented = 0;
  assert.equal(gate.ready(video, 'one', () => presented++), false);
  assert.equal(gate.ready(video, 'one', () => presented++), false);
  assert.equal(video.callbacks.size, 1);
  [...video.callbacks.values()][0]();
  assert.equal(presented, 1);
  assert.equal(gate.ready(video, 'one', () => presented++), true);
});
test('route changes, replacement media and disposal invalidate late presentations', () => {
  for (const change of ['route', 'media', 'reset']) {
    const gate = createMediaFrameReadiness(), video = media(); let presented = 0;
    gate.ready(video, 'one', () => presented++);
    const stale = [...video.callbacks.values()][0];
    if (change === 'reset') gate.reset();
    else gate.ready(change === 'media' ? media() : video, 'two', () => presented++);
    stale(); assert.equal(presented, 0, change); assert.deepEqual(video.cancelled, [1]);
    gate.reset();
  }
});
test('decoded paused media and browsers without frame callbacks use the readiness fallback', () => {
  const gate = createMediaFrameReadiness(), video = media();
  video.paused = true; assert.equal(gate.ready(video, 'one', () => {}), true);
  video.paused = false; video.requestVideoFrameCallback = undefined;
  assert.equal(gate.ready(video, 'two', () => {}), true);
  video.readyState = 1; assert.equal(gate.ready(video, 'two', () => {}), false);
});
