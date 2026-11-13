import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { moduleSource } from '../scripts/test-source.mjs';
import { assertInteractionReplay } from '../scripts/replay-interaction.mjs';

function recorder() {
  const window = {};
  const context = { window };
  runInNewContext(moduleSource('src/app/state-machine.ts') + moduleSource('src/diagnostics/interaction-trace.ts'), context);
  const machine = window.YTGamepadStateMachine;
  const trace = context.createInteractionTrace();
  let state = machine.createState();
  return { trace, send(event) {
    const result = machine.transition(state, event);
    trace.record(state, event, result);
    state = result.nextState;
  } };
}

test('a diagnostic export replays input ownership, focus, commands and navigation with private values removed', () => {
  const { trace, send } = recorder();
  const browse = '/results?search_query=private-search';
  const watch = '/watch?v=private-video';
  const owner = { type: 'INPUT_OWNER', enabled: true, navigating: false, menu: true, native: false, panel: false, help: false };
  send({ type: 'APP_INIT', route: browse });
  send({ type: 'MENU_SEARCH', selected: 0 });
  send({ type: 'MENU_COMPOSE', value: 'private-composition' });
  send({ ...owner, action: 'back' });
  send({ type: 'MENU_INPUT', action: 'back' });
  send({ type: 'MENU_CLOSE' });
  send({ type: 'PREPARE_VIDEO', id: 1, route: browse, target: watch });
  send({ ...owner, action: 'back' });
  send({ type: 'REQUEST_WAIT', id: 1 });
  send({ type: 'REQUEST_FINISH', id: 1, route: watch, evidence: 'pushState' });
  send({ type: 'ADAPTATION', route: watch, status: 'ready', reason: 'private-reason' });
  send({ type: 'WATCH_FOCUS', region: 'recommendations', index: 1 });
  send({ type: 'WATCH_INPUT', action: 'confirm', commentCount: 0, controlCount: 1, cardCount: 2, recommendationKey: 'private-item' });
  send({ type: 'PAGE_BACK', id: 2, route: watch, temporaryLayer: false });
  const serialized = JSON.stringify(trace.snapshot());
  assert.doesNotMatch(serialized, /private-/);
  const replay = JSON.parse(serialized);
  assert.ok(replay.steps.some(step => step.effects.some(effect => effect.type === 'owner' && effect.value === 'menu')));
  assert.ok(replay.steps.some(step => step.disposition === 'blocked'));
  assert.ok(replay.steps.some(step => step.effects.some(effect => effect.type === 'historyGo' && effect.value === -1)));
  assertInteractionReplay(replay);
  replay.steps.at(-1).effects.pop();
  assert.throws(() => assertInteractionReplay(replay), /PAGE_BACK.*effects/);
});

test('eviction leaves a replayable checkpoint and clearing removes the local trace', () => {
  const { trace, send } = recorder();
  for (let index = 0; index < 80; index++) send({ type: 'WATCH_FOCUS', region: 'controls', index });
  const replay = JSON.parse(JSON.stringify(trace.snapshot()));
  assert.equal(replay.steps.length, 48);
  assert.equal(replay.initial.watch.index, 31);
  assertInteractionReplay(replay);
  trace.clear();
  assert.equal(trace.snapshot(), undefined);
});

test('large input observations stay within the export size limit', () => {
  const { trace, send } = recorder();
  const availableControls = Array.from({ length: 600 }, (_, index) => index);
  for (let index = 0; index < 25; index++) {
    send({ type: 'WATCH_INPUT', action: 'right', commentCount: 0, controlCount: 600, cardCount: 0, availableControls });
  }
  const serialized = JSON.stringify(trace.snapshot());
  const replay = JSON.parse(serialized);
  assert.ok(serialized.length <= 32768);
  assert.ok(replay.steps.length < 25);
  assert.ok(replay.initial.watch.index > 4);
  assertInteractionReplay(replay);
});
