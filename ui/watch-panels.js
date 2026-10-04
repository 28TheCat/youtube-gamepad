// Description/comments rendering and native comment requests through an injected port.
(() => {
  if (window.YTGamepadWatchPanels) return;
  window.YTGamepadWatchPanels = { create(port) {
    const { make, dialog, sheet, panelTitle, description, close, surface, watchState, send, focus } = port;
    const focusManager = port.focusManager;
    let commentKey = '', commentButtons = [];
  function clearPanel() {
    send({ type: 'WATCH_PANEL', panel: '' }); dialog.hidden = true; dialog.classList.remove('comments'); surface.classList.remove('comments-open');
    document.documentElement.classList.remove('ytg-comments');
  }
  function closePanel() {
    clearPanel(); focusManager?.close(dialog);
  }
  function readComments() {
    if (watchState().panel !== 'comments') return;
    const records = port.controller.readComments();
    const unavailable = port.controller.readWatchFeatures?.().comments === 'failed';
    const key = JSON.stringify([records, unavailable]);
    if (key === commentKey) return;
    commentKey = key;
    commentButtons = records.map(item => {
      const node = make('button', 'comment');
      node.append(make('div', 'comment-author', item.author), make('div', '', item.text));
      for (const reply of item.expanded) node.append(make('div', 'comment-replies', '↳ ' + reply));
      if (item.hasReplies) node.append(make('div', 'comment-replies', item.repliesLabel + ' · A 展开'));
      node.addEventListener('click', () => {
        if (port.controller.request('replies', item.key)) { commentKey = ''; readComments(); }
      });
      return node;
    });
    description.replaceChildren(...commentButtons);
    if (!records.length) description.append(make('p', '', unavailable ? '评论暂不可用，播放不受影响。B 返回。' : '评论尚未加载，或此视频未开放评论。按下键继续加载，B 返回。'));
    if (records.length) {
      const more = make('button', 'control', '加载更多评论');
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
      send({ type: 'WATCH_PANEL', panel: action }); panelTitle.textContent = '视频说明'; dialog.setAttribute('aria-label', '视频说明'); description.textContent = port.descriptionText || '暂无视频说明'; dialog.hidden = false; focus();
    } else if (action === 'comments') {
      sheet.replaceChildren(panelTitle, close, description); sheet.scrollTop = 0;
      send({ type: 'WATCH_PANEL', panel: action }); commentKey = ''; panelTitle.textContent = '评论'; dialog.setAttribute('aria-label', '评论');
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
    destroy() { hide(); commentButtons = []; commentKey = ''; description.replaceChildren(); }
  };
  } };
})();
