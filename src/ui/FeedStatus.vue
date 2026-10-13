<script setup lang="ts">
import { useI18n } from '../shared/use-i18n';

defineProps<{ error: string; loading: boolean; empty: boolean; category: string }>();
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>

<template>
  <p v-if="error" role="alert">{{ t(error) }} <button @click="emit('retry')">{{ t('重试') }}</button></p>
  <p v-else-if="empty" role="status">{{ loading || !category ? t('Loading videos…') : t('此分类暂无视频') }}</p>
</template>
