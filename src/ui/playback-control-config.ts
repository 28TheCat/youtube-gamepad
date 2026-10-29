import { nativeControlTargetId } from '../sites/native-player-controls';
export const primaryPlaybackGroups = [
  [['channel', ''], ['subscribe', ''], ['description', '']],
  [['seekBack', 'previous'], ['playPause', 'pause'], ['seekForward', 'next']]
] as const;
export const secondaryPlaybackGroups = [
  [['like', 'like'], ['dislike', 'dislike'], ['comments', 'comments'], ['save', 'save'], ['mute', 'volume']],
  [['captions', 'captions'], ['settings', 'settings'], ['goLive', '']]
] as const;

const secondaryIds = secondaryPlaybackGroups.flatMap(group => group.map(([id]) => id));
const fullscreenIds = [...primaryPlaybackGroups.flatMap(group => group.map(([id]) => id)), 'collection', ...secondaryIds];
// These custom media controls are fullscreen-only; windowed playback uses YouTube's strip.
export const windowedPlayerControlIds: readonly string[] = ['seekBack', 'playPause', 'seekForward', 'mute', 'captions', 'settings', 'goLive'];
const windowedIds = [...primaryPlaybackGroups[0].map(([id]) => id), ...secondaryIds.filter(id => !windowedPlayerControlIds.includes(id))];
export function playbackControlIds(fullscreen: boolean): readonly string[] {
  return fullscreen ? fullscreenIds : windowedIds;
}
export function defaultPlaybackControlIndex(controls: readonly { id: string; available?: boolean }[]) {
  const primary = controls.findIndex(control => ['playPause', nativeControlTargetId('playPause')].includes(control.id) && control.available !== false);
  return primary >= 0 ? primary : Math.max(0, controls.findIndex(control => control.available !== false));
}
