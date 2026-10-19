<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '../shared/use-i18n';
import { positionsOnPad } from './bindings';
const { t } = useI18n();
defineProps<{ family: string; layout: string; summaries: Record<string, string>; disabled: boolean }>();
defineEmits<{ select: [key: string] }>();
const active = ref('');
const groups = [
  { id: 'left', label: 'Left shoulder buttons', keys: ['LB', 'LT', 'Select'] },
  { id: 'right', label: 'Right shoulder buttons', keys: ['RB', 'RT', 'Start'] },
  { id: 'left-stick', label: 'Left stick', keys: ['L3'] },
  { id: 'dpad', label: 'D-pad', keys: [] },
  { id: 'right-stick', label: 'Right stick', keys: ['R3'] },
  { id: 'face', label: 'Face buttons', keys: ['A', 'B', 'X', 'Y'] }
];
</script>

<template>
  <div class="controller-binding-overview" :aria-label="t('Current bindings')">
    <header class="binding-overview-heading"><span>{{ t(layout) }}</span><small>{{ t('Current bindings') }}</small></header>
    <div class="inline-controller-map" role="group" :aria-label="t('Gamepad button positions')">
      <button v-for="([x, y], key) in positionsOnPad" :key="key" class="inline-pad-key" type="button"
        :class="{ 'is-active': active === key }" :data-setting="`pad-${key}`" :data-pad-key="key"
        :style="{ left: `${x}%`, top: `${y}%` }" :disabled="disabled"
        :aria-label="`${key} · ${t(summaries[key])}`" :title="`${key} · ${t(summaries[key])}`"
        @mouseenter="active = key" @mouseleave="active = ''" @focus="active = key" @blur="active = ''" @click="$emit('select', key)">
        <span aria-hidden="true" :data-ytg-family="family" :data-ytg-first-key="key"
          :data-ytg-second-key="key" data-ytg-icon="true" :data-inline-key="key">{{ key }}</span>
      </button>
    </div>
    <div v-for="group in groups" :key="group.id" class="binding-overview-group" :class="`binding-group-${group.id}`" role="group" :aria-label="t(group.label)">
      <h4>{{ t(group.label) }}</h4>
      <template v-if="group.id === 'dpad'">
        <p>{{ t('Move up / down / left / right') }}</p><small>{{ t('Navigation directions are fixed') }}</small>
      </template>
      <button v-for="key in group.keys" :key="key" type="button" :data-setting="`summary-${key}`"
        :class="{ 'is-active': active === key }" :disabled="disabled"
        @mouseenter="active = key" @mouseleave="active = ''" @focus="active = key" @blur="active = ''" @click="$emit('select', key)">
        <span aria-hidden="true" :data-ytg-family="family" :data-ytg-first-key="key" :data-ytg-second-key="key"
          data-ytg-icon="true" :data-inline-key="key">{{ key }}</span>
        <span>{{ t(summaries[key]) }}</span>
      </button>
    </div>
    <footer class="binding-overview-footer">{{ t('Select a button to change its binding') }}</footer>
  </div>
</template>
