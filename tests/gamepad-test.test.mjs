import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { readGamepads, outsideDeadzone, createDeadzoneCalibration } = await importSettingsModel('src/settings/gamepad-test.ts');
const pad = (axes = [0, 0], overrides = {}) => ({ connected: true, index: 0, id: 'test', mapping: 'standard', axes,
  buttons: [{ pressed: false, touched: true, value: .3 }], ...overrides });

test('detection includes nonstandard devices and sparse slots, copies mutable readings and bounds invalid values', () => {
  const source = pad([.2, NaN, 2], { mapping: '' });
  const result = readGamepads([null, pad([], { connected: false }), source]);
  assert.equal(result.length, 1); assert.equal(result[0].mapping, '');
  assert.deepEqual(result[0].axes, [.2, 0, 1]);
  assert.deepEqual(result[0].buttons, [{ pressed: false, touched: true, value: .3 }]);
  source.axes[0] = .9; source.buttons[0].value = 1;
  assert.equal(result[0].axes[0], .2); assert.equal(result[0].buttons[0].value, .3);
});

test('preview uses the same square threshold and exact boundary as navigation', () => {
  assert.equal(outsideDeadzone(.3, .3, .35), false);
  assert.equal(outsideDeadzone(-.35, 0, .35), false);
  assert.equal(outsideDeadzone(0, -.351, .35), true);
});

test('calibration measures peak across both left axes, keeps a margin and requires a complete sample window', () => {
  const calibration = createDeadzoneCalibration();
  calibration.start(pad(), 0);
  for (let time = 50; time < 3000; time += 50) {
    const result = calibration.sample(pad([.17, -.26]), time);
    assert.equal(result.state, 'sampling'); assert.equal(result.suggestion, undefined);
  }
  const result = calibration.sample(pad([.1, -.1]), 3000);
  assert.equal(result.state, 'complete'); assert.equal(result.peak, .26); assert.equal(result.suggestion, .35);
  assert.equal(calibration.sample(pad(), 3050).state, 'idle');
});

test('calibration rejects nonstandard devices, movement, disconnect, replacement and sampling gaps', () => {
  const calibration = createDeadzoneCalibration();
  assert.equal(calibration.start(pad([], { mapping: '' }), 0), false);
  assert.equal(calibration.start(pad([0]), 0), false);
  for (const [device, time, expected] of [[undefined, 50, 'cancelled'], [pad([0,0], { id: 'replacement' }), 50, 'cancelled'],
    [pad(), 500, 'cancelled'], [pad([.8, 0]), 50, 'moving']]) {
    calibration.start(pad(), 0);
    assert.equal(calibration.sample(device, time).state, expected);
  }
  calibration.start(pad(), 0); calibration.cancel();
  assert.equal(calibration.sample(pad(), 50).state, 'idle');
});

test('right-hand calibration uses right-stick axes and rejects devices without them', () => {
  const calibration = createDeadzoneCalibration();
  assert.equal(calibration.start(pad(), 0, 2), false);
  assert.equal(calibration.start(pad([.9, .9, .01, -.02]), 0, 2), true);
  let result;
  for (let time = 50; time <= 3000; time += 50) result = calibration.sample(pad([.9, .9, .01, -.02]), time);
  assert.equal(result.state, 'complete'); assert.equal(result.suggestion, .15);
});
