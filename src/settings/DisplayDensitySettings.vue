<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
import type { DisplayDensity } from '../shared/display-density';
const { t } = useI18n();
defineProps<{ value: DisplayDensity; disabled: boolean }>();
const emit = defineEmits<{ change: [value: DisplayDensity] }>();
const presets = [{ id: 'standard' as const, label: 'Standard' }, { id: 'tv' as const, label: 'TV' }];
</script>
<template>
  <h4>{{ t('Display density') }}</h4>
  <div class="inline-layout-tabs video-grid-modes" role="group" :aria-label="t('Display density')">
    <button v-for="preset in presets" :key="preset.id" type="button" :data-setting="`density-${preset.id}`"
      :disabled="disabled" :aria-pressed="value === preset.id" @click="emit('change', preset.id)">{{ t(preset.label) }}</button>
  </div>
  <p>{{ t('TV enlarges text, controls and spacing for viewing from a distance.') }}</p>
</template>
