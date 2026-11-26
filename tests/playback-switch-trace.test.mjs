import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { moduleSource } from '../scripts/test-source.mjs';

function setup() {
  let now = 0, player = 'private-old', frame;
  const listeners = new Map();
  const video = {
    requestVideoFrameCallback(callback) { frame = callback; return 1; },
    cancelVideoFrameCallback() { frame = undefined; }
  };
  const location = { pathname: '/watch', search: '?v=private-old' };
  const document = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    querySelector() { return video; }
  };
  let poll, timeout;
  const context = { URL, URLSearchParams, location, document, performance: { now: () => now },
    setInterval(callback) { poll = callback; return 1; }, clearInterval() { poll = undefined; },
    setTimeout(callback) { timeout = callback; return 2; }, clearTimeout() { timeout = undefined; } };
  runInNewContext(moduleSource('src/shared/watch-link.ts') + moduleSource('src/diagnostics/playback-switch-trace.ts'), context);
  const trace = context.createPlaybackSwitchTrace({ readPlayerVideoId: () => player });
  return { trace, location, video, tick(ms = 250) { now += ms; poll?.(); },
    player(value) { player = value; }, frame() { frame?.(); }, timeout() { timeout?.(); }, listeners };
}

test('records route, old player, target player and a later frame without exposing video IDs', () => {
  const env = setup();
  env.trace.start('/watch?v=private-next');
  env.location.search = '?v=private-next';
  env.tick();
  let report = env.trace.snapshot()[0];
  assert.equal(report.status, 'observing');
  assert.equal(report.milestones.addressTarget, true);
  assert.equal(report.milestones.playerTarget, false);
  assert.ok(report.steps.some(step => step.event === 'player' && step.identity === 'previous'));
  env.player('private-next');
  env.tick();
  env.frame();
  report = env.trace.snapshot()[0];
  assert.equal(report.status, 'frame-observed');
  assert.equal(report.milestones.frameAfterTargetPlayer, true);
  assert.equal(report.steps.find(step => step.event === 'frame-after-target-player').elapsedMs, 500);
  assert.doesNotMatch(JSON.stringify(report), /private-/);
  assert.equal(env.listeners.size, 0);
});

test('timeout, superseding and clearing stop observations and preserve missing milestones', () => {
  const env = setup();
  env.trace.start('/watch?v=private-next');
  env.location.search = '?v=private-next';
  env.tick();
  env.timeout();
  assert.equal(env.trace.snapshot()[0].status, 'observation-timeout');
  assert.equal(env.trace.snapshot()[0].milestones.playerTarget, false);
  env.trace.start('/watch?v=private-third');
  env.trace.start('/watch?v=private-fourth');
  assert.equal(env.trace.snapshot()[1].status, 'superseded');
  env.trace.clear();
  assert.equal(env.trace.snapshot().length, 0);
  assert.equal(env.listeners.size, 0);
});

test('reports unsupported frame observation and never credits an old player frame', () => {
  const env = setup();
  delete env.video.requestVideoFrameCallback;
  env.trace.start('/watch?v=private-next');
  env.location.search = '?v=private-next';
  env.tick();
  env.player('private-next');
  env.tick();
  env.timeout();
  const report = env.trace.snapshot()[0];
  assert.equal(report.frameObservation, 'unsupported');
  assert.equal(report.milestones.playerTarget, true);
  assert.equal(report.milestones.frameAfterTargetPlayer, false);
});
