<script setup lang="ts">
import type { Directive } from 'vue';
import type { ControllerStyle } from '../../types/ports';
import type { BrowseOverlaySnapshot } from './browse-overlay';
const props = defineProps<{ view: BrowseOverlaySnapshot; controllerStyle: ControllerStyle }>();
const vHelp: Directive<HTMLElement> = { mounted(node) {
  props.controllerStyle.hint(node, 'YouTube Gamepad\nD-pad / left stick: Select · A: Open\nScroll stick: Scroll\nDuring playback, ↑: Controls · B: Back\nX: Play / pause · Y: Search\nLB / RB: Browse categories, or rewind / forward 10 seconds during playback\nLT / RT: Volume down / up · Start: Quick menu');
} };
</script>
<template>
  <div id="ring" data-vue-browse :style="{ display: view.visible ? 'block' : 'none', transition: view.animate ? '' : 'none', transform: `translate3d(${view.left}px,${view.top}px,0)`, width: view.width + 'px', height: view.height + 'px', borderColor: view.adjusting ? 'var(--ytg-adjusting-color,#fbbf24)' : '', borderRadius: view.radius }"></div>
  <div id="help" v-help :style="{ display: view.helpVisible ? 'block' : 'none', whiteSpace: 'pre-line' }"></div>
</template>
