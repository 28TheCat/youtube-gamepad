<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import { getCommentReplyBranchPath, type CommentReplyAvatarAnchor } from './bewly-comment-tree-geometry';
const props = defineProps<{ revision: unknown }>();
const svg = ref<SVGSVGElement>();
const path = ref('');
let observer: ResizeObserver | undefined;
let frame = 0;
function measure() {
  const list = svg.value?.parentElement;
  if (!list) return;
  const origin = list.getBoundingClientRect();
  const owner = list.closest('.detail-branch-content, [data-comment-detail]');
  const parent = owner?.querySelector(':scope > .comment-thread .comment-avatar');
  if (!parent) { path.value = ''; return; }
  const anchor = (node: Element): CommentReplyAvatarAnchor => {
    const box = node.getBoundingClientRect();
    return { left: box.left - origin.left, centerX: box.left + box.width / 2 - origin.left,
      centerY: box.top + box.height / 2 - origin.top, bottom: box.bottom - origin.top, toggleY: 0 };
  };
  const children = [...list.querySelectorAll(':scope > .detail-branch > .detail-branch-content > .comment-thread .comment-avatar')].map(anchor);
  path.value = getCommentReplyBranchPath({ key: '', parentAuthorName: null, collapsed: false,
    collapseParentBody: false, parentAnchor: anchor(parent), childAnchors: children }, 16, 0) || '';
}
function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }
watch(() => props.revision, () => { void nextTick(schedule); }, { deep: true });
onMounted(() => {
  const list = svg.value?.parentElement;
  if (!list) return;
  observer = new ResizeObserver(schedule);
  observer.observe(list);
  const owner = list.closest('.detail-branch-content, [data-comment-detail]');
  const parent = owner?.querySelector(':scope > .comment-thread');
  if (parent) observer.observe(parent);
  schedule();
});
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); });
</script>

<template>
  <svg ref="svg" class="comment-tree-guides" aria-hidden="true"><path v-if="path" :d="path" /></svg>
</template>
