<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { SidebarEntry } from '../shared/sidebar-data';
import { resolveExplorePage } from '../shared/explore-pages';
import { useI18n } from '../shared/use-i18n';
import ChannelAvatar from './ChannelAvatar.vue';
import InterfaceIcon from './InterfaceIcon.vue';
defineProps<{ entries: SidebarEntry[]; route: string }>();
const emit = defineEmits<{ open: [entry: SidebarEntry, event: MouseEvent]; changed: [] }>();
const { t } = useI18n();
const expanded = ref<Record<string, boolean>>({});
const isOpen = (entry: SidebarEntry) => expanded.value[entry.id] ?? entry.expanded ?? false;
const label = (entry: SidebarEntry) => entry.id === 'subscriptions' ? t('Subscribed channels') : entry.label;
function active(href: string, route: string) {
  const topic = resolveExplorePage(href);
  if (topic && topic.id === resolveExplorePage(route)?.id) return true;
  return !!href && new URL(href, location.origin).href === new URL(route, location.origin).href;
}
async function toggle(entry: SidebarEntry) {
  expanded.value[entry.id] = !isOpen(entry);
  await nextTick(); emit('changed');
}
</script>
<template>
  <template v-for="entry in entries" :key="entry.id">
    <div v-if="entry.children" class="sidebar-branch">
      <div class="sidebar-branch-heading">
        <a v-if="entry.href" :href="entry.href" :data-sidebar-id="entry.id" :title="label(entry)"
          :aria-current="active(entry.href, route) ? 'page' : undefined" @click="emit('open', entry, $event)">
          <InterfaceIcon :name="entry.icon" /><span>{{ label(entry) }}</span>
        </a>
        <button :id="`ytg-sidebar-${entry.id}`" type="button" :data-sidebar-id="`${entry.id}:toggle`"
          :aria-label="label(entry)" :title="label(entry)" :aria-expanded="isOpen(entry)"
          :aria-controls="`ytg-sidebar-${entry.id}-links`" @click="toggle(entry)">
          <InterfaceIcon v-if="!entry.href" :name="entry.icon" /><span v-if="!entry.href">{{ label(entry) }}</span>
          <InterfaceIcon name="right" class="sidebar-chevron" :class="{ expanded: isOpen(entry) }" />
        </button>
      </div>
      <div :id="`ytg-sidebar-${entry.id}-links`" class="sidebar-group" :data-open="isOpen(entry)"
        :inert="!isOpen(entry)" :aria-hidden="!isOpen(entry)" @transitionend.self="emit('changed')">
        <div class="sidebar-group-content">
          <SidebarLinks :entries="entry.children" :route="route" @open="(item, event) => emit('open', item, event)" @changed="emit('changed')" />
        </div>
      </div>
    </div>
    <a v-else :href="entry.href" :data-sidebar-id="entry.id" :title="label(entry)" :aria-label="label(entry)"
      :aria-current="active(entry.href, route) ? 'page' : undefined"
      :target="entry.href.startsWith('https:') ? '_blank' : undefined" rel="noopener" @click="emit('open', entry, $event)">
      <ChannelAvatar v-if="entry.avatar || entry.id.startsWith('subscription:')" :src="entry.avatar" :name="entry.label" :size="24" />
      <InterfaceIcon v-else :name="entry.icon" :filled="active(entry.href, route)" /><span>{{ label(entry) }}</span>
      <InterfaceIcon v-if="entry.isLive" name="live" class="sidebar-status sidebar-channel-live" />
      <InterfaceIcon v-else-if="entry.hasNewContent" name="new-content" :filled="true" class="sidebar-status sidebar-channel-new" />
    </a>
  </template>
</template>
