<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Directive } from 'vue';
import { useI18n } from '../shared/use-i18n';
import LoadStatus from './LoadStatus.vue';
import { commentLanguage } from '../shared/comment-language';
import type { CommentSnapshot, CommentReplySnapshot, ControllerStyle } from '../../types/ports';
const props = defineProps<{
  item: CommentSnapshot | CommentReplySnapshot;
  controllerStyle: ControllerStyle;
  openThread?: (key: string) => void;
  translate?: (key: string) => void;
  focusKey?: string;
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
const failedAvatar = ref('');
const key = computed(() => props.focusKey || props.item.key);
const canOpen = computed(() => !!props.openThread && 'replies' in props.item && (props.item.hasReplies || props.item.replies.length > 0));
const replyLabel = computed(() => 'replyCount' in props.item && props.item.replyCount
  ? t('View {count} replies', { count: props.item.replyCount }) : t('View replies'));
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
        <span class="comment-author">{{ item.author || t('Reply') }}</span>
      </div>
      <div class="comment-body">
        <component :is="canOpen ? 'button' : 'p'" class="comment-text" :data-focus-id="`comment:${key}`"
          :tabindex="canOpen ? undefined : 0" :lang="translated ? target : undefined"
          @click="canOpen && openThread?.(item.key)">{{ translated ? translation?.text : item.text }}</component>
        <button v-if="translate && target" class="comment-translate" :data-focus-id="`translate:${key}`" :disabled="translation?.loading"
          :aria-pressed="translated" @click="toggleTranslation">{{ translation?.loading ? t('Translating…') : translated ? t('Show original') : translation?.failed ? t('Retry translation') : t('Translate to {language}', { language: targetName }) }}</button>
        <LoadStatus class="translation-error" :failed="translation?.failed" error-role="status"
          :error-message="t('Translation unavailable. Original text is still shown.')" />
      </div>
      <button v-if="reply && 'canReply' in item && item.canReply" class="comment-reply-action" :data-focus-id="`reply:${item.key}`" @click="reply(item.key)">{{ t('Reply') }}</button>
      <button v-if="canOpen" class="comment-replies" :data-focus-id="`replies:${item.key}`" @click="openThread?.(item.key)">
        <span class="comment-expand-hint key-controller-badge" aria-hidden="true"><span v-badge></span></span>
        <span class="comment-replies-label">{{ replyLabel }}</span>
        <span class="comment-replies-chevron" aria-hidden="true"></span>
      </button>
    </div>
  </article>
</template>
