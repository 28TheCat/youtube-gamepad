import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { videoGridDefaults: defaults, normalizeVideoGrid, videoGridLayout } = await importSettingsModel('src/shared/video-grid.ts');
test('video grid uses exact container breakpoints and switches only double columns below threshold', () => {
  const configured = { ...defaults, gridColumns0: 1, gridColumns640: 2, gridColumns768: 3,
    gridColumns1024: 4, gridColumns1280: 5, gridColumns1536: 6 };
  for (const [width, columns] of [[639, 1], [640, 2], [767, 2], [768, 3], [1024, 4], [1280, 5], [1536, 6]])
    assert.equal(videoGridLayout(width, configured).columns, columns);
  for (const width of [320, 639, 640, 768, 1024, 1280, 1920])
    assert.equal(videoGridLayout(width, defaults).columns, 4);
  const settings = { ...defaults, gridSwitchWidth: 720, gridLayout: "twoColumns" };
  assert.deepEqual(videoGridLayout(700, settings), { columns: 1, horizontal: true, cover: 40 });
  assert.deepEqual(videoGridLayout(720, settings), { columns: 2, horizontal: true, cover: 50 });
  assert.equal(videoGridLayout(700, { ...settings, gridAutoSwitch: false }).columns, 2);
  assert.equal(videoGridLayout(700, { ...settings, gridLayout: "adaptive", gridColumns640: 3 }).columns, 3);
  assert.equal(videoGridLayout(639, defaults).horizontal, false);
});
test('corrupt grid preferences are bounded and removed preferences restore defaults', () => {
  const values = normalizeVideoGrid({ gridColumns640: 0, gridColumns768: 99, gridSingleCover: NaN, gridSwitchWidth: -1, gridDoubleCover: 20.8 });
  assert.equal(values.gridColumns640, 1); assert.equal(values.gridColumns768, 12);
  assert.equal(values.gridSingleCover, 40); assert.equal(values.gridSwitchWidth, 320);
  assert.equal(values.gridDoubleCover, 30);
  assert.deepEqual(normalizeVideoGrid({}), defaults);
});
