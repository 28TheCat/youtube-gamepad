import { computed, readonly, ref, shallowRef } from 'vue';
import type { PlaybackSnapshot } from '../../types/ports';

export interface PlaybackViewState {
  seekStep: number;
  paused: boolean; currentTime: number; duration: number; volume: number;
  muted: boolean; captionsEnabled: boolean; isLive: boolean; canSeek: boolean;
  controlsVisible: boolean; start: number; end: number; atLiveEdge: boolean;
}

export function createPlaybackModel(commands: {
  activate(action: string): void;
  seek(seconds: number): boolean | void | Promise<boolean | void>;
}) {
  const snapshot = shallowRef<PlaybackSnapshot>({ video: null, captionsEnabled: false, settingsOpen: false });
  const preview = ref<number | null>(null), visible = ref(false), seeking = ref(false), error = ref('');
  let generation = 0, destroyed = false;
  const state = computed<PlaybackViewState>(() => {
    const video = snapshot.value.video, timeline = video?.timeline;
    const start = timeline?.start ?? 0, end = timeline?.end ?? 0;
    return {
      seekStep: snapshot.value.seekStep ?? 10,
      paused: video?.paused ?? true, currentTime: preview.value ?? (Number.isFinite(video?.currentTime) ? video!.currentTime : start),
      duration: video?.duration ?? 0, volume: Math.max(0, Math.min(1, video?.volume ?? 0)),
      muted: video?.muted ?? false, captionsEnabled: snapshot.value.captionsEnabled,
      isLive: timeline?.isLive ?? false, canSeek: !!timeline?.canSeek && Number.isFinite(start) && Number.isFinite(end) && end > start,
      controlsVisible: visible.value, start, end,
      atLiveEdge: preview.value === null ? !!timeline?.atLiveEdge : end - preview.value < 2
    };
  });
  function target(seconds: number) {
    const { start, end, canSeek } = state.value;
    if (!canSeek || !Number.isFinite(seconds)) return null;
    const value = Math.min(end, Math.max(start, seconds));
    const ranges = snapshot.value.video?.timeline.ranges ?? [];
    if (!ranges.length) return value;
    const valid = ranges.filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
      .map(range => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) }))
      .filter(range => range.end > range.start);
    if (!valid.length) return null;
    if (valid.some(range => value >= range.start && value <= range.end)) return value;
    return valid.flatMap(range => [range.start, range.end]).reduce((best, edge) => Math.abs(edge - value) < Math.abs(best - value) ? edge : best);
  }
  function cancelPreview() { generation++; preview.value = null; seeking.value = false; }
  return {
    state, preview: readonly(preview), seeking: readonly(seeking), error: readonly(error),
    update(value: PlaybackSnapshot) {
      if (destroyed) return;
      snapshot.value = value;
      if (!state.value.canSeek) cancelPreview();
      else if (preview.value !== null) preview.value = target(preview.value);
    },
    visible(value: boolean) { visible.value = value; if (!value) cancelPreview(); },
    request(action: string) { if (!destroyed) commands.activate(action); },
    previewAt(seconds: number) {
      if (destroyed || seeking.value) return;
      error.value = ''; preview.value = target(seconds);
    },
    async confirmSeek() {
      if (destroyed || seeking.value || preview.value === null) return false;
      const seconds = target(preview.value);
      if (seconds === null) { cancelPreview(); return false; }
      const token = ++generation;
      seeking.value = true;
      try {
        const result = await commands.seek(seconds);
        if (destroyed || token !== generation) return false;
        if (result === false) { error.value = 'Seeking is unavailable'; return false; }
        return true;
      } catch {
        if (!destroyed && token === generation) error.value = 'Unable to seek';
        return false;
      } finally {
        if (token === generation) { preview.value = null; seeking.value = false; }
      }
    },
    cancelPreview,
    reset() { cancelPreview(); error.value = ''; snapshot.value = { video: null, captionsEnabled: false, settingsOpen: false }; },
    destroy() { destroyed = true; cancelPreview(); }
  };
}
export type PlaybackModel = ReturnType<typeof createPlaybackModel>;
