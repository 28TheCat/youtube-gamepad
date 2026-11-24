<script setup lang="ts">
import { computed } from 'vue';
import type { Directive } from 'vue';
import { useI18n } from '../shared/use-i18n';
import type { ControllerStyle, WatchSnapshot } from '../../types/ports';
const { t } = useI18n();
const props = defineProps<{ row: WatchSnapshot['row']; adjusting: boolean; canSeek: boolean; windowed: boolean; hasRecommendations: boolean; focusLabel: string; controllerStyle: ControllerStyle }>();
const entries = computed(() => {
  if (props.row === 'progress') return props.canSeek
    ? (props.adjusting ? [['← / →', 'Seek'], ['A', 'Finish adjusting'], ['B', 'Back to timeline']] : [['A', 'Adjust position'], ['B', props.windowed ? 'Back to player' : 'Back to controls']]) : [['B', 'Back']];
  if (props.row === 'recommendations') return [...(props.hasRecommendations ? [['↑ / ↓ / ← / →', 'Select video'], ['A', 'Play']] : []), ['B', props.windowed ? 'Back to player' : 'Back to controls'], ['Start', 'Menu']];
  if (props.row === 'player') return [['A', 'Enter fullscreen'], ['B', 'Back'], ['Start', 'Menu']];
  if (props.row === 'metadata') return [['A', 'Video description'], ['B', 'Back to player']];
  if (props.row === 'tabs' || props.row === 'filters') return [['← / →', 'Select'], ['A', 'Confirm'], ['B', 'Back']];
  return [...(props.focusLabel ? [['A', props.focusLabel]] : []), ['B', 'Back'], ...(!props.windowed && props.canSeek ? [['↑', 'Timeline']] : []), ...(!props.windowed && props.hasRecommendations ? [['↓', 'Recommendations']] : []), ['Start', 'Menu']];
});
const vBadge: Directive<HTMLElement, string> = { mounted(node, binding) { props.controllerStyle.badge(node, binding.value); }, updated(node, binding) { if (binding.value !== binding.oldValue) props.controllerStyle.badge(node, binding.value); } };
const vHint: Directive<HTMLElement, string> = { mounted(node, binding) { props.controllerStyle.hint(node, binding.value); }, updated(node, binding) { if (binding.value !== binding.oldValue) props.controllerStyle.hint(node, binding.value); } };
</script>
<template>
  <div class="hint"><span v-for="[key, text] in entries" :key="key" class="hint-item"><kbd v-badge="key"></kbd><span v-hint="t(text)"></span></span></div>
</template>
