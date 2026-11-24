<script setup lang="ts">
defineProps<{ replies?: boolean }>();
</script>

<template>
  <div class="comment-skeletons" :class="{ 'reply-skeletons': replies }" aria-hidden="true">
    <div v-for="index in 3" :key="index" class="comment-skeleton">
      <span class="comment-skeleton-avatar"></span>
      <div class="comment-skeleton-copy">
        <span class="comment-skeleton-author"></span>
        <span class="comment-skeleton-line"></span>
        <span class="comment-skeleton-line short"></span>
      </div>
    </div>
  </div>
</template>
