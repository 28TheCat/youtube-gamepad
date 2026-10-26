<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { schema, physicalLabels, physicalIcons, positions, type BindingAction, type Layout } from './bindings';
defineProps<{ action: BindingAction; layout: Layout; value: number; disabled: boolean }>();
defineEmits<{ change: [action: BindingAction, event: Event]; focus: [action: BindingAction]; blur: [] }>();
const iconUrl = (name: string) => chrome.runtime.getURL(`assets/controller/${name}.svg`);
</script>
<template>
  <div class="binding-row">
    <label :for="`binding-${action}`">{{ t(schema.contextLabel(action, layout)) }}<span v-if="action.startsWith('keyboard')" class="binding-context">{{ t("Search keyboard") }}</span></label>
    <select :id="`binding-${action}`" :value="value" :disabled="disabled" @change="$emit('change', action, $event)" @focus="$emit('focus', action)" @blur="$emit('blur')">
      <button type="button"><selectedcontent /></button>
      <option v-for="(key, button) in schema.keys" :key="button" :value="button">
        <template v-if="physicalIcons[key]">
          <span class="binding-icons" aria-hidden="true"><img v-for="name in physicalIcons[key]" :key="name" :src="iconUrl(name)" alt="" width="28" height="28"></span>
          <span class="binding-button-name">{{ t(physicalLabels[key]) }}</span>
          <span class="binding-position" aria-hidden="true">{{ t(positions[key]) }}</span>
        </template>
        <template v-else>{{ t(physicalLabels[key]) }}</template>
      </option>
    </select>
  </div>
</template>
