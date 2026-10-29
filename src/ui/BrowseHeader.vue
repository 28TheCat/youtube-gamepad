<script setup lang="ts">
import InterfaceIcon from './InterfaceIcon.vue';
import youtubeIcon from '../../assets/brand/youtube-icon.svg?inline';
import BrowseModeSwitch from './BrowseModeSwitch.vue';
import AccountPage from './AccountPage.vue';
import type { mountBrowseMode } from './browse-mode';
const props = defineProps<{ browseMode: ReturnType<typeof mountBrowseMode>; refreshHome?: () => void; refreshNavigation?: () => void; focusAccount?: (node: HTMLElement) => void }>();
import { useI18n } from '../shared/use-i18n';
import { createPageClient } from '../bridge/page-client';
import { ui } from './ui-api';
import type { AccountSnapshot } from '../sites/youtube-account';
import type { NotificationSnapshot } from '../sites/youtube-notifications';
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useBrowseStore } from '../app/browse-store';
const store = useBrowseStore();
const { t } = useI18n();
const account = ref<AccountSnapshot>();
const accountLoading = ref(false), accountFailed = ref(false);
const currentAccount = computed(() => account.value?.accounts.find(item => item.selected));
const accountAvatar = computed(() => currentAccount.value?.avatar || '');
const accountName = computed(() => currentAccount.value?.name || '');
const page = createPageClient();
const notifications = ref<NotificationSnapshot>();
const notificationOpen = ref(false), notificationLoading = ref(false), notificationFailed = ref(false);
const notificationButton = ref<HTMLElement>();
let notificationQueue = Promise.resolve(), notificationGeneration = 0;
function loadNotifications(mode: 'count' | 'list' | 'more') {
  const version = ++notificationGeneration;
  if (mode !== 'count') { notificationLoading.value = true; notificationFailed.value = false; }
  notificationQueue = notificationQueue.catch(() => {}).then(async () => {
    if (disposed || version !== notificationGeneration) return;
    const value = await page.readNotifications?.(mode);
    if (disposed || version !== notificationGeneration) return;
    if (value) {
      notifications.value = value;
      if (mode === 'list' && value.signedIn) {
        try {
          const updated = await page.readNotifications?.('count');
          if (!disposed && version === notificationGeneration && updated) notifications.value = updated;
        } catch { /* The loaded list remains usable if the count fails. */ }
      }
    } else if (mode !== 'count') notificationFailed.value = true;
  }).catch(() => { if (!disposed && version === notificationGeneration && mode !== 'count') notificationFailed.value = true; })
    .finally(() => { if (!disposed && version === notificationGeneration) { notificationLoading.value = false; void nextTick(refresh); } });
}
function showNotifications() {
  if (ui.state.openPanels.some(id => id === 'settings' || id === 'search' || id === 'account')) return false;
  notificationOpen.value = true; loadNotifications('list');
  void nextTick().then(() => {
    if (disposed || !notificationOpen.value) return;
    refresh();
    const root = notificationButton.value?.getRootNode() as Document | ShadowRoot | undefined;
    const button = root?.querySelector<HTMLElement>('#ytg-notifications-close');
    if (button) focus(button);
  });
}
function closeNotifications(restore = true) {
  notificationOpen.value = false; ++notificationGeneration; notificationLoading.value = false;
  restoreHeaderFocus(notificationButton.value, restore);
  loadNotifications('count');
}
function openNotification(href: string) {
  if (!href) return;
  closeNotifications(false);
  if (!page.openBrowseRoute?.(href)) location.assign(href);
}
let disposed = false, generation = 0;
async function loadAccount(force = false) {
  if (disposed || accountLoading.value && !force) return;
  const version = ++generation; accountLoading.value = true; accountFailed.value = false;
  try {
    const value = await page.readAccount?.(force);
    if (disposed || version !== generation) return;
    account.value = value; accountFailed.value = !value;
  } catch { if (!disposed && version === generation) { account.value = undefined; accountFailed.value = true; } }
  finally { if (!disposed && version === generation) { accountLoading.value = false; if (accountOpen.value) void nextTick(refresh); } }
}
const reloadAccount = () => { void loadAccount(true); };
const avatarFailed = ref(false);
const accountOpen = ref(false);
const accountButton = ref<HTMLElement>();
const refresh = () => props.refreshNavigation?.();
const focus = (node: HTMLElement) => props.focusAccount ? props.focusAccount(node) : node.focus();
function restoreHeaderFocus(button: HTMLElement | undefined, restore: boolean) {
  void nextTick().then(() => {
    if (disposed) return;
    refresh();
    if (restore && button?.isConnected && !ui.state.openPanels.length) focus(button);
  });
}
function showAccount() {
  if (ui.state.openPanels.some(id => id === 'settings' || id === 'search' || id === 'notifications')) return false;
  accountOpen.value = true; reloadAccount();
}
function closeAccount(restore = true) {
  accountOpen.value = false;
  restoreHeaderFocus(accountButton.value, restore);
}
const routeChanged = () => { closeAccount(false); if (notificationOpen.value) closeNotifications(false); };
watch(accountAvatar, () => { avatarFailed.value = false; });
const home = () => { props.refreshHome?.(); if (location.pathname === '/' && props.refreshHome) return; if (!page.openBrowseRoute?.('/')) location.assign('/'); };
const releases: (() => void)[] = [];
onMounted(() => {
  releases.push(ui.registerPanel('account', { isOpen: () => accountOpen.value,
    open: showAccount, close: () => closeAccount() }));
  releases.push(ui.registerFocus('account', () => {
    if (!accountButton.value?.isConnected || ui.state.openPanels.length) return false;
    focus(accountButton.value);
    return (accountButton.value.getRootNode() as Document | ShadowRoot).activeElement === accountButton.value;
  }));
  releases.push(ui.registerPanel('notifications', { isOpen: () => notificationOpen.value, open: showNotifications, close: () => closeNotifications() }));
  loadNotifications('count');
  void loadAccount();
  document.addEventListener('yt-navigate-start', routeChanged);
  document.addEventListener('yt-navigate-finish', reloadAccount);
  document.addEventListener('yt-navigate-finish', reloadNotifications);
  document.addEventListener('yt-page-data-updated', reloadAccount);
  window.addEventListener('focus', reloadAccount);
  window.addEventListener('focus', reloadNotifications);
});
const reloadNotifications = () => { if (!notificationOpen.value) loadNotifications('count'); };
onBeforeUnmount(() => {
  for (const release of releases) release();
  disposed = true; ++generation; page.destroy?.();
  document.removeEventListener('yt-navigate-start', routeChanged);
  document.removeEventListener('yt-navigate-finish', reloadAccount);
  document.removeEventListener('yt-navigate-finish', reloadNotifications);
  document.removeEventListener('yt-page-data-updated', reloadAccount);
  window.removeEventListener('focus', reloadAccount);
  window.removeEventListener('focus', reloadNotifications);
  document.documentElement.classList.remove('ytg-account-open');
});
</script>

