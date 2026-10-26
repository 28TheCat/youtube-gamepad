<script setup lang="ts">
import InterfaceIcon from './InterfaceIcon.vue';
defineProps<{ name: string; filled?: boolean }>();
</script>
<template>
  <InterfaceIcon :name="name" :filled="filled ?? (name === 'play' || name === 'pause')" />
</template>
