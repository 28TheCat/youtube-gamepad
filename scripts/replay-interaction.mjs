import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { moduleSource } from './test-source.mjs';

const window = {};
runInNewContext(moduleSource('src/app/state-machine.ts'), { window });
const { transition } = window.YTGamepadStateMachine;
const json = value => JSON.parse(JSON.stringify(value));

export function assertInteractionReplay(replay) {
  assert.equal(replay?.version, 1, 'Unsupported or missing interactionReplay');
  assert.ok(replay.steps.length, 'Interaction replay is empty');
  let state = replay.initial;
  for (const [index, step] of replay.steps.entries()) {
    const label = 'Step ' + (index + 1) + ' (' + step.event.type + ')';
    const result = transition(state, step.event);
    const changes = Object.fromEntries(['app', 'watch', 'menu']
      .filter(slice => result.nextState[slice] !== state[slice])
      .map(slice => [slice, result.nextState[slice]]));
    assert.equal(result.disposition, step.disposition, label + ' disposition');
    assert.deepEqual(json(result.effects), step.effects, label + ' effects');
    assert.deepEqual(json(changes), step.changes, label + ' state changes');
    state = result.nextState;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/replay-interaction.mjs <diagnostics.json>');
  const { interactionReplay } = JSON.parse(readFileSync(file, 'utf8'));
  assertInteractionReplay(interactionReplay);
  console.log('Replayed ' + interactionReplay.steps.length + ' interaction events.');
}
