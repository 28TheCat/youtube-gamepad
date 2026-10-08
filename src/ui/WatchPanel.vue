<script setup lang="ts">
import type { Directive } from 'vue';
import type { CommentSnapshot, ControllerStyle } from '../../types/ports';
defineProps<{
  panel: 'description' | 'comments'; text: string; records: readonly CommentSnapshot[];
  collapsed: readonly string[]; unavailable: boolean; controllerStyle: ControllerStyle;
  toggle: (key: string) => void; replies: (key: string) => void; load: () => void;
}>();
const vHint: Directive<HTMLElement, [ControllerStyle, string]> = {
  mounted(el, binding) { binding.value[0].hint(el, binding.value[1]); },
  updated(el, binding) {
    if (binding.value[1] !== binding.oldValue?.[1]) binding.value[0].hint(el, binding.value[1]);
  }
};
</script>

<template>
  <div v-if="panel === 'description'" data-vue-description>{{ text || 'No description available' }}</div>
  <div v-else data-vue-comments>
    <div v-for="item in records" :key="item.key" class="comment">
      <button class="comment-header" :data-focus-id="`comment:${item.key}`"
        :aria-expanded="!collapsed.includes(item.key)" @click="toggle(item.key)">
        <span class="comment-toggle">{{ collapsed.includes(item.key) ? '+' : '−' }}</span>
        <span class="comment-author">{{ item.author }}</span>
        <span v-if="collapsed.includes(item.key)" class="comment-summary">Comment collapsed</span>
      </button>
      <div class="comment-body" :hidden="collapsed.includes(item.key)">
        <div>{{ item.text }}</div>
        <div v-if="item.expanded.length" class="comment-replies-list">
          <div v-for="(reply, index) in item.expanded" :key="index" class="comment-reply">↳ {{ reply }}</div>
        </div>
        <button v-if="item.hasReplies" class="comment-replies" :data-focus-id="`replies:${item.key}`" @click="replies(item.key)">
          {{ item.repliesLabel }}<span v-hint="[controllerStyle, ' · A Load replies']"></span>
        </button>
      </div>
    </div>
    <p v-if="!records.length" role="status" v-hint="[controllerStyle, unavailable
      ? 'Comments are unavailable. Playback continues normally. B Back.'
      : 'Comments are still loading or disabled for this video. Press ↓ to load more, B to go back.']"></p>
    <button v-else class="control" data-focus-id="comments:more" @click="load">Load more comments</button>
  </div>
</template>
