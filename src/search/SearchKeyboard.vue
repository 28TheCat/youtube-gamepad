<script setup lang="ts">
import type { ControllerStyle, KeyboardKey } from '../../types/ports.js';
defineProps<{ rows: KeyboardKey[][]; choosingLanguage: boolean; controllerStyle: ControllerStyle }>();
const emit = defineEmits<{ key: [key: KeyboardKey]; focus: [button: HTMLButtonElement] }>();
const shortcuts: Record<string, [string, string]> = {
  BACKSPACE: ['X', 'X Delete (hold to repeat)'], SPACE: ['Y', 'Y Space; confirm candidate when entering pinyin'],
  NUMBER_LAYOUT: ['L3', 'L3 Switch to symbols'], LETTER_LAYOUT: ['L3', 'L3 Switch to letters'], SEARCH: ['RT', 'RT Search']
};
const vBadge = { mounted(el: HTMLElement, binding: { value: [ControllerStyle, string] }) { binding.value[0].badge(el, binding.value[1]); } };
const vTitle = { mounted(el: HTMLElement, binding: { value: [ControllerStyle, string] }) { if (binding.value[1]) binding.value[0].bind(el, binding.value[1], 'title'); },
  updated(el: HTMLElement, binding: { value: [ControllerStyle, string] }) { if (binding.value[1]) binding.value[0].bind(el, binding.value[1], 'title'); else { el.removeAttribute('data-ytg-title'); el.removeAttribute('title'); } } };
</script>

<template>
  <div id="keys">
    <div v-for="(row, rowIndex) in rows" :key="rowIndex" class="key-row" :class="{ languages: choosingLanguage }">
      <button v-for="(key, column) in row" :key="`${rowIndex}:${column}:${key.action}`"
        :data-focus-id="`key:${rowIndex}:${column}`" :data-row="rowIndex" :data-column="column" :data-action="key.action"
        :aria-label="key.ariaLabel || key.label" :class="{ 'has-controller-badge': shortcuts[key.action] }"
        v-title="[controllerStyle, shortcuts[key.action]?.[1]]" @mousedown.prevent
        @focus="emit('focus', $event.currentTarget as HTMLButtonElement)" @click="emit('key', key)">
        <svg v-if="key.action === 'BACKSPACE'" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z" /></svg>
        <svg v-else-if="key.action === 'SWITCH_LANGUAGE'" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" /><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="2" /><path d="M3 9h18M3 15h18" fill="none" stroke="currentColor" stroke-width="2" /></svg>
        <template v-else>{{ key.label }}</template>
        <span v-if="shortcuts[key.action]" :key="key.action" class="key-controller-badge" aria-hidden="true"><span v-badge="[controllerStyle, shortcuts[key.action]![0]]"></span></span>
      </button>
    </div>
  </div>
</template>
