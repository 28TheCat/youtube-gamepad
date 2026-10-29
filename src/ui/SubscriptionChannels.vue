<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createPageClient } from '../bridge/page-client';
import type { SubscribedChannel } from '../shared/sidebar-data';
import { useI18n } from '../shared/use-i18n';
import ChannelAvatar from './ChannelAvatar.vue';
import InterfaceIcon from './InterfaceIcon.vue';

const props = defineProps<{ route: string }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const page = createPageClient();
const channels = ref<SubscribedChannel[]>([]), expanded = ref(false);
let disposed = false, generation = 0;
const pathname = computed(() => new URL(props.route || '/', location.origin).pathname);
const channelId = computed(() => pathname.value.match(/^\/channel\/(UC[\w-]+)(?:\/|$)/)?.[1]);
const visible = computed(() => pathname.value === '/feed/subscriptions' || channels.value.some(channel => channel.id === channelId.value));
function label(channel: SubscribedChannel) {
  const status = channel.isLive ? t('Live') : channel.hasNewContent ? t('New content') : '';
  return status ? `${channel.label} · ${status}` : channel.label;
}
async function read() {
  const version = ++generation;
  try {
    const snapshot = await page.readSidebar?.();
    if (!disposed && version === generation) channels.value = snapshot?.subscriptions || [];
  } catch { /* Keep the previous list through a temporary guide failure. */ }
}
function open(href: string, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  if (href === location.pathname + location.search || page.openBrowseRoute?.(href)) event.preventDefault();
}
watch(() => [visible.value, expanded.value, channels.value], async () => { await nextTick(); if (!disposed) emit('changed'); }, { flush: 'post' });
onMounted(() => {
  void read();
  document.addEventListener('yt-navigate-finish', read);
  document.addEventListener('yt-page-data-updated', read);
  window.addEventListener('focus', read);
});
onBeforeUnmount(() => {
  disposed = true; ++generation; page.destroy?.();
  document.removeEventListener('yt-navigate-finish', read);
  document.removeEventListener('yt-page-data-updated', read);
  window.removeEventListener('focus', read);
});
</script>

<template>
  <div class="browse-page-content">
    <aside v-if="visible" id="ytg-subscription-channels" :data-expanded="expanded" :aria-label="t('Following channels')">
      <button id="ytg-subscription-toggle" type="button" :aria-expanded="expanded" aria-controls="ytg-subscription-channel-links"
        :aria-label="t('Following channels')" :title="t('Following channels')" @click="expanded = !expanded">
        <InterfaceIcon name="subscriptions" /><span v-if="expanded">{{ t('Following channels') }}</span>
        <InterfaceIcon v-if="expanded" name="right" class="subscription-chevron" />
      </button>
      <nav id="ytg-subscription-channel-links" v-show="expanded" :aria-label="t('Following channels')">
        <a href="/feed/subscriptions" data-subscription-id="all" :aria-current="!channelId ? 'page' : undefined"
          @click="open('/feed/subscriptions', $event)"><InterfaceIcon name="subscriptions" /><span>{{ t('All') }}</span></a>
        <a v-for="channel in channels" :key="channel.id" :href="channel.href" :data-subscription-id="channel.id"
          :aria-label="label(channel)" :title="label(channel)" :aria-current="channel.id === channelId ? 'page' : undefined" @click="open(channel.href, $event)">
          <ChannelAvatar :src="channel.avatar" :name="channel.label" :size="40" />
          <span class="subscription-channel-name">{{ channel.label }}</span>
          <InterfaceIcon v-if="channel.isLive" name="live" class="subscription-channel-status subscription-channel-live" />
          <InterfaceIcon v-else-if="channel.hasNewContent" name="new-content" :filled="true" class="subscription-channel-status subscription-channel-new" />
        </a>
      </nav>
    </aside>
    <div class="browse-page-feed"><slot /></div>
  </div>
</template>
