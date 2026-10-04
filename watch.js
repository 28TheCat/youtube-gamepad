// A gamepad-first watch surface. YouTube retains ownership of media and navigation.
(() => {
  if (window.YTGamepadWatch) return;
  const lifecycle = window.YTGamepadRuntime.scope('watch');
  // The coordinator injects data snapshots and commands; this view never reads
  // YouTube's native DOM or retains its media, links and reply controls.
  let controller;
  const enabled = () => !lifecycle.destroyed && controller?.state.enabled === true;
  const mode = () => controller?.state.mode || 'browse';
  const playIndex = 4;
  let renderedMode = 'browse', timer;
  const interaction = window.YTGamepadInteraction;
  const watchState = () => interaction.state.watch;
  const send = event => interaction.dispatch(event);
  send({ type: 'WATCH_RESET', playIndex });
  let route = '', recommendationKey = '', video = null, lastActivity = Date.now();
  const { host, root, make, surface, title, meta, progress, fill, elapsed, duration, icon, controls,
    avatarButton, avatarImage, avatarFallback, subscribeButton, playButton, likeButton, dislikeButton,
    captionsButton, recommendations, empty, dialog, sheet, panelTitle, description, close, status, updateHint
  } = window.YTGamepadWatchView.create({ activate, closePanel });
  let cards = [], descriptionText = '', lastPaused;
  function formatTime(value) {
    if (!Number.isFinite(value)) return '直播';
    const seconds = Math.max(0, Math.floor(value)), hours = Math.floor(seconds / 3600);
    return (hours ? hours + ':' : '') + (hours ? String(Math.floor(seconds / 60) % 60).padStart(2, '0') : Math.floor(seconds / 60)) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function focus() {
    progress.classList.toggle('adjusting', watchState().adjusting);
    updateHint(watchState().row, watchState().adjusting);
    progress.setAttribute('aria-label', watchState().adjusting ? '播放进度，调整中，左右调整，A 结束，B 返回' : '播放进度，A 开始调整');
    surface.classList.toggle('browsing', watchState().row === 'recommendations');
    document.documentElement.classList.toggle('ytg-recommendations', watchState().row === 'recommendations' && mode() === 'controls');
    [...controls, progress, ...cards, close, ...panels.buttons].forEach(node => node.classList.remove('selected'));
    const panelTargets = watchState().panel === 'comments' ? [close, ...panels.buttons] : [close];
    const node = watchState().panel ? panelTargets[Math.min(watchState().panelIndex, panelTargets.length - 1)] : watchState().row === 'progress' ? progress : watchState().row === 'recommendations' ? cards[watchState().index] : controls[watchState().index];
    node?.classList.add('selected'); node?.focus({ preventScroll: true });
    if (watchState().row === 'recommendations') node?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    if (watchState().panel === 'comments') node?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function feedback(text) {
    status.textContent = text; lifecycle.clearTimeout(timer); timer = lifecycle.timeout(() => { status.textContent = ''; }, 2600);
  }
  const panels = window.YTGamepadWatchPanels.create({ make, dialog, sheet, panelTitle, description, close, surface,
    watchState, send, focus, focusManager: window.YTGamepadFocus,
    get controller() { return controller; }, get descriptionText() { return descriptionText; }
  });
  function closePanel() { panels.close(); }
  function activate(action) {
    if (!enabled() || controller.state.navigating) return;
    lastActivity = Date.now();
    if (action === 'adjustProgress') {
      send({ type: 'WATCH_FOCUS', region: 'progress' }); handle('confirm');
    } else if (action === 'description' || action === 'comments') {
      panels.open(action);
    } else if (action === 'channel') {
      if (!controller.request('channel')) feedback('频道信息尚未加载');
    } else if (action === 'settings') {
      if (!controller.request('settings')) feedback('播放设置暂不可用');
    } else if (['subscribe', 'like', 'dislike', 'save'].includes(action)) {
      Promise.resolve(controller.request('watchAction', action)).then(ok => {
        if (lifecycle.destroyed) return;
        if (!ok) feedback('此操作暂不可用，请等待视频信息加载');
        readPage();
      });
    } else if (!controller.request('media', action)) feedback(action === 'captions' ? '此视频暂无可用字幕' : '此操作暂不可用');
    updateProgress();
  }
  function updateProgress() {
    const playback = controller.readPlayback();
    controller.observePlayback(playback);
    video = playback.video;
    if (!video) return;
    elapsed.textContent = formatTime(video.currentTime); duration.textContent = formatTime(video.duration);
    const finite = Number.isFinite(video.duration) && video.duration > 0;
    fill.style.width = (finite ? Math.min(100, Math.max(0, video.currentTime / video.duration * 100)) : 0) + '%';
    progress.setAttribute('aria-valuemax', String(finite ? video.duration : 0));
    progress.setAttribute('aria-valuenow', String(Number.isFinite(video.currentTime) ? video.currentTime : 0));
    progress.setAttribute('aria-valuetext', elapsed.textContent + ' / ' + duration.textContent);
    if (lastPaused !== video.paused) {
      lastPaused = video.paused; playButton.replaceChildren(icon(video.paused ? 'play' : 'pause'));
      playButton.setAttribute('aria-label', video.paused ? '播放' : '暂停');
    }
    captionsButton.setAttribute('aria-pressed', String(playback.captionsEnabled));
  }
  function readPage() {
    if (!enabled() || !controller || document.hidden) return;
    const page = controller.readWatchPage();
    if (!page.isWatch) return;
    title.textContent = page.title || '正在加载视频…';
    const views = page.viewCount ? Number(page.viewCount).toLocaleString() + ' 次观看' : '';
    meta.textContent = [page.channel, views].filter(Boolean).join(' · ');
    avatarButton.setAttribute('aria-label', page.channel ? '频道：' + page.channel : '频道');
    avatarButton.title = page.channel || '频道';
    if (page.avatar && avatarImage.getAttribute('src') !== page.avatar) {
      avatarImage.setAttribute('src', page.avatar);
      avatarImage.hidden = false; avatarFallback.hidden = true;
    } else if (!page.avatar) { avatarImage.hidden = true; avatarFallback.hidden = false; }
    avatarFallback.textContent = page.channel?.slice(0, 1) || '●';
    subscribeButton.children[0].textContent = page.subscribed ? '已订阅' : '订阅';
    subscribeButton.setAttribute('aria-label', page.subscribed ? '已订阅，管理订阅' : '订阅');
    subscribeButton.setAttribute('aria-pressed', String(!!page.subscribed));
    likeButton.setAttribute('aria-pressed', String(!!page.liked));
    dislikeButton.setAttribute('aria-pressed', String(!!page.disliked));
    descriptionText = page.description;
    const next = page.recommendations;
    const key = JSON.stringify(next.map(item => [item.key, item.label, item.thumbnail, item.thumbnailFallback, item.channel]));
    if (key !== recommendationKey) {
      const saved = window.YTGamepadFocus?.capture('watch');
      recommendationKey = key;
      cards = next.map(item => {
        const card = make('button', 'card'); card.dataset.videoId = item.key;
        card.setAttribute('aria-label', item.label);
        const thumbnail = make('div', 'card-thumbnail');
        const image = make('img'); image.alt = ''; image.loading = 'lazy';
        let usedFallback = !item.thumbnail || item.thumbnail === item.thumbnailFallback;
        image.addEventListener('error', () => {
          if (!usedFallback && item.thumbnailFallback) {
            usedFallback = true; image.src = item.thumbnailFallback;
          } else image.style.visibility = 'hidden';
        });
        if (item.thumbnail || item.thumbnailFallback) image.src = item.thumbnail || item.thumbnailFallback;
        else image.style.visibility = 'hidden';
        thumbnail.append(image);
        card.append(thumbnail, make('div', 'card-title', item.label), make('div', 'card-meta', item.channel));
        card.addEventListener('click', () => openVideo(item.key)); return card;
      });
      recommendations.replaceChildren(...cards);
      if (watchState().row === 'recommendations') {
        if (!window.YTGamepadFocus?.suspended && !hasTemporaryLayer()) window.YTGamepadFocus?.restore(saved);
        else if (!cards.length) { send({ type: 'WATCH_EMPTY' }); }
      }
    }
    empty.hidden = cards.length > 0;
    const features = controller.readWatchFeatures?.() || {};
    empty.textContent = features.recommendations === 'failed' ? '推荐视频暂不可用，播放不受影响' : '暂无推荐视频，或推荐仍在加载…';
    panels.refresh();
    updateProgress();
  }
  function openVideo(key) {
    if (controller.request('recommendation', key) === 'missing') { feedback('推荐视频已更新，请重新选择'); readPage(); }
  }
  function hasTemporaryLayer() {
    return !!(watchState().panel || window.YTGamepadFocus?.suspended || controller.hasTemporaryLayer?.());
  }
  function show(target = 'controls') {
    if (!enabled() || controller.state.navigating) return;
    lastActivity = Date.now();
    readPage(); send({ type: 'WATCH_SHOW', target, count: cards.length });
    controller.request('mode', 'controls'); focus();
  }
  function sync() {
    if (mode() !== renderedMode) lastActivity = Date.now();
    renderedMode = mode();
    const active = enabled() && controller.state.surfaceReady !== false && controller.readRoute().isWatch && mode() !== 'browse';
    document.documentElement.classList.toggle('ytg-watch-active', active);
    host.hidden = !active || mode() !== 'controls';
    if (host.hidden) document.documentElement.classList.toggle('ytg-recommendations', false);
    if (host.hidden) panels.hide();
    if (!active) document.documentElement.classList.remove('ytg-settings-open');
    if (active) {
      const nextRoute = controller.readRoute().key;
      if (nextRoute !== route) {
        route = nextRoute; recommendationKey = ''; send({ type: 'WATCH_RESET', playIndex });
        lastPaused = undefined; cards = []; recommendations.replaceChildren();
      }
      readPage();
    }
  }
  progress.addEventListener('click', event => {
    send({ type: 'WATCH_FOCUS', region: 'progress' }); focus();
    const rect = progress.getBoundingClientRect();
    if (video && Number.isFinite(video.duration) && event.detail > 0 && rect.width) controller.request('seek', (event.clientX - rect.left) / rect.width * video.duration);
    updateProgress();
  });
  lifecycle.listen(root, 'pointerdown', () => { lastActivity = Date.now(); });
  lifecycle.listen(root, 'focusin', event => {
    lastActivity = Date.now();
    if (controls.includes(event.target)) { send({ type: 'WATCH_FOCUS', region: 'controls', index: controls.indexOf(event.target) }); }
    else if (cards.includes(event.target)) { send({ type: 'WATCH_FOCUS', region: 'recommendations', index: cards.indexOf(event.target) }); }
    else if (event.target === close || panels.buttons.includes(event.target)) send({ type: 'WATCH_FOCUS', region: 'panel', index: event.target === close ? 0 : panels.buttons.indexOf(event.target) + 1 });
    else if (event.target === progress) send({ type: 'WATCH_FOCUS', region: 'progress' });
  });
  // YouTube's document-level outside-click handler must not close a menu we just opened.
  lifecycle.listen(root, 'click', event => event.stopPropagation());
  lifecycle.listen(root, 'keydown', event => {
    event.stopPropagation();
    const action = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Escape: 'back' }[event.key];
    if (action) { event.preventDefault(); controller.dispatchAction(action); }
    if (event.key === 'Tab') { event.preventDefault(); controller.dispatchAction(watchState().panel === 'comments' ? (event.shiftKey ? 'up' : 'down') : (event.shiftKey ? 'left' : 'right')); }
  });
  function handle(action) {
    if (!enabled() || !controller.readRoute().isWatch || mode() !== 'controls') return false;
    if (controller.navigating) return true;
    lastActivity = Date.now();
    if (action === 'back' && controller.request('backSettings')) return true;
    // Measurements are observations; the reducer decides whether to scroll or move.
    let scrollDelta = 0;
    if (watchState().panel === 'comments' && watchState().panelIndex > 0 && ['up', 'down'].includes(action)) {
      const current = [close, ...panels.buttons][watchState().panelIndex];
      if (current) {
        const rect = current.getBoundingClientRect(), viewport = sheet.getBoundingClientRect();
        const delta = action === 'down' ? rect.bottom - viewport.bottom + 12 : rect.top - viewport.top - 12;
        if ((action === 'down' && delta > 1) || (action === 'up' && delta < -1)) scrollDelta = Math.max(-180, Math.min(180, delta));
      }
    }
    const result = send({ type: 'WATCH_INPUT', action, scrollDelta, commentCount: panels.buttons.length,
      cardCount: cards.length, controlCount: controls.length,
      recommendationKey: cards[watchState().index]?.dataset.videoId, controlAction: controls[watchState().index]?.dataset.action });
    for (const effect of result.effects) {
      switch (effect.type) {
        case 'closePanel': closePanel(); break;
        case 'panelClick': (watchState().panel === 'comments' ? [close, ...panels.buttons][watchState().panelIndex] : close)?.click(); break;
        case 'panelScroll': sheet.scrollBy({ top: effect.value, behavior: 'instant' }); break;
        case 'loadComments': panels.load(); break;
        case 'focus': focus(); break;
        case 'mode': controller.request('mode', effect.value); break;
        case 'recommendation': openVideo(effect.value); break;
        case 'activate': activate(effect.value); break;
      }
    }
    return result.disposition !== 'pass';
  }

  function focusItems(region) {
    const nodes = region === 'recommendations' ? cards : region === 'progress' ? [progress] : region === 'panel' ? [close, ...panels.buttons] : controls;
    return nodes.filter(node => node.isConnected && !node.disabled && node.getAttribute('aria-disabled') !== 'true')
      .map((node, position) => ({ region, itemKey: node.dataset.videoId || node.dataset.action || String(position), index: position }));
  }
  const unregisterFocus = window.YTGamepadFocus?.register('watch', {
    active: () => enabled() && !host.hidden && mode() === 'controls' && !controller.hasNativeLayer?.(),
    capture() {
      const region = watchState().panel ? 'panel' : watchState().row, position = watchState().panel ? watchState().panelIndex : watchState().row === 'progress' ? 0 : watchState().index;
      return { ...focusItems(region)[position], region, index: position, scope: watchState().panel ? dialog : null };
    },
    items: focusItems,
    fallback: () => focusItems('controls').find(item => item.index === playIndex) || focusItems('controls')[0],
    apply(target) {
      if (!target) return;
      send({ type: 'WATCH_FOCUS', region: target.region, index: target.index });
      lastActivity = Date.now(); focus();
    }
  });
  if (unregisterFocus) lifecycle.cleanup(unregisterFocus);
  function handleInput(action) {
    if (!enabled() || !controller.readRoute().isWatch || mode() !== 'controls') return 'pass';
    if (watchState().panel && !['back', 'confirm', 'up', 'down'].includes(action)) return 'blocked';
    return handle(action) ? 'handled' : watchState().panel ? 'blocked' : 'pass';
  }
  window.YTGamepadWatch = { connect(port) { controller = port; }, sync, show, handle, handleInput, refresh: readPage,
    get ownsFocus() { return enabled() && !host.hidden && mode() === 'controls'; },
    get state() { return { mode: mode(), row: watchState().row, index: watchState().index, adjusting: watchState().adjusting, panel: watchState().panel, recommendations: cards.length }; } };
  lifecycle.listen(document, 'visibilitychange', () => {
    if (!document.hidden) { lastActivity = Date.now(); readPage(); }
  });
  // YouTube captures Space/Enter above the shadow root. Consume both halves of
  // these keys before the player can turn a selected action into play/pause.
  for (const type of ['keydown', 'keyup']) lifecycle.listen(window, type, event => {
    if (!enabled() || host.hidden || !event.composedPath?.().includes(host) ||
        ![' ', 'Spacebar', 'Enter'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (type === 'keydown' && !event.repeat) controller.dispatchAction('confirm');
  }, true);
  lifecycle.interval(() => {
    if (host.hidden || document.hidden) return;
    updateProgress();
    if (hasTemporaryLayer() || controller.navigating) { lastActivity = Date.now(); return; }
    const idle = Date.now() - lastActivity;
    controller.requestAutoHide?.(idle);
  }, 500);
  const published = window.YTGamepadWatch;
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (window.YTGamepadWatch === published) delete window.YTGamepadWatch; });
  lifecycle.cleanup(() => {
    panels.destroy(); host.hidden = true; host.remove?.(); root.replaceChildren(); cards = []; video = null;
    document.documentElement.classList.remove('ytg-watch-active', 'ytg-recommendations', 'ytg-comments', 'ytg-settings-open');
  });
})();
