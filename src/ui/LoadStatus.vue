<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../shared/use-i18n';

const props = withDefaults(defineProps<{
  loading?: boolean; failed?: boolean; empty?: boolean;
  loadingMessage?: string; errorMessage?: string; emptyMessage?: string;
  retryable?: boolean; retryLabel?: string; errorRole?: 'alert' | 'status';
  retryAttributes?: Record<string, string | boolean | undefined>;
}>(), { errorRole: 'alert' });
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();
// Loading takes precedence over stale errors while a retry is in flight.
const state = computed(() => props.loading ? 'loading' : props.failed ? 'failed' : props.empty ? 'empty' : 'idle');
const message = computed(() => state.value === 'loading'
  ? props.loadingMessage
  : state.value === 'failed' ? props.errorMessage : state.value === 'empty' ? props.emptyMessage : '');
</script>

<template>
  <p v-if="message || (state === 'empty' && $slots.empty)" class="load-status" :data-load-state="state" :role="state === 'failed' ? errorRole : 'status'">
    <slot v-if="state === 'empty'" name="empty">{{ message }}</slot><template v-else>{{ message }}</template>
    <template v-if="state === 'failed' && retryable"> <button v-bind="retryAttributes" type="button" @click="emit('retry')">{{ retryLabel || t('Retry') }}</button></template>
  </p>
</template>
