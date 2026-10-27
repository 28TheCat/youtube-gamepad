export const primaryPlaybackGroups = [
  [['channel', ''], ['subscribe', ''], ['description', '']],
  [['seekBack', 'previous'], ['playPause', 'pause'], ['seekForward', 'next']]
] as const;
export const secondaryPlaybackGroups = [
  [['like', 'like'], ['dislike', 'dislike'], ['comments', 'comments'], ['save', 'save'], ['mute', 'volume']],
  [['captions', 'captions'], ['settings', 'settings'], ['goLive', '']]
] as const;

const secondaryIds = secondaryPlaybackGroups.flatMap(group => group.map(([id]) => id));
const fullscreenIds = [...primaryPlaybackGroups.flatMap(group => group.map(([id]) => id)), ...secondaryIds];
const windowedIds = [...primaryPlaybackGroups[0].map(([id]) => id), 'fullscreen', ...secondaryIds];
export function playbackControlIds(fullscreen: boolean): readonly string[] {
  return fullscreen ? fullscreenIds : windowedIds;
}
export function defaultPlaybackControlIndex(controls: readonly { id: string; available?: boolean }[]) {
  const primary = controls.findIndex(control => ['playPause', 'fullscreen'].includes(control.id) && control.available !== false);
  return primary >= 0 ? primary : Math.max(0, controls.findIndex(control => control.available !== false));
}
