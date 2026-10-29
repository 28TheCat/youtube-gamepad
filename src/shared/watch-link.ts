/** A playlist directory entry has no required first video. */
export function parsePlaylistLink(raw: unknown, origin = 'https://www.youtube.com') {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = new URL(raw, origin), id = url.searchParams.get('list');
    if (url.origin !== origin || url.pathname !== '/playlist' || url.hash || url.username || url.password ||
      !id || !/^[\w-]{1,200}$/.test(id) || url.searchParams.getAll('list').length !== 1 || [...url.searchParams.keys()].some(key => key !== 'list')) return null;
    return { id: `playlist:${id}`, href: `/playlist?list=${id}` };
  } catch { return null; }
}

/** A bounded Shorts destination shared by feed parsing and the page bridge. */
export function parseShortLink(raw: unknown, origin = 'https://www.youtube.com') {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = new URL(raw, origin);
    const match = /^\/shorts\/([\w-]{1,100})$/.exec(url.pathname);
    if (url.origin !== origin || url.username || url.password || url.hash || !match) return null;
    return { id: `short:${match[1]}`, href: `/shorts/${match[1]}`, videoId: match[1] };
  } catch { return null; }
}

/** A bounded watch destination shared by feed parsing and the page bridge. */
export function parseWatchLink(raw: unknown, origin = 'https://www.youtube.com') {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || url.pathname !== '/watch' || url.hash || url.username || url.password) return null;
    const videoId = url.searchParams.get('v');
    const playlistId = url.searchParams.get('list');
    const index = url.searchParams.get('index');
    const radio = url.searchParams.get('start_radio');
    const params = url.searchParams.get('params');
    if (!videoId || !/^[\w-]{1,100}$/.test(videoId) ||
        (playlistId !== null && !/^[\w-]{1,200}$/.test(playlistId)) ||
        (index !== null && (!playlistId || !/^[1-9]\d{0,5}$/.test(index))) ||
        (radio !== null && (!playlistId || radio !== '1')) ||
        (params !== null && params.length > 2048)) return null;
    for (const key of ['v', 'list', 'index', 'start_radio', 'params']) {
      if (url.searchParams.getAll(key).length > 1) return null;
    }
    const canonical = new URL('/watch', origin);
    canonical.searchParams.set('v', videoId);
    if (playlistId) canonical.searchParams.set('list', playlistId);
    if (index) canonical.searchParams.set('index', index);
    if (radio) canonical.searchParams.set('start_radio', radio);
    if (params) canonical.searchParams.set('params', params);
    return {
      id: playlistId ? `playlist:${playlistId}:${videoId}` : `video:${videoId}`,
      href: canonical.pathname + canonical.search, videoId,
      watchEndpoint: { videoId, ...(playlistId ? { playlistId } : {}),
        ...(index ? { index: Number(index) - 1 } : {}), ...(radio ? { startRadio: true } : {}),
        ...(params ? { params } : {}) }
    };
  } catch { return null; }
}
