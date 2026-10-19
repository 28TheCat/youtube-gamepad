import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importSettingsModel } from './helpers/settings-model.mjs';
const { videoGridDefaults: defaults, normalizeVideoGrid, videoGridLayout } = await importSettingsModel('src/shared/video-grid.ts');
test('video grid uses exact container breakpoints and switches only double columns below threshold', () => {
  const configured = { ...defaults, gridColumns0: 1, gridColumns600: 2, gridColumns900: 3,
    gridColumns1200: 5 };
  for (const [width, columns] of [[599, 1], [600, 2], [899, 2], [900, 3], [1199, 3], [1200, 5], [1920, 5]])
    assert.equal(videoGridLayout(width, configured).columns, columns);
  for (const [width, columns] of [[0, 1], [320, 1], [599, 1], [600, 2], [899, 2], [900, 3], [1024, 3], [1199, 3], [1200, 4], [1536, 4], [1920, 4], [3840, 4]])
    assert.equal(videoGridLayout(width, defaults).columns, columns);
  const settings = { ...defaults, gridSwitchWidth: 720, gridLayout: "twoColumns" };
  assert.deepEqual(videoGridLayout(700, settings), { columns: 1, horizontal: true, cover: 40 });
  assert.deepEqual(videoGridLayout(720, settings), { columns: 2, horizontal: true, cover: 50 });
  assert.equal(videoGridLayout(700, { ...settings, gridAutoSwitch: false }).columns, 2);
  assert.equal(videoGridLayout(700, { ...settings, gridLayout: "adaptive", gridColumns600: 3 }).columns, 3);
  assert.equal(videoGridLayout(639, defaults).horizontal, false);
});
test('corrupt grid preferences are bounded and removed preferences restore defaults', () => {
  const values = normalizeVideoGrid({ gridColumns600: 0, gridColumns900: 99, gridSingleCover: NaN, gridSwitchWidth: -1, gridDoubleCover: 20.8 });
  assert.equal(values.gridColumns600, 1); assert.equal(values.gridColumns900, 12);
  assert.equal(values.gridSingleCover, 40); assert.equal(values.gridSwitchWidth, 320);
  assert.equal(values.gridDoubleCover, 30);
  assert.deepEqual(normalizeVideoGrid({}), defaults);
});
