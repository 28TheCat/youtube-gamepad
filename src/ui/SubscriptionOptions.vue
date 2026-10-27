<script setup lang="ts">
import type { NotificationPreference, WatchAction } from '../../types/ports';
import { useI18n } from '../shared/use-i18n';
import { subscriptionOptions } from './subscription-options';
import LoadStatus from './LoadStatus.vue';

defineProps<{ preference?: NotificationPreference; loading?: boolean; failed?: boolean }>();
const emit = defineEmits<{ action: [action: Extract<WatchAction, 'unsubscribe' | typeof subscriptionOptions[number]['action']>] }>();
const { t } = useI18n();
</script>

<template>
  <div data-vue-subscription>
    <div role="group" :aria-label="t('Notifications')">
      <button v-for="option in subscriptionOptions" :key="option.action" type="button"
        class="control subscription-option" :data-key="option.action" :data-focus-id="option.action"
        :aria-label="t(option.description)" :aria-pressed="preference === option.preference" :disabled="loading"
        @click="emit('action', option.action)"><span class="subscription-check" aria-hidden="true">{{ preference === option.preference ? '✓' : '' }}</span>{{ t(option.label) }}</button>
    </div>
    <button type="button" class="control subscription-option unsubscribe-option" data-key="unsubscribe" data-focus-id="unsubscribe"
      :disabled="loading" @click="emit('action', 'unsubscribe')">{{ t('Unsubscribe') }}</button>
    <LoadStatus :loading="loading" :failed="failed"
      :loading-message="t('Saving…')" :error-message="t('Could not update subscription. Try again.')" />
  </div>
</template>
