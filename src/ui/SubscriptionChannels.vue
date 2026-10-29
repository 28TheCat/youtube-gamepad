<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SubscribedChannel } from '../shared/sidebar-data';
import { useI18n } from '../shared/use-i18n';
import ChannelAvatar from './ChannelAvatar.vue';
import InterfaceIcon from './InterfaceIcon.vue';

const props = defineProps<{ route: string; channels: readonly SubscribedChannel[]; openRoute: (href: string) => boolean }>();
const emit = defineEmits<{ changed: []; browsing: [active: boolean] }>();
const { t } = useI18n();
let pendingChannel = '';
const browsing = ref(false);
const contextKey = 'ytGamepadSubscriptionBrowse';
const pathname = computed(() => new URL(props.route || '/', location.origin).pathname);
const channelId = computed(() => pathname.value.match(/^\/channel\/(UC[\w-]+)(?:\/|$)/)?.[1]);
const visible = computed(() => pathname.value === '/feed/subscriptions' || browsing.value);
function syncContext() {
  const route = location.pathname + location.search;
  if (pendingChannel === route) {
    history.replaceState({ ...history.state, [contextKey]: route }, '');
    pendingChannel = '';
  }
  browsing.value = !!pendingChannel || history.state?.[contextKey] === route;
  emit('browsing', browsing.value);
}
function label(channel: SubscribedChannel) {
  const status = channel.isLive ? t('Live') : channel.hasNewContent ? t('New content') : '';
  return status ? `${channel.label} · ${status}` : channel.label;
}
function open(href: string, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  if (href === location.pathname + location.search) { event.preventDefault(); return; }
  pendingChannel = href === '/feed/subscriptions' ? '' : href;
  emit('browsing', !!pendingChannel);
  if (props.openRoute(href)) { event.preventDefault(); syncContext(); }
  else { pendingChannel = ''; syncContext(); }
}
watch(() => [visible.value, props.channels], () => emit('changed'), { flush: 'post' });
watch(() => props.route, syncContext);
onMounted(() => {
  syncContext();
  document.addEventListener('yt-navigate-finish', syncContext);
  window.addEventListener('popstate', syncContext);
});
onBeforeUnmount(() => {
  document.removeEventListener('yt-navigate-finish', syncContext);
  window.removeEventListener('popstate', syncContext);
});
</script>

<template>
  <div class="browse-page-content">
    <aside v-if="visible" id="ytg-subscription-channels" :aria-label="t('Subscribed channels')">
      <div class="subscription-heading"><InterfaceIcon name="subscriptions" /><span>{{ t('Subscribed channels') }}</span></div>
      <nav id="ytg-subscription-channel-links" :aria-label="t('Subscribed channels')">
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
