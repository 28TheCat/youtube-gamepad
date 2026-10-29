<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
import { ref, watch, onBeforeUnmount } from 'vue';
import { requestSearchSuggestions } from './search-suggestions';
const { t } = useI18n();
const props = defineProps<{ recent: readonly string[]; query?: string }>();
const emit = defineEmits<{ search: [query: string]; focus: [button: HTMLButtonElement] }>();
const suggestions = ref<string[]>([]);
const status = ref<'loading' | 'ready' | 'error'>('loading');
let sequence = 0, timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined;
watch(() => props.query || '', query => {
  const current = ++sequence;
  clearTimeout(timer); request?.abort(); suggestions.value = []; status.value = 'loading';
  timer = setTimeout(async () => {
    const controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const result = await requestSearchSuggestions(query.trim(), controller.signal);
      if (current === sequence) { suggestions.value = result; status.value = 'ready'; }
    } catch {
      if (current === sequence) status.value = 'error';
    } finally { clearTimeout(timeout); }
  }, query.trim() ? 250 : 0);
}, { immediate: true });
onBeforeUnmount(() => { ++sequence; clearTimeout(timer); request?.abort(); });
</script>

<template>
  <div class="search-discovery">
    <div v-if="!query?.trim()" class="search-discovery-group" role="group" :aria-label="t('Recent searches')">
      <p class="search-discovery-title">{{ t('Recent searches') }}</p>
      <p v-if="!recent.length" class="search-discovery-empty">{{ t('Your recent searches will appear here') }}</p>
      <button v-for="(query, row) in recent" :key="query" type="button"
        :data-focus-id="`history:${query}`" :data-row="row" data-column="-1"
        @focus="emit('focus', $event.currentTarget as HTMLButtonElement)" @click="emit('search', query)">↶ {{ query }}</button>
    </div>
    <div class="search-discovery-group" role="group" :aria-label="t('Suggested searches')">
      <p class="search-discovery-title">{{ t('Suggested searches') }}</p>
      <p v-if="status === 'loading'" class="search-discovery-empty" role="status">{{ t('Loading…') }}</p>
      <p v-else-if="status === 'error'" class="search-discovery-empty" role="status">{{ t('Search suggestions are unavailable') }}</p>
      <p v-else-if="!suggestions.length" class="search-discovery-empty">{{ t('No search suggestions') }}</p>
      <button v-for="(suggestion, index) in suggestions" :key="suggestion" type="button"
        :data-focus-id="`suggestion:${suggestion}`" :data-row="index + (!query?.trim() ? recent.length : 0)" data-column="-1"
        @focus="emit('focus', $event.currentTarget as HTMLButtonElement)" @click="emit('search', suggestion)">{{ suggestion }}</button>
    </div>
  </div>
</template>
