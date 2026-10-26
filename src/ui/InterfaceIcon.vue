<script setup lang="ts">
import { mingcuteIcons } from './mingcute-icons';
defineProps<{ name: string; filled?: boolean }>();
</script>
<template>
  <svg viewBox="0 0 24 24" aria-hidden="true" :data-icon="`${name === 'subscriptions' ? 'material' : 'mingcute'}:${name}-${filled ? 'fill' : 'line'}`" style="fill:none;stroke:none">
    <component v-for="(shape, index) in mingcuteIcons[`${name}-${filled ? 'fill' : 'line'}`] || []" :is="shape.tag" :key="index" v-bind="shape.attrs" />
  </svg>
</template>
