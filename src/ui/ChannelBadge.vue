<script setup lang="ts">
import InterfaceIcon from './InterfaceIcon.vue';
import { useI18n } from '../shared/use-i18n';
defineProps<{ badge?: 'verified' | 'artist' }>();
const { t } = useI18n();
</script>
<template>
  <span v-if="badge" class="channel-badge" role="img" style="display:inline-flex;align-items:center;vertical-align:-2px;margin-left:4px;color:inherit;flex:none" :aria-label="t(badge === 'artist' ? 'Official artist channel' : 'Verified')" :title="t(badge === 'artist' ? 'Official artist channel' : 'Verified')">
    <InterfaceIcon :name="badge" filled style="width:14px;height:14px;flex:none" />
  </span>
</template>
