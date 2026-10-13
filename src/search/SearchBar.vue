<script setup lang="ts">
import { ref, type Directive } from 'vue';
import type { ControllerStyle } from '../../types/ports';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
const props = defineProps<{ modelValue: string; placeholder?: string; voiceAvailable?: boolean; voiceLabel?: string; gamepad?: boolean; controllerStyle?: ControllerStyle }>();
const vSearchKey: Directive<HTMLElement> = { mounted(node) { props.controllerStyle?.badge(node, 'Y'); } };
const emit = defineEmits<{
  'update:modelValue': [value: string];
  search: [query: string];
  voice: [];
  open: [];
}>();
const input = ref<HTMLInputElement>();
const composing = ref(false);
function update(event: Event) { emit('update:modelValue', (event.currentTarget as HTMLInputElement).value); }
function handleEnter(event: KeyboardEvent) { if (event.isComposing || composing.value) event.preventDefault(); }
function submit() {
  const query = input.value?.value.trim() || '';
  if (!composing.value && query) emit('search', query);
}
defineExpose({ focus: () => input.value?.focus(), input });
</script>

<template>
  <div class="ytg-search-bar">
    <button v-show="gamepad" type="button" class="ytg-search-entry" data-ytg-search-entry
      :aria-label="t('Search videos')" aria-haspopup="dialog" @click="emit('open')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
      <span class="ytg-search-entry-label">{{ modelValue || t('Search videos') }}</span>
      <span v-search-key class="ytg-search-key" aria-hidden="true">Y</span>
    </button>
    <form v-show="!gamepad" role="search" class="ytg-search-form" @submit.prevent="submit">
      <div class="ytg-search-field">
        <svg class="ytg-search-leading" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
        <input ref="input" data-ytg-search-input name="search_query" :aria-label="t('Search')"
          :placeholder="t('Search')" :value="modelValue" autocomplete="off"
          @input="update" @compositionstart="composing = true" @compositionend="composing = false; update($event)"
          @keydown.enter="handleEnter" />
      </div>
      <button type="submit" class="ytg-search-submit" :aria-label="t('Search')">
        {{ t('Search') }}
      </button>
    </form>
    <button v-if="voiceAvailable" v-show="!gamepad" type="button" class="ytg-search-voice" :aria-label="t('Voice search')" @click="emit('voice')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6"/></svg>
    </button>
  </div>
</template>
