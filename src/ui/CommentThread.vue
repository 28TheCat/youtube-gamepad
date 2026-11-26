<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Directive } from 'vue';
import { useI18n } from '../shared/use-i18n';
import InterfaceIcon from './InterfaceIcon.vue';
import LoadStatus from './LoadStatus.vue';
import { commentLanguage } from '../shared/comment-language';
import type { CommentSnapshot, CommentReplySnapshot, ControllerStyle } from '../../types/ports';
const props = defineProps<{
  item: CommentSnapshot | CommentReplySnapshot;
  controllerStyle: ControllerStyle;
  openThread?: (key: string) => void;
  translate?: (key: string) => void;
  focusKey?: string;
  like?: (key: string) => Promise<boolean>;
  reply?: (key: string) => void;
}>();
const { t, language } = useI18n();
const vBadge: Directive<HTMLElement> = {
  mounted(node) { props.controllerStyle.badge(node, 'A'); }
};
const original = ref(false);
const target = computed(() => commentLanguage(props.item.translationTarget));
const targetName = computed(() => {
  if (!target.value) return '';
  try { return new Intl.DisplayNames([language.value], { type: 'language' }).of(target.value) || target.value; }
  catch { return target.value; }
});
const translation = computed(() => target.value && props.item.translation?.language === target.value ? props.item.translation : undefined);
const translated = computed(() => !original.value && !!translation.value?.text);
function toggleTranslation() {
  if (translation.value?.text) original.value = !original.value;
  else { original.value = false; props.translate?.(props.item.key); }
}
const liking = ref(false), likeFailed = ref(false);
async function toggleLike() {
  if (!props.like || !props.item.canLike || liking.value) return;
  liking.value = true; likeFailed.value = false;
  try { likeFailed.value = await props.like(props.item.key) !== true; } catch { likeFailed.value = true; }
  finally { liking.value = false; }
}
const failedAvatar = ref('');
const key = computed(() => props.focusKey || props.item.key);
const canOpen = computed(() => !!props.openThread && 'replies' in props.item && (props.item.hasReplies || props.item.replies.length > 0));
const replyLabel = computed(() => 'replyCount' in props.item && props.item.replyCount
  ? t(props.item.replyCount === 1 ? 'View 1 reply' : 'View {count} replies', { count: props.item.replyCount }) : t('View replies'));
</script>

<template>
  <article class="comment-thread" :class="{ 'comment-reply': focusKey }">
    <span class="comment-avatar" aria-hidden="true">
      <img v-if="item.avatar && failedAvatar !== item.avatar" :key="item.avatar" :src="item.avatar" alt=""
        loading="lazy" referrerpolicy="no-referrer" @error="failedAvatar = item.avatar || ''" />
      <template v-else>{{ Array.from(item.author.trim())[0] || '·' }}</template>
    </span>
    <div class="comment-main">
      <div class="comment-header">
        <span class="comment-author" :title="item.author">{{ item.author || t('Reply') }}</span>
        <span v-if="item.publishedTime" class="comment-published">· {{ item.publishedTime }}</span>
        <span v-if="item.replyTo" class="comment-reply-target">{{ t('Replying to {author}', { author: item.replyTo }) }}</span>
      </div>
      <div class="comment-body">
        <p class="comment-text" :data-focus-id="`comment:${key}`" tabindex="0"
          :lang="translated ? target : undefined">{{ translated ? translation?.text : item.text }}</p>
        <button v-if="translate && target" class="comment-translate" :data-focus-id="`translate:${key}`" :disabled="translation?.loading"
          :aria-pressed="translated" @click="toggleTranslation">{{ translation?.loading ? t('Translating…') : translated ? t('Show original') : translation?.failed ? t('Retry translation') : t('Translate to {language}', { language: targetName }) }}</button>
        <LoadStatus class="translation-error" :failed="translation?.failed" error-role="status"
          :error-message="t('Translation unavailable. Original text is still shown.')" />
      </div>
      <div class="comment-footer">
        <button class="comment-likes" :data-focus-id="`comment-like:${key}`" :aria-label="t('Like')" :aria-pressed="item.liked === true" :disabled="!like || !item.canLike || liking" @click="toggleLike"><InterfaceIcon name="like" :filled="item.liked" /><span v-if="item.likeCount">{{ item.likeCount }}</span></button>
        <span v-if="likeFailed" role="status">{{ t('Could not update like. Try again.') }}</span>
        <button v-if="canOpen" class="comment-replies" :data-focus-id="`replies:${item.key}`" :aria-label="replyLabel" @click="openThread?.(item.key)">
          <span class="comment-expand-hint key-controller-badge" aria-hidden="true"><span v-badge></span></span>
          <InterfaceIcon name="comments" /><span class="comment-replies-label">{{ replyLabel }}</span>
        </button>
        <button v-if="reply && 'canReply' in item && item.canReply" class="comment-reply-action" :data-focus-id="`reply:${item.key}`" @click="reply(item.key)">{{ t('Reply') }}</button>
      </div>
    </div>
  </article>
</template>
