// A gamepad-first watch surface. YouTube retains ownership of media and navigation.
(() => {
  window.YTGamepadWatchModule = {
    /** @param {import('./types/ports.js').WatchDependencies} dependencies */
    create({ runtime, interaction, controllerStyle, focusManager, createView, createPanels }) {
  const lifecycle = runtime.scope('watch');
  // The coordinator injects data snapshots and commands; this view never reads
  // YouTube's native DOM or retains its media, links and reply controls.
  let controller;
  const enabled = () => !lifecycle.destroyed && controller?.state.enabled === true;
  const mode = () => controller?.state.mode || 'browse';
  const playIndex = 4;
  let renderedMode = 'browse', timer;
  const watchState = () => interaction.state.watch;
  const send = event => interaction.dispatch(event);
  send({ type: 'WATCH_RESET', playIndex });
  let route = '', recommendationKey = '', video = null, lastActivity = Date.now();
  const { host, root, make, surface, title, meta, progress, fill, elapsed, duration, icon, controls,
    avatarButton, avatarImage, avatarFallback, subscribeButton, playButton, likeButton, dislikeButton,
    captionsButton, recommendations, empty, dialog, sheet, panelTitle, description, close, status, updateHint, liveButton
  } = createView({ activate, closePanel, controllerStyle });
  lifecycle.cleanup(controllerStyle.register(root));
  let cards = [], descriptionText = '', lastPaused, recommendationStart = 0;
  function animateFeedback(node, frames, duration) {
    if (!node.animate || !window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) return;
    node.getAnimations().filter(animation => animation.id === 'ytg-feedback').forEach(animation => animation.cancel());
    const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.2,.8,.2,1)', id: 'ytg-feedback' });
    const release = lifecycle.cleanup(() => animation.cancel());
    animation.onfinish = animation.oncancel = release;
  }
  function clearFeedback() {
    lifecycle.clearTimeout(timer); status.replaceChildren(); host.removeAttribute?.('data-feedback');
    status.classList.remove('feedback-closing');
  }
  function mediaFeedback(action) {
    if (!enabled() || !controller.readRoute().isWatch || mode() === 'browse' || controller.hasTemporaryLayer?.()) return;
    const playback = controller.readPlayback().video;
    if (!playback || !['seekBack', 'seekForward', 'volumeDown', 'volumeUp', 'mute', 'playPause'].includes(action)) return;
    const repeated = host.getAttribute('data-feedback') === action;
    lifecycle.clearTimeout(timer);
    status.classList.remove('feedback-closing');
    host.setAttribute('data-feedback', action);
    status.classList.add('media-feedback');
    if (action === 'playPause') {
      status.replaceChildren(icon(playback.paused ? 'pause' : 'play'));
      status.setAttribute('aria-label', playback.paused ? 'Paused' : 'Playing');
    } else {
      const volume = ['volumeDown', 'volumeUp', 'mute'].includes(action);
      const percentage = Math.round(Math.max(0, Math.min(1, playback.volume ?? 0)) * 100);
      const label = volume ? (playback.muted ? 'Muted' : `Volume ${percentage}%`) : `${action === 'seekBack' ? '−' : '+'}${window.YTGamepadActions.get(action).parameter.default} seconds`;
      status.setAttribute('aria-label', label);
      if (volume && repeated && status.children.length === 2) {
        status.children[0].textContent = label;
        status.children[1].children[0].style.width = (playback.muted ? 0 : percentage) + '%';
      } else {
        const labelNode = make('span', '', label);
        status.replaceChildren(labelNode);
        if (volume) {
          const track = make('span', 'feedback-track'), level = make('span', 'feedback-level');
          level.style.width = (playback.muted ? 0 : percentage) + '%'; track.append(level); status.append(track);
        }
      }
    }
    if (!repeated || action === 'playPause') animateFeedback(status, [{ opacity: 0, scale: '.96', translate: '0 6px' }, { opacity: 1, scale: '1', translate: '0 0' }], 100);
    timer = lifecycle.timeout(() => {
      if (!window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) { clearFeedback(); return; }
      status.classList.add('feedback-closing');
      timer = lifecycle.timeout(clearFeedback, 100);
    }, action === 'playPause' ? 300 : 600);
  }
  function formatTime(value) {
    if (!Number.isFinite(value)) return 'Live';
    const seconds = Math.max(0, Math.floor(value)), hours = Math.floor(seconds / 3600);
    return (hours ? hours + ':' : '') + (hours ? String(Math.floor(seconds / 60) % 60).padStart(2, '0') : Math.floor(seconds / 60)) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function focus() {
    progress.classList.toggle('adjusting', watchState().adjusting);
    updateHint(watchState().row, watchState().adjusting, !progress.disabled);
    controllerStyle.bind(progress, watchState().adjusting ? 'Playback position, adjusting. Left / right to seek, A to finish, B to go back' : 'Playback position, A to start adjusting', 'aria-label');
    surface.classList.toggle('browsing', watchState().row === 'recommendations');
    updateRecommendationPage();
    document.documentElement.classList.toggle('ytg-recommendations', watchState().row === 'recommendations' && mode() === 'controls');
    [...controls, progress, ...cards, close, ...panels.buttons].forEach(node => node.classList.remove('selected'));
    const panelTargets = watchState().panel === 'comments' ? [close, ...panels.buttons] : [close];
    const node = watchState().panel ? panelTargets[Math.min(watchState().panelIndex, panelTargets.length - 1)] : watchState().row === 'progress' ? progress : watchState().row === 'recommendations' ? cards[watchState().index] : controls[watchState().index];
    node?.classList.add('selected'); node?.focus({ preventScroll: true });
    if (watchState().row === 'recommendations') {
      node?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      if (watchState().index >= cards.length - recommendationColumns() * 2) controller.request('moreRecommendations');
    }
    if (watchState().panel === 'comments') node?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function feedback(text) {
    host.removeAttribute?.('data-feedback'); status.classList.remove('media-feedback'); status.classList.remove('feedback-closing'); status.removeAttribute?.('aria-label');
    status.textContent = text; lifecycle.clearTimeout(timer); timer = lifecycle.timeout(() => { status.textContent = ''; }, 2600);
  }
  const panels = createPanels({ make, dialog, sheet, panelTitle, description, close, surface,
    watchState, send, focus, focusManager, controllerStyle,
    get controller() { return controller; }, get descriptionText() { return descriptionText; }
  });
  function closePanel() { panels.close(); }
  function activate(action) {
    if (!enabled() || controller.state.navigating) return;
    const button = controls.find(node => node.dataset.action === action);
    if (button?.disabled || button?.hidden || (action === 'adjustProgress' && progress.disabled)) return;
    if (button && !button.disabled && button.animate && window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) {
      button.getAnimations().filter(animation => animation.id === 'ytg-press').forEach(animation => animation.cancel());
      // Return to the underlying focus/hover scale without a final-frame jump.
      const animation = button.animate([{ scale: '.95', offset: 0 }], { duration: 100, easing: 'cubic-bezier(.2,.8,.2,1)', id: 'ytg-press' });
      const release = lifecycle.cleanup(() => animation.cancel());
      animation.onfinish = animation.oncancel = release;
    }
    lastActivity = Date.now();
    if (action === 'adjustProgress') {
      send({ type: 'WATCH_FOCUS', region: 'progress' }); handle('confirm');
    } else if (action === 'description' || action === 'comments') {
      panels.open(action);
    } else if (action === 'channel') {
      if (!controller.request('channel')) feedback('Channel information is still loading');
    } else if (action === 'settings') {
      if (!controller.request('settings')) feedback('Player settings are currently unavailable');
    } else if (['subscribe', 'like', 'dislike', 'save'].includes(action)) {
      Promise.resolve(controller.request('watchAction', action)).then(ok => {
        if (lifecycle.destroyed) return;
        if (!ok) feedback('This action is unavailable. Wait for the video information to load.');
        readPage();
      });
    } else {
      const route = controller.readRoute().key;
      Promise.resolve(controller.request('media', action)).then(ok => {
        if (lifecycle.destroyed || controller.readRoute().key !== route) return;
        if (!ok) feedback(action === 'captions' ? 'No captions available for this video' : 'This action is currently unavailable');
        updateProgress();
      });
    }
    updateProgress();
  }
  function updateProgress() {
    const playback = controller.readPlayback();
    controller.observePlayback(playback);
    video = playback.video;
    const timeline = video?.timeline;
    const canSeek = !!timeline?.canSeek, start = timeline?.start || 0, end = timeline?.end || 0;
    const current = Number.isFinite(video?.currentTime) ? video.currentTime : start;
    progress.disabled = !canSeek;
    progress.setAttribute('aria-disabled', String(!canSeek));
    updateHint(watchState().row, watchState().adjusting, canSeek);
    progress.title = canSeek ? (timeline.isLive ? 'Live playback position' : 'Playback position') : 'Seeking is unavailable for this video';
    liveButton.hidden = !timeline?.isLive;
    liveButton.disabled = !canSeek || !!timeline?.atLiveEdge;
    liveButton.textContent = timeline?.atLiveEdge ? 'Live' : 'Go live';
    for (const button of controls) if (['seekBack', 'seekForward'].includes(button.dataset.action)) button.disabled = !canSeek;
    elapsed.textContent = timeline?.isLive ? (timeline.atLiveEdge ? 'Live' : 'Behind live by ' + formatTime(end - current)) : formatTime(current);
    duration.textContent = timeline?.isLive ? (canSeek ? 'Live · Replay window: ' + formatTime(end - start) : 'Live · Seeking unavailable') : formatTime(video?.duration || 0);
    fill.style.width = (canSeek ? Math.min(100, Math.max(0, (current - start) / (end - start) * 100)) : 0) + '%';
    progress.setAttribute('aria-valuemin', String(start));
    progress.setAttribute('aria-valuemax', String(end));
    progress.setAttribute('aria-valuenow', String(Math.min(end, Math.max(start, current))));
    progress.setAttribute('aria-valuetext', elapsed.textContent + ' / ' + duration.textContent);
    if (!watchState().panel && ((watchState().row === 'progress' && !canSeek) ||
        (watchState().row === 'controls' && (controls[watchState().index]?.disabled || controls[watchState().index]?.hidden)))) {
      send({ type: 'WATCH_FOCUS', region: 'controls', index: playIndex });
      if (!host.hidden && !hasTemporaryLayer()) focus();
    }
    if (!video) return;
    if (lastPaused !== video.paused) {
      lastPaused = video.paused; playButton.replaceChildren(icon(video.paused ? 'play' : 'pause'));
      playButton.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    }
    captionsButton.setAttribute('aria-pressed', String(playback.captionsEnabled));
  }
  function readPage() {
    if (!enabled() || !controller || document.hidden) return;
    const page = controller.readWatchPage();
    if (!page.isWatch) return;
    title.textContent = page.title || 'Loading video…';
    const viewCount = Number(page.viewCount);
    const views = viewCount > 0 ? viewCount.toLocaleString('en-US') + (viewCount === 1 ? ' view' : ' views') : '';
    meta.textContent = [page.channel, views].filter(Boolean).join(' · ');
    avatarButton.setAttribute('aria-label', page.channel ? 'Channel: ' + page.channel : 'Channel');
    avatarButton.title = page.channel || 'Channel';
    if (page.avatar && avatarImage.getAttribute('src') !== page.avatar) {
      avatarImage.setAttribute('src', page.avatar);
      avatarImage.hidden = false; avatarFallback.hidden = true;
    } else if (!page.avatar) { avatarImage.hidden = true; avatarFallback.hidden = false; }
    avatarFallback.textContent = page.channel?.slice(0, 1) || '●';
    subscribeButton.children[0].textContent = page.subscribed ? 'Subscribed' : 'Subscribe';
    subscribeButton.setAttribute('aria-label', page.subscribed ? 'Subscribed, manage subscription' : 'Subscribe');
    subscribeButton.setAttribute('aria-pressed', String(!!page.subscribed));
    likeButton.setAttribute('aria-pressed', String(!!page.liked));
    dislikeButton.setAttribute('aria-pressed', String(!!page.disliked));
    descriptionText = page.description;
    const next = page.recommendations;
    const key = JSON.stringify(next.map(item => [item.key, item.label, item.thumbnail, item.thumbnailFallback, item.channel, item.metadata, item.duration]));
    if (key !== recommendationKey) {
      const saved = focusManager?.capture('watch');
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
        if (item.duration) thumbnail.append(make('span', 'card-duration', item.duration));
        card.append(thumbnail, make('div', 'card-title', item.label), make('div', 'card-meta', item.channel));
        if (item.metadata) card.append(make('div', 'card-meta', item.metadata));
        card.addEventListener('click', () => openVideo(item.key)); return card;
      });
      recommendations.replaceChildren(...cards);
      updateRecommendationPage();
      if (watchState().row === 'recommendations') {
        if (!focusManager?.suspended && !hasTemporaryLayer()) focusManager?.restore(saved);
        else if (!cards.length) { send({ type: 'WATCH_EMPTY' }); }
      }
    }
    empty.hidden = cards.length > 0;
    const features = controller.readWatchFeatures?.() || {};
    empty.textContent = features.recommendations === 'failed' ? 'Recommendations are unavailable. Playback continues normally.' : 'No recommendations yet, or still loading…';
    panels.refresh();
    updateProgress();
  }
  function openVideo(key) {
    if (controller.request('recommendation', key) === 'missing') { feedback('Recommendations have changed. Please select again.'); readPage(); }
  }
  function hasTemporaryLayer() {
    return !!(watchState().panel || focusManager?.suspended || controller.hasTemporaryLayer?.());
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
    if (!active) { document.documentElement.classList.remove('ytg-settings-open'); clearFeedback(); }
    if (active) {
      const nextRoute = controller.readRoute().key;
      if (nextRoute !== route) {
        route = nextRoute; recommendationKey = ''; send({ type: 'WATCH_RESET', playIndex });
        clearFeedback(); recommendationStart = 0;
        lastPaused = undefined; cards = []; recommendations.replaceChildren();
      }
      readPage();
    }
  }
  progress.addEventListener('click', event => {
    updateProgress();
    if (progress.disabled) return;
    send({ type: 'WATCH_FOCUS', region: 'progress' }); focus();
    const rect = progress.getBoundingClientRect();
    if (video?.timeline.canSeek && event.detail > 0 && rect.width) controller.request('seek', video.timeline.start + (event.clientX - rect.left) / rect.width * (video.timeline.end - video.timeline.start));
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
    updateProgress();
    const result = send({ type: 'WATCH_INPUT', action, canSeek: !progress.disabled,
      availableControls: controls.flatMap((node, index) => node.disabled || node.hidden ? [] : [index]), scrollDelta, commentCount: panels.buttons.length,
      cardCount: cards.length, cardColumns: recommendationColumns(), controlCount: controls.length,
      recommendationKey: cards[watchState().index]?.dataset.videoId, controlAction: controls[watchState().index]?.dataset.action });
    for (const effect of result.effects) {
      switch (effect.type) {
        case 'closePanel': closePanel(); break;
        case 'panelClick': (watchState().panel === 'comments' ? [close, ...panels.buttons][watchState().panelIndex] : close)?.click(); break;
        case 'panelScroll': sheet.scrollBy({ top: effect.value, behavior: 'instant' }); break;
        case 'loadComments': panels.load(); break;
        case 'loadRecommendations':
          if (controller.request('moreRecommendations') === false) feedback('No more recommendations');
          break;
        case 'focus': focus(); break;
        case 'mode': controller.request('mode', effect.value); break;
        case 'recommendation': openVideo(effect.value); break;
        case 'activate': activate(effect.value); break;
      }
    }
    return result.disposition !== 'pass';
  }

  function recommendationColumns() {
    return 4;
  }
  function updateRecommendationPage() {
    const index = watchState().row === 'recommendations' ? watchState().index : watchState().recommendationIndex;
    const start = Math.floor(Math.min(index, Math.max(0, cards.length - 1)) / 4) * 4;
    cards.forEach((card, position) => { card.hidden = position < start || position >= start + 4; });
    if (start !== recommendationStart && watchState().row === 'recommendations' && !host.hidden) {
      animateFeedback(recommendations, [{ opacity: 0, translate: (start > recommendationStart ? '16px 0' : '-16px 0') }, { opacity: 1, translate: '0 0' }], 160);
    }
    recommendationStart = start;
    recommendations.setAttribute('aria-label', `Recommended videos, group ${Math.floor(start / 4) + 1}, ${cards.length} videos total`);
  }

  function focusItems(region) {
    const nodes = region === 'recommendations' ? cards : region === 'progress' ? [progress] : region === 'panel' ? [close, ...panels.buttons] : controls;
    return nodes.flatMap((node, position) => node.isConnected && !node.hidden && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
      ? [{ region, itemKey: node.dataset.videoId || node.dataset.action || String(position), index: position }] : []);
  }
  const unregisterFocus = focusManager?.register('watch', {
    active: () => enabled() && !host.hidden && mode() === 'controls' && !controller.hasNativeLayer?.(),
    capture() {
      const region = watchState().panel ? 'panel' : watchState().row, position = watchState().panel ? watchState().panelIndex : watchState().row === 'progress' ? 0 : watchState().index;
      return { ...focusItems(region).find(item => item.index === position), region, index: position, scope: watchState().panel ? dialog : null };
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
  window.YTGamepadWatch = {
    /** @param {import('./types/ports.js').WatchPort} port */
    connect(port) { controller = port; }, sync, show, handle, handleInput, mediaFeedback, refresh: readPage,
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
  return published;
  } };
})();
