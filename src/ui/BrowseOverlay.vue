<script setup lang="ts">
import type { Directive } from 'vue';
import type { ControllerStyle } from '../../types/ports';
import type { BrowseOverlaySnapshot } from './browse-overlay';
const props = defineProps<{ view: BrowseOverlaySnapshot; controllerStyle: ControllerStyle }>();
const vHelp: Directive<HTMLElement, string> = {
  mounted(node, binding) { props.controllerStyle.hint(node, binding.value); },
  updated(node, binding) { if (binding.value !== binding.oldValue) props.controllerStyle.hint(node, binding.value); }
};
</script>
<template>
  <div id="ring" data-vue-browse :style="{ display: view.visible ? 'block' : 'none', transition: view.animate ? '' : 'none', transform: `translate3d(${view.left}px,${view.top}px,0)`, width: view.width + 'px', height: view.height + 'px', borderColor: view.adjusting ? 'var(--ytg-adjusting-color,#fbbf24)' : '', borderRadius: view.radius }"></div>
  <div id="help" v-help="view.helpText || 'D-pad: Select · A Confirm · B Back'" :style="{ display: view.helpVisible ? 'block' : 'none', whiteSpace: 'pre-line' }"></div>
</template>
