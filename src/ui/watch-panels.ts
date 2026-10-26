import { mountWatchPanel } from './mount-watch-panel';
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
    const replyBatchSize = 5;
    let threadKey = '', replyLimit = replyBatchSize;
    let nextReplyIndex: number | undefined;
    let listPosition = { top: 0, id: '', index: 0 };
    let renderer: ReturnType<typeof mountWatchPanel> | undefined;
    let destroyed = false;
    let playlists: readonly import('../../types/ports').SavedPlaylistSnapshot[] = [];
    let playlistLoading = false, playlistFailed = false, playlistVersion = 0;
    function paint(panel: 'description' | 'comments' | 'playlists', records: readonly import('../../types/ports').CommentSnapshot[] = [], unavailable = false) {
      if (destroyed) return;
      renderer ||= mountWatchPanel(description, controllerStyle, {
        openThread, replies: loadReplies,
        load: loadComments, savePlaylist: togglePlaylist, retryPlaylists: loadPlaylists
      });
      renderer.update({ panel, text: port.descriptionText, records, unavailable,
        thread: threadKey ? records.find(item => item.key === threadKey) : undefined, replyLimit,
        playlists, playlistLoading, playlistFailed,
        commentsStatus: port.controller.readCommentsStatus?.() });
      dialog.classList.toggle('thread-detail', panel === 'comments' && !!threadKey);
      commentButtons = panel !== 'description' ? renderer.buttons() : [];
    }
    function paintPlaylists() {
      if (destroyed || watchState().panel !== 'playlists') return;
      paint('playlists'); send({ type: 'WATCH_PANEL_COUNT', count: commentButtons.length });
      if (!port.controller.navigating && !port.controller.hasTemporaryLayer?.()) focus();
    }
    async function loadPlaylists() {
      if (playlistLoading || destroyed || watchState().panel !== 'playlists') return;
      const version = ++playlistVersion, route = port.controller.readRoute().key;
      playlistLoading = true; playlistFailed = false; paintPlaylists();
      try {
        const value = await port.controller.request('playlists');
        if (version !== playlistVersion || destroyed || route !== port.controller.readRoute().key) return;
        playlistFailed = !Array.isArray(value); if (Array.isArray(value)) playlists = value;
      } catch { if (version === playlistVersion) playlistFailed = true; }
      finally { if (version === playlistVersion && !destroyed) { playlistLoading = false; paintPlaylists(); } }
    }
    async function togglePlaylist(key: string) {
      if (playlistLoading || destroyed || watchState().panel !== 'playlists') return;
      const version = ++playlistVersion, route = port.controller.readRoute().key;
      playlistLoading = true; playlistFailed = false; paintPlaylists();
      try {
        const ok = await port.controller.request('savePlaylist', key);
        if (version !== playlistVersion || destroyed || route !== port.controller.readRoute().key) return;
        playlistFailed = !ok;
        if (ok) playlists = playlists.map(item => item.key === key ? { ...item, selected: !item.selected } : item);
      } catch { if (version === playlistVersion) playlistFailed = true; }
      finally { if (version === playlistVersion && !destroyed) { playlistLoading = false; paintPlaylists(); } }
    }
    function unmount() { renderer?.dispose(); renderer = undefined; commentButtons = []; commentKey = ''; }
  function clearPanel() {
    threadKey = ''; replyLimit = replyBatchSize; nextReplyIndex = undefined; listPosition = { top: 0, id: '', index: 0 };
    ++playlistVersion; playlistLoading = false; playlistFailed = false; playlists = [];
    // Keep the panel geometry through the discrete display/opacity exit transition.
    // Removing "comments" here turns the fading sidebar into a full-screen backdrop.
    unmount(); send({ type: 'WATCH_PANEL', panel: '' }); dialog.hidden = true; surface.classList.remove('comments-open');
    document.documentElement.classList.remove('ytg-comments');
  }
  function closePanel() {
    clearPanel(); focusManager?.close(dialog);
  }
  function openThread(key: string) {
    if (destroyed || watchState().panel !== 'comments') return;
    const record = port.controller.readComments().find(item => item.key === key);
    if (!record || (!record.hasReplies && !record.replies.length)) return;
    const active = (dialog.getRootNode?.() as ShadowRoot | undefined)?.activeElement as HTMLElement | null;
    listPosition = { top: sheet.scrollTop, id: active?.dataset.focusId || 'replies:' + key, index: watchState().panelIndex };
    threadKey = key; replyLimit = replyBatchSize; nextReplyIndex = undefined;
    controllerStyle.bind(close, 'Back to comments');
    controllerStyle.bind(panelTitle, 'Replies'); controllerStyle.bind(dialog, 'Replies', 'aria-label');
    send({ type: 'WATCH_FOCUS', region: 'panel', index: 0 });
    commentKey = ''; readComments(); sheet.scrollTop = 0;
    if (!record.replies.length && record.hasReplies) {
      port.controller.request('replies', key); commentKey = ''; readComments(); sheet.scrollTop = 0;
    }
  }
  function back() {
    if (destroyed || watchState().panel !== 'comments' || !threadKey) return false;
    threadKey = ''; replyLimit = replyBatchSize; nextReplyIndex = undefined;
    controllerStyle.bind(close, 'Back');
    controllerStyle.bind(panelTitle, 'Comments'); controllerStyle.bind(dialog, 'Comments', 'aria-label');
    commentKey = ''; readComments();
    const index = commentButtons.findIndex(button => button.dataset.focusId === listPosition.id);
    send({ type: 'WATCH_FOCUS', region: 'panel', index: index >= 0 ? index + 1 : Math.min(listPosition.index, commentButtons.length) });
    focus(); sheet.scrollTop = listPosition.top;
    return true;
  }
  function loadReplies() {
    if (destroyed || watchState().panel !== 'comments' || !threadKey || port.controller.readCommentsStatus?.()?.loading) return;
    const record = port.controller.readComments().find(item => item.key === threadKey);
    if (!record) return;
    nextReplyIndex = Math.min(replyLimit, record.replies.length);
    if (replyLimit < record.replies.length) replyLimit += replyBatchSize;
    else if (record.hasReplies || port.controller.readCommentsStatus?.()?.failed) {
      replyLimit = record.replies.length + replyBatchSize;
      port.controller.request('replies', threadKey);
    }
    commentKey = ''; readComments();
  }
  function readComments() {
    if (destroyed) return;
    if (watchState().panel === 'playlists') { paintPlaylists(); return; }
    if (watchState().panel === 'description') { paint('description'); return; }
    if (watchState().panel !== 'comments') return;
    const route = port.controller.readRoute().key;
    if (route !== commentRoute) { commentRoute = route; threadKey = ''; replyLimit = replyBatchSize; nextReplyIndex = undefined; commentKey = ''; }
    const records = port.controller.readComments();
    const unavailable = port.controller.readWatchFeatures?.().comments === 'failed';
    if (threadKey && !records.some(item => item.key === threadKey)) {
      back(); return;
    }
    const key = JSON.stringify([records, unavailable, port.controller.readCommentsStatus?.(), threadKey, replyLimit]);
    if (key === commentKey) return;
    let activeId = ((dialog.getRootNode?.() as ShadowRoot | undefined)?.activeElement as HTMLElement | null)?.dataset.focusId;
    commentKey = key;
    paint('comments', records, unavailable);
    const nextReply = nextReplyIndex === undefined ? undefined : records.find(item => item.key === threadKey)?.replies[nextReplyIndex];
    if (nextReply) { activeId = 'comment:reply:' + JSON.stringify([threadKey, nextReply.key]); nextReplyIndex = undefined; }
    const index = activeId ? commentButtons.findIndex(button => button.dataset.focusId === activeId) : -1;
    if (index >= 0) send({ type: 'WATCH_FOCUS', region: 'panel', index: index + 1 });
    send({ type: 'WATCH_PANEL_COUNT', count: commentButtons.length }); if (!port.controller.navigating && !port.controller.hasTemporaryLayer?.()) focus();
  }
  function loadComments() {
    if (destroyed || watchState().panel !== 'comments') return;
    if (threadKey) { loadReplies(); return; }
    port.controller.request('comments');
  }
  function open(action: string) {
    if (destroyed || (action !== 'description' && action !== 'playlists' && action !== 'comments')) return;
    if (action === 'comments' && back()) return;
    threadKey = ''; replyLimit = replyBatchSize; nextReplyIndex = undefined;
    // Choose the incoming geometry before state updates can reveal or measure it.
    dialog.classList.toggle('comments', action === 'comments');
    dialog.classList.toggle('description-panel', action === 'description');
    if (action === 'description' || action === 'playlists') focusManager?.open(dialog, 'watch');
    controllerStyle.bind(close, action === 'description' ? 'Close' : 'Back');
    if (action === 'description') {
      descriptionHeader.replaceChildren(panelTitle, close);
      sheet.replaceChildren(descriptionHeader, description);
    } else sheet.replaceChildren(panelTitle, close, description);
    sheet.scrollTop = 0;
    const title = action === 'description' ? 'Video description' : action === 'playlists' ? 'Save to playlist' : 'Comments';
    send({ type: 'WATCH_PANEL', panel: action });
    controllerStyle.bind(panelTitle, title); controllerStyle.bind(dialog, title, 'aria-label');
    dialog.setAttribute('aria-modal', String(action !== 'comments')); dialog.hidden = false;
    if (action === 'description') {
      paint('description'); focus();
    } else if (action === 'playlists') {
      playlists = []; playlistFailed = false; playlistLoading = false;
      paintPlaylists(); void loadPlaylists();
    } else {
      commentKey = ''; surface.classList.add('comments-open');
      document.documentElement.classList.add('ytg-comments');
      port.controller.request('comments', true);
      readComments(); focus();
    }
  }
  function hide() {
    focusManager?.close(dialog, false); clearPanel();
  }
  return { open, hide, close: closePanel, back, refresh: readComments, load: loadComments,
    get buttons() { return commentButtons; },
    destroy() { if (destroyed) return; hide(); destroyed = true; }
  };
  } };
})();
