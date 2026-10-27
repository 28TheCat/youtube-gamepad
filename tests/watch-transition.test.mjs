import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';
function fixture() {
  const children = new Set(), frames = new Map(), callbacks = new Map(), listeners = new Map();
  let sequence = 0, playerId = 'old', time = 0;
  const location = { pathname: '/watch', search: '?v=old', origin: 'https://www.youtube.com' };
  const media = { readyState: 2, videoWidth: 640, videoHeight: 360, paused: false,
    requestVideoFrameCallback(fn) { const id = ++sequence; callbacks.set(id, fn); return id; },
    cancelVideoFrameCallback(id) { callbacks.delete(id); } };
  const document = { documentElement: { append(node) { children.add(node); } },
    querySelector: selector => selector.includes('ad-showing') ? null : media,
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
    createElement(tag) { return { tag, hidden: false, children: [], setAttribute() {},
      append(...items) { this.children.push(...items); }, remove() { children.delete(this); },
      getContext() { return { drawImage() {} }; } }; } };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/ui/watch-transition.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const framesModule = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/playback/media-frame.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: framesModule });
  vm.runInNewContext(source, { exports, require(name) { assert.equal(name, '../playback/media-frame'); return framesModule; }, document, location, URL, URLSearchParams, Date: { now: () => time },
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); } });
  const transition = exports.createWatchTransition(() => playerId);
  return { transition, children, callbacks, frames, media, location, listeners,
    id(value) { playerId = value; }, tick() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    expire() { time = 9000; }, playing() { listeners.get('playing')?.({ target: media }); } };
}
test('watch transition holds outgoing frame and reveals only when destination presents a frame', () => {
  const f = fixture();
  f.transition.sync(true, '/watch?v=old', false);
  f.transition.sync(true, '/watch?v=new', true);
  const host = [...f.children][0];
  assert.equal(host.children[1].hidden, false, 'last frame captured');
  f.location.search = '?v=new'; f.tick();
  assert.equal(f.callbacks.size, 0, 'old player identity cannot reveal the mask');
  f.id('new'); f.tick();
  assert.equal(f.children.size, 1, 'decoded media waits for presentation');
  [...f.callbacks.values()][0]();
  assert.equal(f.children.size, 0);
  f.transition.sync(true, '/watch?v=new', true);
  assert.equal(f.children.size, 0, 'same navigation does not cover playback again');
  f.transition.destroy();
});
test('playing releases the cover even when the identity bridge is unavailable', () => {
  const f = fixture(); f.location.search = '?v=new'; f.media.readyState = 0;
  f.transition.sync(true, '/watch?v=new', true);
  f.id(undefined); f.media.readyState = 2; f.playing();
  assert.equal(f.children.size, 0);
  f.transition.destroy(); assert.equal(f.listeners.size, 0); assert.equal(f.frames.size, 0);
});
test('late frame callbacks cannot reveal a newer navigation and failure always releases the cover', () => {
  const f = fixture(); f.location.search = '?v=first'; f.id('first');
  f.transition.sync(true, '/watch?v=first', true);
  const stale = [...f.callbacks.values()][0];
  f.transition.sync(true, '/watch?v=second', true); stale();
  assert.equal(f.children.size, 1);
  f.transition.sync(true, '/watch?v=second', true, true);
  assert.equal(f.children.size, 0); assert.equal(f.frames.size, 0);
  f.transition.destroy();
});
test('timeout and leaving custom playback cannot leave an opaque cover', () => {
  for (const reason of ['timeout', 'disabled', 'browse']) {
    const f = fixture(); f.transition.sync(true, '/watch?v=new', true);
    if (reason === 'timeout') { f.expire(); f.tick(); }
    else f.transition.sync(reason !== 'disabled', reason === 'browse' ? '/' : '/watch?v=new', true);
    assert.equal(f.children.size, 0, reason); f.transition.destroy();
  }
});
