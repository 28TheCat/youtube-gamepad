import { Helpers, YT, YTNodes } from 'youtubei.js/web';
import type { Context } from 'youtubei.js/web';
import { createYouTubeSession } from './youtube-session';
import type { FeedCategory } from './youtube-feed';
import type { ChannelHeader } from '../shared/browse-data';
import { browsePage } from './youtube-search';
import { listEndpoint, parseYouTubePage, type ParsedPage } from './youtube-parser';

type Node = Record<string, any>;
export interface ChannelChoice extends FeedCategory { body: Node }

const key = (label: string) => {
  let hash = 2166136261;
  for (const character of label) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
};

export function parseChannelPage(raw: Node, context: Context, parsed?: ParsedPage) {
  const choices: ChannelChoice[] = [];
  const page = parsed || parseYouTubePage(raw);
  const result = browsePage(page);
  const header: any = page.header?.is_array ? undefined : page.header?.item();
  const view = header?.content;
  const text = (value: any) => value?.toString?.() === '[object Object]' ? '' : String(value || '').slice(0, 2000);
  const image = (images: any) => Array.isArray(images) ? images.find(item => {
    try { return new URL(item.url).protocol === 'https:'; } catch { return false; }
  })?.url || '' : '';
  const title = text(header?.page_title || view?.title?.text || header?.author?.name);
  const channelHeader: ChannelHeader | undefined = title ? {
    title, avatar: image(view?.image?.avatar?.image || view?.image?.image || header?.author?.thumbnails),
    banner: image(view?.banner?.image || header?.banner),
    metadata: view?.metadata?.metadata_rows?.map((row: any) => row.metadata_parts?.map((part: any) => text(part.text)).filter(Boolean).join(' · ')).filter(Boolean).join(' · ') ||
      [header?.channel_handle, header?.subscribers, header?.videos_count].map(text).filter(Boolean).join(' · '),
    description: text(view?.description?.description || header?.tagline?.content)
  } : undefined;
  const output = { ...result, ...(channelHeader ? { channelHeader } : {}) };
  const main: any = page.contents?.is_array ? undefined : page.contents?.item();
  if (!main?.tabs) return { ...output, choices };
  try {
    // Channel's control helpers reuse the parsed page. Continuations need no
    // Channel or Session instance, and no library HTTP method is called.
    const currentTab = main.tabs.find((tab: any) => tab.selected);
    const tabKey = key(currentTab?.endpoint.metadata.url || currentTab?.title || 'channel');
    function add(kind: 'tab' | 'sort', label: unknown, endpoint: any, selected = false) {
      if (typeof label !== 'string' || !label.trim() || label === 'N/A') return;
      const request = listEndpoint(endpoint);
      if (request?.path !== 'browse') return;
      const body = request.body;
      choices.push({ id: `channel:${kind}:${kind === 'sort' ? tabKey + ':' : ''}${key(label)}`,
        label: label.slice(0, 80), selected, body });
    }
    for (const tab of page.contents_memo?.getType(YTNodes.Tab) || []) {
      const url = tab.endpoint.metadata.url;
      try {
        const target = new URL(url || '', 'https://www.youtube.com');
        if (target.origin === 'https://www.youtube.com' &&
          /\/(?:featured|videos|shorts|streams|playlists|releases|podcasts|courses|shows)\/?$/.test(target.pathname))
          add('tab', tab.title, tab.endpoint, tab.selected === true);
      } catch { /* Ignore malformed tab destinations. */ }
    }
    for (const item of page.contents_memo?.getType(YTNodes.SortFilterSubMenu)[0]?.sub_menu_items || [])
      add('sort', item.title, item.endpoint, item.selected === true);
    try {
      const session = createYouTubeSession(context, async () => { throw Error('Unexpected channel request'); });
      // Channel requires a two-column shell; reuse already parsed tabs for
      // single-column responses rather than parsing their cards a second time.
      let controlsPage = page;
      if (main.type === 'SingleColumnBrowseResults') {
        const layout = new YTNodes.TwoColumnBrowseResults({});
        layout.tabs = main.tabs;
        controlsPage = { ...page, contents: new Helpers.SuperParsedResult(layout) };
      }
      const channel = new YT.Channel(session.actions, controlsPage, true);
      for (const item of channel.filter_nodes.primary_filters || []) {
        const node = item as any;
        if (node.is_disabled) continue;
        add('sort', node.text?.toString() || node.title?.toString(),
          node.endpoint || node.renderer_context?.command_context?.on_tap, node.is_selected === true);
      }
    } catch { /* Unknown filters must not hide channel videos. */ }
  } catch { /* Unavailable channel controls must not discard parsed cards. */ }
  return { ...output, choices: [...new Map(choices.map(item => [item.id, item])).values()] };
}
