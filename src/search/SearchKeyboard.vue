<script setup lang="ts">
import InterfaceIcon from '../ui/InterfaceIcon.vue';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
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
        :aria-label="t(key.ariaLabel || key.label)" :class="{ 'has-controller-badge': shortcuts[key.action] }"
        v-title="[controllerStyle, shortcuts[key.action]?.[1]]" @mousedown.prevent
        @focus="emit('focus', $event.currentTarget as HTMLButtonElement)" @click="emit('key', key)">
        <InterfaceIcon v-if="key.action === 'BACKSPACE'" name="backspace" />
        <InterfaceIcon v-else-if="key.action === 'SWITCH_LANGUAGE'" name="language" />
        <template v-else>{{ t(key.label) }}</template>
        <span v-if="shortcuts[key.action]" :key="key.action" class="key-controller-badge" aria-hidden="true"><span v-badge="[controllerStyle, shortcuts[key.action]![0]]"></span></span>
      </button>
    </div>
  </div>
</template>
