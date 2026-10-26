<script setup lang="ts">
import { computed } from 'vue';
import type { Directive } from 'vue';
import { useI18n } from '../shared/use-i18n';
import type { ControllerStyle, WatchSnapshot } from '../../types/ports';
const { t } = useI18n();
const props = defineProps<{ row: WatchSnapshot['row']; adjusting: boolean; canSeek: boolean; controllerStyle: ControllerStyle }>();
const entries = computed(() => props.row === 'progress'
  ? (props.adjusting ? [['← / →', 'Seek'], ['A', 'Finish adjusting'], ['B', 'Back to timeline']] : [['A', 'Adjust position'], ['↑', 'Hide controls'], ['↓ / B', 'Back to controls']])
  : props.row === 'recommendations' ? [['↑ / ↓ / ← / →', 'Select video'], ['A', 'Play'], ['B', 'Back to controls'], ['Start', 'Menu']]
  : [['A', 'Confirm'], ['B', 'Back'], ...(props.canSeek ? [['↑', 'Timeline · A Adjust']] : []), ['↓', 'Recommendations'], ['LB / RB', 'Recommendations / Comments'], ['Start', 'Menu']]);
const vBadge: Directive<HTMLElement, string> = { mounted(node, binding) { props.controllerStyle.badge(node, binding.value); } };
const vHint: Directive<HTMLElement, string> = { mounted(node, binding) { props.controllerStyle.hint(node, binding.value); }, updated(node, binding) { if (binding.value !== binding.oldValue) props.controllerStyle.hint(node, binding.value); } };
</script>
<template>
  <div class="hint"><span v-for="[key, text] in entries" :key="key" class="hint-item"><kbd v-badge="key"></kbd><span v-hint="t(text)"></span></span></div>
</template>
