<script setup lang="ts">
import { ref, computed, onBeforeUnmount, nextTick, watch } from 'vue';
import type { CommentSnapshot, CommentsStatus } from '../../types/ports';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
const props = defineProps<{
  records: readonly CommentSnapshot[]; status?: CommentsStatus; route: string;
  post?: (text: string, key?: string) => Promise<boolean>;
  changeSort?: (sort: 'TOP_COMMENTS' | 'NEWEST_FIRST') => boolean;
}>();
const root = ref<HTMLElement>(), input = ref<HTMLTextAreaElement>();
const editing = ref(false), text = ref(''), replyKey = ref<string>();
const sending = ref(false), message = ref('');
let disposed = false, generation = 0;
let opener: HTMLElement | null = null;
const state = computed(() => !props.status?.route || props.status.route === props.route ? props.status?.interaction : undefined);
function changed() { root.value?.dispatchEvent(new CustomEvent('ytg-comment-controls-changed', { bubbles: true })); }
watch(() => props.route, () => {
  ++generation; editing.value = false; text.value = ''; replyKey.value = undefined; message.value = ''; sending.value = false; opener = null;
});
function begin(key?: string) {
  if (sending.value || !state.value?.signedIn || (key ? !props.records.some(item => item.key === key && item.canReply) : !state.value.canPost)) return;
  opener = (root.value?.getRootNode() as ShadowRoot | undefined)?.activeElement as HTMLElement | null;
  replyKey.value = key; editing.value = true; message.value = '';
  void nextTick(() => { changed(); input.value?.focus({ preventScroll: true }); });
}
function cancel() {
  if (sending.value) return;
  editing.value = false; text.value = ''; message.value = ''; replyKey.value = undefined;
  void nextTick(() => { changed(); (opener?.isConnected ? opener : root.value?.querySelector<HTMLButtonElement>('[data-comment-write]'))?.focus({ preventScroll: true }); });
}
async function submit() {
  if (sending.value || !text.value.trim() || text.value.length > 4000) return;
  const captured = props.route, version = ++generation;
  sending.value = true; message.value = '';
  let ok = false;
  try { ok = await props.post?.(text.value, replyKey.value) === true; } catch { /* Keep the draft. */ }
  if (disposed || captured !== props.route || version !== generation) return;
  sending.value = false;
  if (ok) { text.value = ''; editing.value = false; replyKey.value = undefined; message.value = 'Comment sent.'; }
  else message.value = 'Could not confirm sending. Your draft is kept. Check YouTube before retrying.';
  void nextTick(changed);
}
function sort(value: 'TOP_COMMENTS' | 'NEWEST_FIRST') {
  if (sending.value || editing.value) return;
  if (!props.changeSort?.(value)) message.value = 'Could not change comment order. Try again.';
  void nextTick(changed);
}
function keydown(event: KeyboardEvent) {
  // Keep editing keys inside the composer; Escape cancels before closing the drawer.
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  else if (event.target === input.value && event.key !== 'Tab') event.stopPropagation();
}
watch([editing, () => !!text.value.trim(), sending, () => state.value?.posting, () => props.status?.loading], () => { void nextTick(changed); });
onBeforeUnmount(() => { disposed = true; ++generation; });
defineExpose({ reply: (key: string) => begin(key) });
</script>
<template>
  <div v-if="state" ref="root" class="comment-actions" @keydown="keydown">
    <div class="comment-toolbar" role="group" :aria-label="t('Comment order')">
      <button class="control" data-focus-id="comments:top" :aria-pressed="state.sort === 'TOP_COMMENTS'" :disabled="!state.sortAvailable || status?.loading || sending || editing" @click="sort('TOP_COMMENTS')">{{ t('Top comments') }}</button>
      <button class="control" data-focus-id="comments:newest" :aria-pressed="state.sort === 'NEWEST_FIRST'" :disabled="!state.sortAvailable || status?.loading || sending || editing" @click="sort('NEWEST_FIRST')">{{ t('Newest first') }}</button>
      <button v-if="!editing" class="control" data-comment-write data-focus-id="comments:write" :disabled="!state.canPost || state.posting" @click="begin()">{{ t('Write a comment') }}</button>
    </div>
    <p v-if="!state.signedIn" class="comment-compose-note">{{ t('Sign in to comment or reply.') }}</p>
    <p v-else-if="!state.canPost && !status?.loading && !editing" class="comment-compose-note">{{ t('Commenting is unavailable for this video.') }}</p>
    <form v-if="editing" class="comment-composer" @submit.prevent="submit">
      <label :for="replyKey ? 'ytg-reply-text' : 'ytg-comment-text'">{{ t(replyKey ? 'Write a reply' : 'Write a comment') }}</label>
      <textarea :id="replyKey ? 'ytg-reply-text' : 'ytg-comment-text'" ref="input" v-model="text" data-focus-id="comments:draft" maxlength="4000" rows="3" :disabled="sending" />
      <div class="comment-compose-buttons">
        <button type="button" class="control" data-comment-cancel data-focus-id="comments:cancel" :disabled="sending" @click="cancel">{{ t('Cancel') }}</button>
        <button type="submit" class="control" data-focus-id="comments:send" :disabled="sending || !text.trim()">{{ t(sending ? 'Sending…' : replyKey ? 'Send reply' : 'Post comment') }}</button>
      </div>
    </form>
    <p v-if="message" role="status">{{ t(message) }}</p>
  </div>
</template>
