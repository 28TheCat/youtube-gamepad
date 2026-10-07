// Description/comments rendering and native comment requests through an injected port.
(() => {
  if (window.YTGamepadWatchPanels) return;
  window.YTGamepadWatchPanels = {
    /** @param {import('../../types/ports.js').WatchPanelsPort} port */
    create(port) {
    const { make, dialog, sheet, panelTitle, description, close, surface, watchState, send, focus } = port;
    const { focusManager, controllerStyle } = port;
    let commentKey = '', commentButtons = [];
    let commentRoute = '';
    const collapsedComments = new Set();
  function clearPanel() {
    send({ type: 'WATCH_PANEL', panel: '' }); dialog.hidden = true; dialog.classList.remove('comments'); surface.classList.remove('comments-open');
    document.documentElement.classList.remove('ytg-comments');
  }
  function closePanel() {
    clearPanel(); focusManager?.close(dialog);
  }
  function readComments() {
    if (watchState().panel !== 'comments') return;
    const route = port.controller.readRoute().key;
    if (route !== commentRoute) { commentRoute = route; collapsedComments.clear(); commentKey = ''; }
    const records = port.controller.readComments();
    const unavailable = port.controller.readWatchFeatures?.().comments === 'failed';
    const key = JSON.stringify([records, unavailable]);
    if (key === commentKey) return;
    commentKey = key;
    commentButtons = [];
    const threads = records.map(item => {
      const node = make('div', 'comment');
      const collapsed = collapsedComments.has(item.key);
      const header = make('button', 'comment-header');
      header.setAttribute('aria-expanded', String(!collapsed));
      header.append(make('span', 'comment-toggle', collapsed ? '+' : '−'), make('span', 'comment-author', item.author));
      if (collapsed) header.append(make('span', 'comment-summary', 'Comment collapsed'));
      const body = make('div', 'comment-body'); body.hidden = collapsed;
      body.append(make('div', '', item.text));
      const repliesList = make('div', 'comment-replies-list');
      for (const reply of item.expanded) repliesList.append(make('div', 'comment-reply', '↳ ' + reply));
      if (item.expanded.length) body.append(repliesList);
      commentButtons.push(header);
      header.addEventListener('click', () => {
        if (collapsedComments.has(item.key)) collapsedComments.delete(item.key); else collapsedComments.add(item.key);
        send({ type: 'WATCH_FOCUS', region: 'panel', index: commentButtons.indexOf(header) + 1 });
        commentKey = ''; readComments();
      });
      if (item.hasReplies) {
        const replies = make('button', 'comment-replies', item.repliesLabel);
        replies.append(controllerStyle.hint(make('span'), ' · A Load replies'));
        replies.addEventListener('click', () => {
          if (port.controller.request('replies', item.key)) { commentKey = ''; readComments(); }
        });
        body.append(replies);
        if (!collapsed) commentButtons.push(replies);
      }
      node.append(header, body);
      return node;
    });
    description.replaceChildren(...threads);
    if (!records.length) description.append(controllerStyle.hint(make('p'), unavailable ? 'Comments are unavailable. Playback continues normally. B Back.' : 'Comments are still loading or disabled for this video. Press ↓ to load more, B to go back.'));
    if (records.length) {
      const more = make('button', 'control', 'Load more comments');
      more.addEventListener('click', loadComments); description.append(more); commentButtons.push(more);
    }
    send({ type: 'WATCH_PANEL_COUNT', count: commentButtons.length }); if (!port.controller.navigating && !port.controller.hasTemporaryLayer?.()) focus();
  }
  function loadComments() {
    port.controller.request('comments');
  }
  function open(action) {
    if (action === 'description' || action === 'comments') focusManager?.open(dialog, 'watch');
    if (action === 'description') {
      sheet.replaceChildren(panelTitle, description, close);
      send({ type: 'WATCH_PANEL', panel: action }); panelTitle.textContent = 'Video description'; dialog.setAttribute('aria-label', 'Video description'); description.textContent = port.descriptionText || 'No description available'; dialog.hidden = false; focus();
    } else if (action === 'comments') {
      sheet.replaceChildren(panelTitle, close, description); sheet.scrollTop = 0;
      send({ type: 'WATCH_PANEL', panel: action }); commentKey = ''; panelTitle.textContent = 'Comments'; dialog.setAttribute('aria-label', 'Comments');
      dialog.classList.add('comments'); surface.classList.add('comments-open');
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
    destroy() { hide(); commentButtons = []; commentKey = ''; collapsedComments.clear(); description.replaceChildren(); }
  };
  } };
})();
