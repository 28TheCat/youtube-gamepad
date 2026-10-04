// Safe DOM construction and styling. No site operations or interaction state.
(() => {
  if (window.YTGamepadWatchView) return;
  window.YTGamepadWatchView = { create({ activate, closePanel }) {
  const host = document.createElement('div');
  host.id = 'ytg-watch'; host.hidden = true;
  const root = host.attachShadow({ mode: 'open' });
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const style = make('style');
  style.textContent = window.YTGamepadStyles.watch;
  const surface = make('div', 'surface'), heading = make('header', 'heading');
  const title = make('h1', 'title', '正在加载视频…'), meta = make('p', 'meta', '');
  heading.append(title, meta);
  const bottom = make('section', 'bottom'), times = make('div', 'times');
  const elapsed = make('span', '', '0:00'), duration = make('span', '', '0:00');
  times.append(elapsed, duration);
  const progress = make('button', 'progress');
  progress.setAttribute('role', 'slider'); progress.setAttribute('aria-label', '播放进度');
  progress.setAttribute('aria-valuemin', '0');
  const track = make('span', 'track'), fill = make('span', 'fill'); track.append(fill); progress.append(track);
  const toolbar = make('nav', 'toolbar'); toolbar.setAttribute('aria-label', '视频操作');
  const left = make('div', 'group'), center = make('div', 'group'), right = make('div', 'group');
  const paths = { previous: 'M6 5v14M19 5 8 12l11 7Z', next: 'M18 5v14M5 5l11 7-11 7Z', pause: 'M8 5v14M16 5v14', play: 'm8 4 12 8-12 8Z', captions: 'M3 5h18v14H3ZM10 9H7v6h3m7-6h-3v6h3', settings: 'M10 2h4l.5 3 2 .9 2.5-1.4 2 3.5-2.4 1.7v2.6l2.4 1.7-2 3.5-2.5-1.4-2 .9-.5 3h-4l-.5-3-2-.9-2.5 1.4-2-3.5 2.4-1.7V9.7L2.5 8l2-3.5L7 5.9l2-.9ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', like: 'M7 10v11H3V10ZM7 10l5-8c3 0 3 3 1 7h6a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7', dislike: 'M7 14V3H3v11ZM7 14l5 8c3 0 3-3 1-7h6a2 2 0 0 0 2-2l-2-8a2 2 0 0 0-2-2H7', comments: 'M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-9l-6 4v-4H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM7 8h10M7 12h7', save: 'M6 3h12v18l-6-4-6 4Z' };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]); svg.append(path); return svg;
  }
  const controls = [];
  function button(group, label, action, symbol) {
    const node = make('button', 'control' + (action === 'playPause' ? ' play' : ''));
    node.setAttribute('aria-label', label); node.dataset.action = action;
    node.title = label;
    node.append(symbol ? icon(symbol) : make('span', '', label));
    node.addEventListener('click', () => activate(action));
    group.append(node); controls.push(node); return node;
  }
  const avatarButton = button(left, '频道', 'channel'); avatarButton.classList.add('avatar');
  const avatarImage = make('img'); avatarImage.alt = ''; avatarImage.hidden = true;
  const avatarFallback = make('span', '', '●');
  avatarImage.addEventListener('error', () => { avatarImage.hidden = true; avatarFallback.hidden = false; });
  avatarButton.replaceChildren(avatarImage, avatarFallback);
  button(left, '说明', 'description');
  const subscribeButton = button(left, '订阅', 'subscribe');
  button(center, '后退 10 秒', 'seekBack', 'previous');
  const playButton = button(center, '播放 / 暂停', 'playPause', 'pause');
  button(center, '前进 10 秒', 'seekForward', 'next');
  const social = make('div', 'cluster'), preferences = make('div', 'cluster');
  const likeButton = button(social, '点赞', 'like', 'like');
  const dislikeButton = button(social, '点踩', 'dislike', 'dislike');
  button(social, '评论', 'comments', 'comments');
  button(social, '保存到播放列表', 'save', 'save');
  const captionsButton = button(preferences, '字幕', 'captions', 'captions');
  button(preferences, '设置', 'settings', 'settings');
  right.append(social, preferences);
  toolbar.append(left, center, right);
  const recommendations = make('div', 'recommendations'); recommendations.setAttribute('aria-label', '推荐视频');
  const empty = make('p', 'empty', '推荐视频正在加载…');
  progress.addEventListener('click', () => activate('adjustProgress'));
  const hint = make('div', 'hint');
  let hintMode;
  function updateHint(row, adjusting) {
    const mode = row === 'progress' ? (adjusting ? 'adjusting' : 'progress') : 'controls';
    if (mode === hintMode) return;
    hintMode = mode;
    const entries = mode === 'adjusting' ? [['← / →', '调整进度'], ['A', '结束调整'], ['B', '返回进度条']]
      : mode === 'progress' ? [['A', '开始调整'], ['↓ / B', '返回控制栏']]
      : [['A', '确认'], ['B', '返回'], ['↑', '进度 · A 调整'], ['↓', '推荐'], ['LB / RB', '快退快进'], ['Start', '菜单']];
    hint.replaceChildren();
    for (const [key, label] of entries) {
      const item = make('span', 'hint-item');
      item.append(make('kbd', '', key), make('span', '', label));
      hint.append(item);
    }
  }
  updateHint('controls', false);
  bottom.append(times, progress, toolbar, recommendations, empty, hint);
  surface.append(heading, bottom);
  const dialog = make('div', 'dialog'); dialog.hidden = true; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '视频说明');
  const sheet = make('section', 'sheet'), panelTitle = make('h2', '', '视频说明'), description = make('div', 'description');
  const close = make('button', 'control', '返回'); close.addEventListener('click', closePanel);
  sheet.append(panelTitle, description, close); dialog.append(sheet);
  const status = make('div', 'status', ''); status.setAttribute('role', 'status');
  root.append(style, surface, dialog, status); document.body.append(host);
  return { host, root, make, surface, title, meta, progress, fill, elapsed, duration, icon, controls, avatarButton, avatarImage, avatarFallback, subscribeButton, playButton, likeButton, dislikeButton, captionsButton, recommendations, empty, dialog, sheet, panelTitle, description, close, status, hint, updateHint };
  } };
})();
