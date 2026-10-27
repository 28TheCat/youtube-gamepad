<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';

const props = defineProps<{
  item: { key: string; label: string; min: number; max: number; step: number; suffix: string };
  value: number; disabled?: boolean; gamepad?: boolean; inputStep?: number;
}>();
const emit = defineEmits<{ change: [value: number, id: string] }>();
const { t } = useI18n();
function change(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.checkValidity()) { input.reportValidity(); input.value = String(props.value); return; }
  emit('change', Number(input.value), props.item.key);
}
function adjust(direction: number) {
  const { key, min, max, step } = props.item;
  emit('change', Math.max(min, Math.min(max, props.value + direction * step)), `${key}-${direction < 0 ? '−' : '+'}`);
}
</script>
<template>
  <div :class="gamepad ? 'inline-adjustment' : 'setting-row'">
    <template v-if="gamepad">
      <span>{{ t(item.label) }} · {{ value }}{{ item.suffix }}</span>
      <button v-for="direction in [-1, 1]" :key="direction" type="button" :data-setting="`${item.key}-${direction < 0 ? '−' : '+'}`"
        :aria-label="t(direction < 0 ? 'Decrease {label}' : 'Increase {label}', { label: t(item.label) })"
        :disabled="disabled || (direction < 0 ? value <= item.min : value >= item.max)" @click="adjust(direction)">{{ direction < 0 ? '−' : '+' }}</button>
    </template>
    <template v-else>
      <div class="setting-copy"><label :for="item.key">{{ t(item.label) }}</label><p>{{ item.min }}–{{ item.max }}{{ item.suffix }}</p></div>
      <div class="number-control"><input :id="item.key" type="number" :min="item.min" :max="item.max" :step="inputStep ?? item.step" required
        :disabled="disabled" :value="value" @change="change"><span>{{ item.suffix }}</span></div>
    </template>
  </div>
</template>
