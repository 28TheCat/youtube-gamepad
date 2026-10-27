import { createDrawer } from './drawer';
import { createCommentOperations } from './comment-operations';
import { createPlaylistOperations } from './playlist-operations';
import { createWatchActionOperations } from './watch-action-operations';
import { subscriptionOptions } from './subscription-options';
import { mountWatchPanel, backCommentComposer } from './mount-watch-panel';
import type { ModuleFactory, WatchPanels, WatchPanelsPort } from '../../types/ports';
export let YTGamepadWatchPanels!: ModuleFactory<WatchPanelsPort,WatchPanels>;
// Description/comments rendering and data requests through an injected port.
(() => {
  if (YTGamepadWatchPanels) return;
    YTGamepadWatchPanels = {
    /** @param {import('../../types/ports.js').WatchPanelsPort} port */
    create(port: import('../../types/ports.js').WatchPanelsPort) {
    const { dialog, sheet, panelTitle, description, close, surface, watchState, send, focus } = port;
    const { focusManager, controllerStyle } = port;
    const descriptionHeader = port.make('header', 'panel-heading');
    let commentKey = '', commentButtons: HTMLElement[] = [];
    let commentRoute = '';
    const comments = createCommentOperations({
      records: () => port.controller.readComments(), status: () => port.controller.readCommentsStatus?.(),
      replies: key => { port.controller.request('replies', key); }
    });
    let managedFocus = false;
    const drawer = createDrawer({
      element: () => dialog, content: () => sheet,
      activeElement: () => (dialog.getRootNode?.() as ShadowRoot | undefined)?.activeElement as HTMLElement | null,
      route: () => port.controller.readRoute().key,
      items: () => [close, ...commentButtons], index: () => watchState().panelIndex,
      opened(modal) { if (modal && focusManager) { focusManager.open(dialog, 'watch'); managedFocus = true; } },
      cleared: clearPanel,
      restoreReturn(target, restore) {
        if (managedFocus) { focusManager?.close(dialog, restore); managedFocus = false; }
        else if (restore && target?.isConnected && !target.closest('[hidden],[inert]')) target.focus({ preventScroll: true });
      },
      restoreDetail(position) {
        const index = commentButtons.findIndex(button => button.dataset.focusId === position.id);
        send({ type: 'WATCH_FOCUS', region: 'panel', index: index >= 0 ? index + 1 : Math.min(position.index, commentButtons.length) });
        focus();
      }
    });
    let renderer: ReturnType<typeof mountWatchPanel> | undefined;
    let destroyed = false;
    const subscription = createWatchActionOperations({
      request: async action => await port.controller.request('watchAction', action) === true,
      active: () => !destroyed && watchState().panel === 'subscription',
      route: () => port.controller.readRoute().key, changed: paintSubscription
    });
    const playlist = createPlaylistOperations({
      read: async () => await port.controller.request('playlists') as readonly import('../../types/ports').SavedPlaylistSnapshot[] | undefined,
      toggle: async key => !!await port.controller.request('savePlaylist', key),
      active: () => !destroyed && watchState().panel === 'playlists', route: () => port.controller.readRoute().key, changed: paintPlaylists
    });
    function paint(panel: 'description' | 'comments' | 'playlists' | 'subscription', records: readonly import('../../types/ports').CommentSnapshot[] = [], unavailable = false) {
      if (destroyed) return;
      renderer ||= mountWatchPanel(description, controllerStyle, {
        ...comments.callbacks({
          active: () => !destroyed && watchState().panel === 'comments',
          changed() { commentKey = ''; readComments(); }, openThread,
          load: loadComments,
          post: async (text, key) => await port.controller.request('commentPost', { text, key }),
          sort: value => port.controller.request('commentSort', value),
          translate: key => { port.controller.request('translateComment', key); }
        }),
        changed() { commentButtons = renderer?.buttons() || []; send({ type: 'WATCH_PANEL_COUNT', count: commentButtons.length }); },
        subscriptionAction: updateSubscription, savePlaylist: togglePlaylist, retryPlaylists: loadPlaylists
      });
      renderer.update({ panel, text: port.descriptionText, records, unavailable,
        thread: comments.state.thread ? records.find(item => item.key === comments.state.thread) : undefined, replyLimit: comments.state.limit,
        notificationPreference: panel === 'subscription' ? port.controller.readWatchPage().notificationPreference : undefined,
        subscriptionLoading: subscription.state.loading, subscriptionFailed: subscription.state.failed,
        playlists: playlist.state.items, playlistLoading: playlist.state.loading, playlistFailed: playlist.state.failed,
        commentsStatus: port.controller.readCommentsStatus?.(), commentRoute: port.controller.readRoute().key });
      dialog.classList.toggle('thread-detail', panel === 'comments' && !!comments.state.thread);
      commentButtons = panel !== 'description' ? renderer.buttons() : [];
    }
    function positionSubscription() {
      if (watchState().panel !== 'subscription') return;
      const anchor = surface.querySelector<HTMLElement>('[data-action="subscribe"]');
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect(), bounds = dialog.getBoundingClientRect();
      const width = Math.min(260, bounds.width - 16), height = Math.min(sheet.scrollHeight, bounds.height - 16);
      const top = rect.bottom + 8 + height <= bounds.bottom ? rect.bottom + 8 : rect.top - height - 8;
      sheet.style.left = Math.max(8, Math.min(rect.left - bounds.left, bounds.width - width - 8)) + 'px';
      sheet.style.top = Math.max(8, Math.min(top - bounds.top, bounds.height - height - 8)) + 'px';
    }
    function paintSubscription() {
      if (destroyed || watchState().panel !== 'subscription') return;
      paint('subscription'); send({ type: 'WATCH_PANEL_COUNT', count: commentButtons.length });
      positionSubscription();
      if (!port.controller.navigating && !port.controller.hasTemporaryLayer?.()) focus();
    }
    async function updateSubscription(action: import('../../types/ports').WatchAction) {
      if (action !== 'unsubscribe' && !subscriptionOptions.some(option => option.action === action)) return;
      if (await subscription.run(action) === true) { closePanel(); port.controller.requestRefresh?.(); }
    }
    function outsideClick(event: Event) { if (watchState().panel === 'subscription' && event.target === dialog) closePanel(); }
    dialog.addEventListener('click', outsideClick);
    window.addEventListener('resize', positionSubscription);
    window.addEventListener('scroll', positionSubscription, true);
    function paintPlaylists() {
      if (destroyed || watchState().panel !== 'playlists') return;
      paint('playlists'); send({ type: 'WATCH_PANEL_COUNT', count: commentButtons.length });
      if (!port.controller.navigating && !port.controller.hasTemporaryLayer?.()) focus();
    }
    function loadPlaylists() { return playlist.load(); }
    function togglePlaylist(key: string) { return playlist.toggle(key); }
    function unmount() { renderer?.dispose(); renderer = undefined; commentButtons = []; commentKey = ''; }
  function clearPanel() {
    comments.reset();
    subscription.reset();
    playlist.reset();
    // Keep the panel geometry through the discrete display/opacity exit transition.
    // Removing "comments" here turns the fading sidebar into a full-screen backdrop.
    unmount(); send({ type: 'WATCH_PANEL', panel: '' }); surface.classList.remove('comments-open');
    document.documentElement.classList.remove('ytg-comments');
  }
  function closePanel() {
    drawer.close();
  }
  function openThread(key: string) {
    if (destroyed || watchState().panel !== 'comments') return;
    if (!comments.canOpen(key)) return;
    drawer.enterDetail(() => {
      comments.reset();
      controllerStyle.bind(close, 'Back');
      controllerStyle.bind(panelTitle, 'Comments'); controllerStyle.bind(dialog, 'Comments', 'aria-label');
      commentKey = ''; readComments();
    });
    comments.open(key);
    controllerStyle.bind(close, 'Back to comments');
    controllerStyle.bind(panelTitle, 'Replies'); controllerStyle.bind(dialog, 'Replies', 'aria-label');
    send({ type: 'WATCH_FOCUS', region: 'panel', index: 0 });
    commentKey = ''; readComments(); sheet.scrollTop = 0;
  }
  function back() {
    if (backCommentComposer(description)) return true;
    if (destroyed || watchState().panel !== 'comments' || !comments.state.thread) return false;
    return drawer.backDetail();
  }
  function loadReplies() {
    if (destroyed || watchState().panel !== 'comments' || !comments.state.thread || port.controller.readCommentsStatus?.()?.loading) return;
    if (!comments.more()) return;
    commentKey = ''; readComments();
  }
  function readComments() {
    if (destroyed) return;
    if (watchState().panel === 'subscription') { paintSubscription(); return; }
    if (watchState().panel === 'playlists') { paintPlaylists(); return; }
    if (watchState().panel === 'description') { paint('description'); return; }
    if (watchState().panel !== 'comments') return;
    const route = port.controller.readRoute().key;
    if (route !== commentRoute) { commentRoute = route; comments.reset(); drawer.clearDetails(); commentKey = ''; }
    const records = port.controller.readComments();
    const unavailable = port.controller.readWatchFeatures?.().comments === 'failed';
    if (comments.state.thread && !records.some(item => item.key === comments.state.thread)) {
      back(); return;
    }
    const key = JSON.stringify([records, unavailable, port.controller.readCommentsStatus?.(), comments.state.thread, comments.state.limit]);
    if (key === commentKey) return;
    let activeId = ((dialog.getRootNode?.() as ShadowRoot | undefined)?.activeElement as HTMLElement | null)?.dataset.focusId;
    commentKey = key;
    paint('comments', records, unavailable);
    const nextReply = comments.state.nextIndex === undefined ? undefined : records.find(item => item.key === comments.state.thread)?.replies[comments.state.nextIndex];
    if (nextReply) { activeId = 'comment:reply:' + JSON.stringify([comments.state.thread, nextReply.key]); comments.state.nextIndex = undefined; }
    const index = activeId ? commentButtons.findIndex(button => button.dataset.focusId === activeId) : -1;
    if (index >= 0) send({ type: 'WATCH_FOCUS', region: 'panel', index: index + 1 });
    send({ type: 'WATCH_PANEL_COUNT', count: commentButtons.length }); if (!port.controller.navigating && !port.controller.hasTemporaryLayer?.()) focus();
  }
  function loadComments() {
    if (destroyed || watchState().panel !== 'comments') return;
    if (comments.state.thread) { loadReplies(); return; }
    port.controller.request('comments');
  }
  function open(action: string) {
    if (destroyed || (action !== 'description' && action !== 'playlists' && action !== 'comments' && action !== 'subscription')) return;
    if (action === 'comments' && back()) return;
    comments.reset();
    // Choose the incoming geometry before state updates can reveal or measure it.
    dialog.classList.toggle('comments', action === 'comments');
    dialog.classList.toggle('description-panel', action === 'description');
    dialog.classList.toggle('subscription-panel', action === 'subscription');
    sheet.style.removeProperty('left'); sheet.style.removeProperty('top');
    controllerStyle.bind(close, action === 'description' ? 'Close' : 'Back');
    if (action === 'description') {
      descriptionHeader.replaceChildren(panelTitle, close);
      sheet.replaceChildren(descriptionHeader, description);
    } else if (action === 'subscription') sheet.replaceChildren(panelTitle, description, close);
    else sheet.replaceChildren(panelTitle, close, description);
    sheet.scrollTop = 0;
    const title = action === 'description' ? 'Video description' : action === 'playlists' ? 'Save to playlist' : action === 'subscription' ? 'Notifications' : 'Comments';
    drawer.open(action !== 'comments');
    send({ type: 'WATCH_PANEL', panel: action });
    controllerStyle.bind(panelTitle, title); controllerStyle.bind(dialog, title, 'aria-label');
    dialog.setAttribute('aria-modal', String(action !== 'comments'));
    if (action === 'description') {
      paint('description'); focus();
    } else if (action === 'subscription') {
      subscription.reset();
      paintSubscription();
      send({ type: 'WATCH_FOCUS', region: 'panel', index: 1 }); focus();
    } else if (action === 'playlists') {
      playlist.reset();
      paintPlaylists(); void loadPlaylists();
    } else {
      commentKey = ''; surface.classList.add('comments-open');
      document.documentElement.classList.add('ytg-comments');
      port.controller.request('comments', true);
      readComments(); focus();
    }
  }
  function hide() {
    drawer.close(false);
  }
  return { open, hide, close: closePanel, back, refresh: readComments, load: loadComments,
    get buttons() { return commentButtons; },
    destroy() { if (destroyed) return; hide(); destroyed = true; dialog.removeEventListener('click', outsideClick); window.removeEventListener('resize', positionSubscription); window.removeEventListener('scroll', positionSubscription, true); }
  };
  } };
})();