<template>
  <header id="ytg-browse-top">
    <div v-if="store.refreshing" class="home-loading-line" aria-hidden="true"></div>
    <button class="client-brand" type="button" :aria-label="t('首页')" @click="home">
      <img class="youtube-brand-icon" :src="youtubeIcon" alt="" width="32" height="22" />
      <span>YouTube <small>Gamepad</small></span>
    </button>
    <div id="ytg-client-search"></div>
    <BrowseModeSwitch :state="browseMode.state" :change="browseMode.change" />
    <button ref="notificationButton" class="notification-entry" type="button" :aria-label="t('Notification center')" aria-haspopup="dialog" :aria-expanded="notificationOpen" @click="ui.openPanel('notifications')">
      <InterfaceIcon name="bell" /><span v-if="notifications?.count" class="notification-count">{{ notifications.count > 99 ? '99+' : notifications.count }}</span>
    </button>
    <button ref="accountButton" :title="accountName" class="client-account" :class="{ 'has-avatar': accountAvatar && !avatarFailed }" type="button" :aria-label="t('Account')" aria-haspopup="dialog" :aria-expanded="accountOpen" @click="ui.openPanel('account')">
      <img v-if="accountAvatar && !avatarFailed" :src="accountAvatar" alt="" @error="avatarFailed = true" />
      <InterfaceIcon v-else name="person" />
    </button>
  </header>
  <AccountPage v-if="accountOpen" :snapshot="account" :loading="accountLoading" :failed="accountFailed" :retry="reloadAccount" :refresh="refresh" :focus="focus" @close="ui.closePanel('account')" />
  <section v-if="notificationOpen" id="ytg-notifications-page" role="dialog" aria-modal="true" :aria-label="t('Notification center')" @keydown.esc.stop.prevent="ui.closePanel('notifications')">
    <div class="notification-layout">
      <header class="notification-heading"><button id="ytg-notifications-close" type="button" @click="ui.closePanel('notifications')">{{ t('Back') }}</button><h1>{{ t('Notification center') }}</h1></header>
      <p v-if="notificationLoading && !notifications?.items.length" role="status">{{ t('Loading…') }}</p>
      <div v-if="notificationFailed" role="status"><p>{{ t('Could not load notifications.') }}</p><button type="button" @click="loadNotifications('list')">{{ t('Retry') }}</button></div>
      <p v-else-if="!notificationLoading && notifications && !notifications.signedIn">{{ t('Sign in to see notifications.') }}</p>
      <p v-else-if="!notificationLoading && notifications && !notifications.items.length">{{ t('No notifications yet.') }}</p>
      <div v-if="notifications?.signedIn" class="notification-list">
        <button v-for="item in notifications.items" :key="item.id" class="notification-item" :class="{ unread: !item.read }" :disabled="!item.href" type="button" @click="openNotification(item.href)">
          <img v-if="item.avatar" class="notification-avatar" :src="item.avatar" alt="" referrerpolicy="no-referrer" /><span v-else class="notification-avatar"></span>
          <span class="notification-text">{{ item.text }}<small>{{ item.time }}</small></span>
          <img v-if="item.thumbnail" class="notification-thumbnail" :src="item.thumbnail" alt="" referrerpolicy="no-referrer" />
        </button>
        <button v-if="notifications.hasMore" type="button" :disabled="notificationLoading" @click="loadNotifications('more')">{{ t(notificationLoading ? 'Loading…' : 'Load more') }}</button>
      </div>
    </div>
  </section>
</template>
