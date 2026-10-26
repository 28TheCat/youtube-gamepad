// Based on BewlyCat gridLayout.ts, VideoCardGrid.vue and logic/storage.ts behavior.
// https://github.com/keleus/BewlyCat/blob/main/src/utils/gridLayout.ts
export type GridLayoutMode = "adaptive" | "oneColumn" | "twoColumns";
export const videoGridDefaults = {
  gridLayout: "adaptive" as GridLayoutMode, gridAutoSwitch: true, gridSwitchWidth: 640,
  gridSingleCover: 40, gridDoubleCover: 50,
  gridColumns0: 1, gridColumns600: 2, gridColumns900: 3, gridColumns1200: 4
};
export type VideoGridSettings = typeof videoGridDefaults;
export type VideoGridKey = keyof VideoGridSettings;
export const gridBreakpoints = [
  { key: 'gridColumns0', width: 0, label: '< 600px' },
  { key: 'gridColumns600', width: 600, label: '600–899px' },
  { key: 'gridColumns900', width: 900, label: '900–1199px' },
  { key: 'gridColumns1200', width: 1200, label: '≥ 1200px' }
] as const;
export function normalizeVideoGrid(raw: Record<string, unknown>): VideoGridSettings {
  const values = { ...videoGridDefaults };
  if (raw.gridLayout === 'adaptive' || raw.gridLayout === 'oneColumn' || raw.gridLayout === 'twoColumns') values.gridLayout = raw.gridLayout;
  if (typeof raw.gridAutoSwitch === 'boolean') values.gridAutoSwitch = raw.gridAutoSwitch;
  for (const key of Object.keys(values) as VideoGridKey[]) {
    if (key === 'gridAutoSwitch' || key === 'gridLayout') continue;
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [min, max] = key === 'gridSwitchWidth' ? [320, 1200]
      : key === 'gridSingleCover' || key === 'gridDoubleCover' ? [30, 70] : [1, 12];
    const bounded = Math.min(max, Math.max(min, value));
    values[key] = key === "gridSingleCover" || key === "gridDoubleCover" ? 30 + Math.round((bounded - 30) / 5) * 5 : Math.round(bounded);
  }
  return values;
}
export function videoGridLayout(width: number, settings: VideoGridSettings) {
  let columns = settings.gridColumns0;
  for (const breakpoint of gridBreakpoints)
    if (width >= breakpoint.width) columns = settings[breakpoint.key];
  if (settings.gridLayout === "oneColumn") columns = 1;
  else if (settings.gridLayout === "twoColumns")
    columns = settings.gridAutoSwitch && width < settings.gridSwitchWidth ? 1 : 2;
  return { columns, horizontal: settings.gridLayout !== "adaptive",
    cover: columns === 1 ? settings.gridSingleCover : settings.gridDoubleCover };
}
