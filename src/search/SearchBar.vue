<script setup lang="ts">
import InterfaceIcon from '../ui/InterfaceIcon.vue';
import { ref } from 'vue';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
defineProps<{ modelValue: string; voiceAvailable?: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  search: [query: string];
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
defineExpose({ focus: () => input.value?.focus(), input });
</script>

<template>
  <div class="ytg-search-bar">
    <form role="search" class="ytg-search-form" @submit.prevent="submit">
      <div class="ytg-search-field">
        <InterfaceIcon name="search" class="ytg-search-leading" />
        <input ref="input" data-ytg-search-input data-ytg-search-entry name="search_query" :aria-label="t('Search')"
          :placeholder="t('Search')" :value="modelValue" autocomplete="off"
          @input="update" @compositionstart="composing = true" @compositionend="composing = false; update($event)"
          @keydown.enter="handleEnter" />
      </div>
      <button type="submit" class="ytg-search-submit" :aria-label="t('Search')">
        <InterfaceIcon name="search" class="ytg-search-submit-icon" /><span>{{ t('Search') }}</span>
      </button>
    </form>
    <button v-if="voiceAvailable" type="button" class="ytg-search-voice" :aria-label="t('Voice search')" @click="emit('voice')">
      <InterfaceIcon name="mic" />
    </button>
  </div>
</template>
