<script setup lang="ts">
import { homeFilterDefaults, homeFilterNumbers, type HomeFilterSettings } from '../shared/home-filter';
import { useI18n } from '../shared/use-i18n';
import NumberSettingRow from './NumberSettingRow.vue';
defineProps<{ values: HomeFilterSettings; disabled?: boolean; gamepad?: boolean }>();
const emit = defineEmits<{ save: [values: Partial<HomeFilterSettings>, id: string] }>();
const { t } = useI18n();
const switches = [
  { key: 'homeHideVertical', label: 'Hide vertical videos and Shorts' },
  { key: 'homeExemptSubscribed', label: 'Exempt subscribed channels' }
] as const;
</script>
<template>
  <div class="home-filter-settings">
    <h3>{{ t('Home filters') }}</h3>
    <p>{{ t('Applies only to home recommendations. Set a threshold to 0 to turn that rule off.') }}</p>
    <p>{{ t('Missing counts or dates are not filtered. Only known subscribed channels are exempt. YouTube often omits likes.') }}</p>
    <NumberSettingRow v-for="item in homeFilterNumbers" :key="item.key" :item="item" :value="values[item.key]"
      :disabled="disabled" :gamepad="gamepad" :input-step="1" @change="(value, id) => emit('save', { [item.key]: value }, id)" />
    <p>{{ t('Automatic extra pages stop at this limit. You can continue with Load more videos.') }}</p>
    <div v-for="item in switches" :key="item.key" :class="gamepad ? 'home-filter-toggle' : 'setting-row'">
      <button v-if="gamepad" type="button" :data-setting="item.key" :disabled="disabled" :aria-pressed="values[item.key]" @click="emit('save', { [item.key]: !values[item.key] }, item.key)">{{ t(item.label) }} · {{ t(values[item.key] ? 'On' : 'Off') }}</button>
      <template v-else><label :for="item.key">{{ t(item.label) }}</label><input :id="item.key" class="toggle" type="checkbox" :checked="values[item.key]" :disabled="disabled" @change="emit('save', { [item.key]: ($event.target as HTMLInputElement).checked }, item.key)" /></template>
    </div>
    <button type="button" data-setting="resetHomeFilters" :disabled="disabled" @click="emit('save', { ...homeFilterDefaults }, 'resetHomeFilters')">{{ t('Restore home filter defaults') }}</button>
  </div>
</template>
