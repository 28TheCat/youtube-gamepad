<script setup lang="ts">
import type { Directive } from 'vue';
import { renderInterfaceIcon } from './icon-shapes';
defineProps<{ name: string; filled?: boolean }>();
const vIcon: Directive<SVGSVGElement, [string, boolean]> = {
  mounted(svg, binding) { renderInterfaceIcon(svg, ...binding.value); },
  updated(svg, binding) {
    if (binding.value[0] !== binding.oldValue?.[0] || binding.value[1] !== binding.oldValue?.[1]) renderInterfaceIcon(svg, ...binding.value);
  }
};
</script>
<template>
  <svg v-icon="[name, filled ?? false]" />
</template>
