<script setup lang="ts">
import InterfaceIcon from './InterfaceIcon.vue';
import { resolveExplorePage } from '../shared/explore-pages';
import { useI18n } from '../shared/use-i18n';
const { t } = useI18n();
import { defaultSidebar, type SidebarEntry, type SubscribedChannel } from '../shared/sidebar-data';
import { createPageClient } from '../bridge/page-client';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
const props = defineProps<{ route: string; refreshHome?: () => void }>();
const emit = defineEmits<{ changed: []; settings: [] }>();
type Entry = SidebarEntry;
const personalOpen = ref(true), exploreOpen = ref(!!resolveExplorePage(props.route));
const fallback = defaultSidebar();
const personal = ref<Entry[]>(fallback.personal), explore = ref<Entry[]>(fallback.explore);
const subscriptions = ref<SubscribedChannel[]>([]), subscriptionsOpen = ref(true);
const failedAvatars = ref(new Set<string>());
const page = createPageClient();
let disposed = false, generation = 0;
const primary: Entry[] = [
  { id: 'home', label: '首页', href: '/', icon: 'home' },
  { id: 'subscriptions', label: '订阅', href: '/feed/subscriptions', icon: 'subscriptions' }
];
const current = computed(() => new URL(props.route || location.pathname + location.search, location.origin));
function selectedChannel(channel: SubscribedChannel) {
  return current.value.pathname === `/channel/${channel.id}` || current.value.pathname.startsWith(`/channel/${channel.id}/`);
}
const subscriptionPage = computed(() => current.value.pathname === '/feed/subscriptions' || subscriptions.value.some(selectedChannel));
function active(href: string) {
  const target = new URL(href, location.origin);
  const topic = resolveExplorePage(href);
  if (topic && topic.id === resolveExplorePage(props.route)?.id) return true;
  return target.origin === current.value.origin && target.pathname === current.value.pathname && target.search === current.value.search;
}
async function readLinks() {
  const version = ++generation;
  try {
    const snapshot = await page.readSidebar?.();
    if (disposed || version !== generation) return;
    const value = snapshot || defaultSidebar();
    personal.value = value.personal; explore.value = value.explore;
    subscriptions.value = value.subscriptions || [];
    await nextTick(); if (!disposed) emit('changed');
  } catch { /* Built-in links remain available while the API is unavailable. */ }
}
function open(entry: Pick<Entry, 'id' | 'href'>, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  if (entry.href.startsWith('https:')) return;
  if (entry.id === 'home') {
    props.refreshHome?.();
    if (location.pathname === '/' && props.refreshHome) { event.preventDefault(); return; }
  }
  if (entry.href === location.pathname + location.search || page.openBrowseRoute?.(entry.href)) event.preventDefault();
}
async function toggle(group: 'personal' | 'explore' | 'subscriptions') {
  if (group === 'personal') personalOpen.value = !personalOpen.value;
  else if (group === 'subscriptions') subscriptionsOpen.value = !subscriptionsOpen.value;
  else exploreOpen.value = !exploreOpen.value;
  await nextTick(); emit('changed');
}
const reload = () => { void readLinks(); };
onMounted(() => {
  reload();
  document.addEventListener('yt-navigate-finish', reload);
  document.addEventListener('yt-page-data-updated', reload);
  window.addEventListener('focus', reload);
});
watch(() => props.route, () => { if (resolveExplorePage(props.route)) exploreOpen.value = true; });
onBeforeUnmount(() => {
  disposed = true; ++generation; page.destroy?.();
  document.removeEventListener('yt-navigate-finish', reload);
  document.removeEventListener('yt-page-data-updated', reload);
  window.removeEventListener('focus', reload);
});
</script>
<template>
  <nav id="ytg-browse-sidebar" :data-subscription-page="subscriptionPage || undefined" :aria-label="t('侧边目录')" @transitionend.self="emit('changed')">
    <a v-for="entry in primary" :key="entry.id" :href="entry.href" :data-sidebar-id="entry.id"
      :aria-label="t(entry.label)" :title="t(entry.label)" :aria-current="active(entry.href) ? 'page' : undefined" @click="open(entry, $event)">
      <InterfaceIcon :name="entry.icon" :filled="active(entry.href)" /><span>{{ t(entry.label) }}</span>
    </a>
    <section v-if="subscriptions.length" class="sidebar-subscriptions">
      <button id="ytg-sidebar-subscriptions" data-sidebar-id="subscribed-channels" type="button" :aria-expanded="subscriptionsOpen"
        :aria-label="t('订阅')" :title="t('订阅')" aria-controls="ytg-sidebar-subscription-links" @click="toggle('subscriptions')">
        <InterfaceIcon name="subscriptions" /><span>{{ t('订阅') }}</span>
        <InterfaceIcon name="right" class="sidebar-chevron" :class="{ expanded: subscriptionsOpen }" />
      </button>
      <div id="ytg-sidebar-subscription-links" class="sidebar-group" :data-open="subscriptionsOpen"
        :inert="!subscriptionsOpen" :aria-hidden="!subscriptionsOpen" @transitionend.self="emit('changed')"><div class="sidebar-group-content">
        <a v-for="channel in subscriptions" :key="channel.id" :href="channel.href" :data-sidebar-id="`subscription:${channel.id}`"
          :aria-label="channel.label" :title="channel.label" :aria-current="selectedChannel(channel) ? 'page' : undefined" @click="open(channel, $event)">
          <img v-if="channel.avatar && !failedAvatars.has(channel.avatar)" class="sidebar-channel-avatar" :src="channel.avatar" alt="" loading="lazy"
            @error="failedAvatars.add(channel.avatar!)" />
          <span v-else class="sidebar-channel-avatar sidebar-channel-initial" aria-hidden="true">{{ Array.from(channel.label)[0] }}</span>
          <span>{{ channel.label }}</span>
        </a>
      </div></div>
    </section>
    <section>
      <button id="ytg-sidebar-personal" data-sidebar-id="personal" type="button" :aria-expanded="personalOpen"
        :aria-label="t('我的频道')" :title="t('我的频道')" aria-controls="ytg-sidebar-personal-links" @click="toggle('personal')">
        <InterfaceIcon name="person" :filled="personalOpen" /><span>{{ t("我的频道") }}</span>
        <InterfaceIcon name="right" class="sidebar-chevron" :class="{ expanded: personalOpen }" />
      </button>
      <div id="ytg-sidebar-personal-links" class="sidebar-group" :data-open="personalOpen"
        :inert="!personalOpen" :aria-hidden="!personalOpen" @transitionend.self="emit('changed')"><div class="sidebar-group-content">
        <a v-for="entry in personal" :key="entry.id" :href="entry.href" :data-sidebar-id="entry.id"
          :target="entry.href.startsWith('https://studio.') ? '_blank' : undefined" rel="noopener"
          :aria-label="t(entry.label)" :title="t(entry.label)" :aria-current="active(entry.href) ? 'page' : undefined" @click="open(entry, $event)">
          <InterfaceIcon :name="entry.icon" :filled="active(entry.href)" /><span>{{ t(entry.label) }}</span>
        </a>
      </div></div>
    </section>
    <section>
      <button id="ytg-sidebar-explore" data-sidebar-id="explore" type="button" :aria-expanded="exploreOpen"
        :aria-label="t('探索')" :title="t('探索')" aria-controls="ytg-sidebar-explore-links" @click="toggle('explore')">
        <InterfaceIcon name="explore" :filled="exploreOpen" /><span>{{ t("探索") }}</span>
        <InterfaceIcon name="right" class="sidebar-chevron" :class="{ expanded: exploreOpen }" />
      </button>
      <div id="ytg-sidebar-explore-links" class="sidebar-group" :data-open="exploreOpen"
        :inert="!exploreOpen" :aria-hidden="!exploreOpen" @transitionend.self="emit('changed')"><div class="sidebar-group-content">
        <a v-for="entry in explore" :key="entry.id" :href="entry.href" :data-sidebar-id="entry.id"
          :aria-label="t(entry.label)" :title="t(entry.label)" :aria-current="active(entry.href) ? 'page' : undefined" @click="open(entry, $event)">
          <InterfaceIcon name="explore" :filled="active(entry.href)" /><span>{{ t(entry.label) }}</span>
        </a>
      </div></div>
    </section>
    <section>
      <button id="ytg-sidebar-settings" data-sidebar-id="settings" type="button"
        :aria-label="t('Settings')" :title="t('Settings')" aria-haspopup="dialog" @click="emit('settings')">
        <InterfaceIcon name="settings" />
        <span>{{ t('Settings') }}</span>
      </button>
    </section>
  </nav>
</template>
