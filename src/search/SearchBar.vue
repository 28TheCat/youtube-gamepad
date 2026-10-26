<script setup lang="ts">
import InterfaceIcon from '../ui/InterfaceIcon.vue';
import { nextTick, ref } from 'vue';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
defineProps<{ modelValue: string; voiceAvailable?: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  search: [query: string];
  clear: [];
  voice: [];
}>();
const input = ref<HTMLInputElement>();
const composing = ref(false);
function update(event: Event) { emit('update:modelValue', (event.currentTarget as HTMLInputElement).value); }
function handleEnter(event: KeyboardEvent) { if (event.isComposing || composing.value) event.preventDefault(); }
function submit() {
  const query = input.value?.value.trim() || '';
  if (!composing.value && query) emit('search', query);
}
async function clear() {
  composing.value = false;
  emit('update:modelValue', '');
  await nextTick();
  emit('clear');
}
</script>

<template>
  <div class="ytg-search-bar">
    <form role="search" class="ytg-search-form" @submit.prevent="submit">
      <div class="ytg-search-field">
        <InterfaceIcon name="search" class="ytg-search-leading" />
        <input ref="input" data-ytg-search-input name="search_query" :aria-label="t('Search')"
          :placeholder="t('Search')" :value="modelValue" autocomplete="off"
          @input="update" @compositionstart="composing = true" @compositionend="composing = false; update($event)"
          @keydown.enter="handleEnter" />
      </div>
      <button v-if="modelValue.length" type="button" class="ytg-search-clear" @click="clear">{{ t('Clear') }}</button>
      <button type="submit" class="ytg-search-submit" :aria-label="t('Search')">
        <InterfaceIcon name="search" class="ytg-search-submit-icon" /><span>{{ t('Search') }}</span>
      </button>
    </form>
    <button v-if="voiceAvailable" type="button" class="ytg-search-voice" :aria-label="t('Voice search')" @click="emit('voice')">
      <InterfaceIcon name="mic" />
    </button>
  </div>
</template>
