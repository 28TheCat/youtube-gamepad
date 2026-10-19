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
    let commentKey = '', commentButtons: HTMLElement[] = [];
    let commentRoute = '';
    const collapsedComments = new Set<string>();
    let renderer: ReturnType<typeof mountWatchPanel> | undefined;
    let destroyed = false;
    let playlists: readonly import('../../types/ports').SavedPlaylistSnapshot[] = [];
    let playlistLoading = false, playlistFailed = false, playlistVersion = 0;
    function paint(panel: 'description' | 'comments' | 'playlists', records: readonly import('../../types/ports').CommentSnapshot[] = [], unavailable = false) {
      if (destroyed) return;
      renderer ||= mountWatchPanel(description, controllerStyle, {
        toggle(key) {
          const index = commentButtons.findIndex(button => button.dataset.focusId === 'comment:' + key);
          if (collapsedComments.has(key)) collapsedComments.delete(key); else collapsedComments.add(key);
          send({ type: 'WATCH_FOCUS', region: 'panel', index: Math.max(0, index) + 1 });
          commentKey = ''; readComments();
        },
        replies(key) { if (port.controller.request('replies', key)) { commentKey = ''; readComments(); } },
        load: loadComments, savePlaylist: togglePlaylist, retryPlaylists: loadPlaylists
      });
      renderer.update({ panel, text: port.descriptionText, records, collapsed: [...collapsedComments], unavailable,
        playlists, playlistLoading, playlistFailed,
        commentsStatus: port.controller.readCommentsStatus?.() });
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
    ++playlistVersion; playlistLoading = false; playlistFailed = false; playlists = [];
    unmount(); send({ type: 'WATCH_PANEL', panel: '' }); dialog.hidden = true; dialog.classList.remove('comments'); surface.classList.remove('comments-open');
    document.documentElement.classList.remove('ytg-comments');
  }
  function closePanel() {
    clearPanel(); focusManager?.close(dialog);
  }
  function readComments() {
    if (destroyed) return;
    if (watchState().panel === 'playlists') { paintPlaylists(); return; }
    if (watchState().panel === 'description') { paint('description'); return; }
    if (watchState().panel !== 'comments') return;
    const route = port.controller.readRoute().key;
    if (route !== commentRoute) { commentRoute = route; collapsedComments.clear(); commentKey = ''; }
    const records = port.controller.readComments();
    const unavailable = port.controller.readWatchFeatures?.().comments === 'failed';
    const key = JSON.stringify([records, unavailable, port.controller.readCommentsStatus?.()]);
    if (key === commentKey) return;
    const activeId = ((dialog.getRootNode?.() as ShadowRoot | undefined)?.activeElement as HTMLElement | null)?.dataset.focusId;
    commentKey = key;
    paint('comments', records, unavailable);
    const index = activeId ? commentButtons.findIndex(button => button.dataset.focusId === activeId) : -1;
    if (index >= 0) send({ type: 'WATCH_FOCUS', region: 'panel', index: index + 1 });
    send({ type: 'WATCH_PANEL_COUNT', count: commentButtons.length }); if (!port.controller.navigating && !port.controller.hasTemporaryLayer?.()) focus();
  }
  function loadComments() {
    if (destroyed || watchState().panel !== 'comments') return;
    port.controller.request('comments');
  }
  function open(action: string) {
    if (destroyed) return;
    if (action === 'description' || action === 'playlists') focusManager?.open(dialog, 'watch');
    if (action === 'description') {
      sheet.replaceChildren(panelTitle, description, close);
      dialog.setAttribute('aria-modal', 'true'); send({ type: 'WATCH_PANEL', panel: action }); controllerStyle.bind(panelTitle, 'Video description'); controllerStyle.bind(dialog, 'Video description', 'aria-label'); paint('description'); dialog.hidden = false; focus();
    } else if (action === 'playlists') {
      sheet.replaceChildren(panelTitle, close, description); sheet.scrollTop = 0;
      send({ type: 'WATCH_PANEL', panel: 'playlists' });
      controllerStyle.bind(panelTitle, 'Save to playlist'); controllerStyle.bind(dialog, 'Save to playlist', 'aria-label');
      dialog.setAttribute('aria-modal', 'true'); dialog.hidden = false;
      playlists = []; playlistFailed = false; playlistLoading = false;
      paintPlaylists(); void loadPlaylists();
    } else if (action === 'comments') {
      sheet.replaceChildren(panelTitle, close, description); sheet.scrollTop = 0;
      send({ type: 'WATCH_PANEL', panel: action }); commentKey = ''; controllerStyle.bind(panelTitle, 'Comments'); controllerStyle.bind(dialog, 'Comments', 'aria-label');
      dialog.classList.add('comments'); dialog.setAttribute('aria-modal', 'false'); surface.classList.add('comments-open');
      document.documentElement.classList.add('ytg-comments'); dialog.hidden = false;
      port.controller.request('comments', true);
      readComments(); focus();
    }
  }
  function hide() {
    focusManager?.close(dialog, false); clearPanel();
  }
  return { open, hide, close: closePanel, refresh: readComments, load: loadComments,
    get buttons() { return commentButtons; },
    destroy() { if (destroyed) return; hide(); destroyed = true; collapsedComments.clear(); }
  };
  } };
})();
