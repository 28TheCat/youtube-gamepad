// Compact navigation chrome; YouTube still owns feeds, search and category data.
(() => {
  const lifecycle = window.YTGamepadRuntime.scope('browse');
  const paths = {
    search: 'M10.8 3a7.8 7.8 0 1 0 0 15.6A7.8 7.8 0 0 0 10.8 3Zm0 2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6ZM17 16l5 5-1.4 1.4-5-5Z',
    guide: 'M3 5h18v2H3Zm0 6h18v2H3Zm0 6h18v2H3Z'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('ytg-nav-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]); svg.append(path); return svg;
  }
  function addLabel(node, label, name) {
    node.setAttribute('aria-label', label);
    const text = document.createElement('span');
    text.className = 'ytg-nav-label'; text.textContent = label;
    node.append(icon(name), text); return text;
  }
  function actionButton(label, name, action) {
    const button = document.createElement('button'); button.type = 'button';
    button.dataset.browseAction = action; addLabel(button, label, name);
    button.addEventListener('click', () => {
      if (action === 'guide') document.querySelector('ytd-masthead #guide-button button,ytd-masthead button#guide-button,ytd-masthead #guide-button')?.click();
      else window.YTGamepad?.act(action);
    });
    return button;
  }
  const top = document.createElement('header'); top.id = 'ytg-browse-top';
  top.setAttribute('aria-label', '搜索与页面导航');
  const guide = actionButton('展开或收起侧栏', 'guide', 'guide');
  guide.className = 'ytg-top-guide';
  const topSearch = actionButton('搜索', 'search', 'search');
  topSearch.className = 'ytg-top-search';
  const brand = document.createElement('div'); brand.className = 'ytg-top-brand';
  brand.setAttribute('aria-label', 'YouTube');
  const mark = document.createElement('span'); mark.className = 'ytg-brand-mark';
  mark.setAttribute('aria-hidden', 'true');
  const brandName = document.createElement('span'); brandName.textContent = 'YouTube';
  brand.append(mark, brandName); top.append(guide, topSearch, brand);
  document.body.append(top);
  let categoryTimer, categoryObserver, categoryDeadline;
  const feedSignature = () => Array.from(document.querySelectorAll('ytd-page-manager a#thumbnail[href],ytd-page-manager yt-lockup-view-model a[href^="/watch?"]'))
    .map(link => link.getAttribute('href')).join('|');
  function stopCategoryWatch() {
    lifecycle.clearTimeout(categoryTimer); lifecycle.clearTimeout(categoryDeadline); categoryObserver?.disconnect();
  }
  lifecycle.listen(document, 'click', event => {
    if (!document.documentElement.classList.contains('ytg-browse') || !event.target.closest?.('yt-chip-cloud-chip-renderer')) return;
    const route = location.pathname + location.search;
    const previous = feedSignature();
    stopCategoryWatch();
    categoryObserver = lifecycle.observer(() => {
      lifecycle.clearTimeout(categoryTimer);
      categoryTimer = lifecycle.timeout(() => {
        if (route !== location.pathname + location.search || !document.documentElement.classList.contains('ytg-browse')) { stopCategoryWatch(); return; }
        const next = feedSignature();
        if (!next || next === previous) return;
        stopCategoryWatch();
        if (!window.YTGamepad?.hasTemporaryLayer && !window.YTGamepadMenu?.opened) window.YTGamepad?.resetContentFocus();
      }, 150);
    });
    const feed = document.querySelector('ytd-page-manager');
    if (feed) categoryObserver.observe(feed, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    categoryDeadline = lifecycle.timeout(stopCategoryWatch, 5000);
  }, true);
  function sync() {
    const enabled = document.documentElement.classList.contains('ytg-theater') &&
      !document.documentElement.hasAttribute('data-ytg-native') &&
      location.pathname !== '/watch' && !location.pathname.startsWith('/shorts/');
    if (document.documentElement.classList.contains('ytg-browse') !== enabled)
      document.documentElement.classList.toggle('ytg-browse', enabled);
    if (!enabled) {
      stopCategoryWatch();
      if (top.contains(document.activeElement)) document.activeElement.blur();
    }
    const query = new URLSearchParams(location.search).get('search_query');
    topSearch.querySelector('.ytg-nav-label').textContent = query || '搜索';
  }
  const observer = lifecycle.observer(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-ytg-native'] });
  lifecycle.listen(document, 'yt-navigate-finish', sync);
  lifecycle.listen(document, 'yt-page-data-updated', sync);
  lifecycle.listen(window, 'popstate', sync);
  sync();
  lifecycle.cleanup(() => {
    stopCategoryWatch(); top.remove();
    document.documentElement.classList.remove('ytg-browse');
  });
})();
