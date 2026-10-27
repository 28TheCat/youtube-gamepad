import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { normalizePlaybackParameters } = await importSettingsModel('src/shared/playback-settings.ts');

test('playback settings preserve existing defaults and bound stored or untrusted values', () => {
  assert.deepEqual(normalizePlaybackParameters({}), { seekStep: 10, shortsSeekStep: 5, volumeStep: 5 });
  assert.deepEqual(normalizePlaybackParameters({ seekStep: 0, shortsSeekStep: 999, volumeStep: 27 }), { seekStep: 1, shortsSeekStep: 120, volumeStep: 25 });
  assert.deepEqual(normalizePlaybackParameters({ seekStep: NaN, shortsSeekStep: '20', volumeStep: Infinity }), { seekStep: 10, shortsSeekStep: 5, volumeStep: 5 });
  assert.deepEqual(normalizePlaybackParameters({ seekStep: 12.6, shortsSeekStep: 8.2, volumeStep: 3.7 }), { seekStep: 13, shortsSeekStep: 8, volumeStep: 4 });
});
