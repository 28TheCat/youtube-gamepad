import { Session, YT, YTNodes, Parser } from 'youtubei.js/web';
import type { Context } from 'youtubei.js/web';
import type { FeedCategory, FeedResult } from './youtube-feed';
import { searchItems } from './youtube-search';

type Node = Record<string, any>;
export interface ChannelChoice extends FeedCategory { body: Node }

function channelFeed(page: ReturnType<typeof Parser.parseResponse>): FeedResult {
  const contents = page.contents;
  const main: any = contents?.is_array ? contents.array() : contents?.item();
  const root = main?.type === 'TwoColumnBrowseResults' ? main.tabs.find((tab: any) => tab.selected)?.content : main;
  const roots = [root, page.continuation_contents,
    ...[page.on_response_received_actions, page.on_response_received_commands, page.on_response_received_endpoints]
      .flatMap(commands => commands?.filter((command: any) => command.slot !== 'RELOAD_CONTINUATION_SLOT_HEADER') || [])];
  const visited = new Set<object>();
  function token(value: any, depth = 0): string | undefined {
    if (!value || typeof value !== 'object' || depth > 35 || visited.size >= 30000 || visited.has(value)) return;
    visited.add(value);
    if (['ContinuationItem', 'ContinuationItemView'].includes(value.type) && typeof value.endpoint?.payload?.token === 'string')
      return value.endpoint.payload.token;
    if (typeof value.continuation === 'string') return value.continuation;
    for (const child of Array.isArray(value) ? value : [value.contents, value.items, value.content, value.videos]) {
      const next = token(child, depth + 1);
      if (next) return next;
    }
  }
  return { items: searchItems(roots), continuation: token(roots) };
}

const key = (label: string) => {
  let hash = 2166136261;
  for (const character of label) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
};

// YouTube resolves aliases and tab parameters. Only parsed browse endpoints
// may reach the transport; no caller-provided URL becomes a fetch destination.
export function channelEndpoint(raw: Node): Node | undefined {
  const endpoint = new YTNodes.NavigationEndpoint(raw.endpoint);
  if (endpoint?.metadata.api_url && endpoint.metadata.api_url !== 'browse') return;
  const payload = endpoint?.payload;
  if (typeof payload?.browseId !== 'string') return;
  return { browseId: payload.browseId,
    ...(typeof payload.params === 'string' ? { params: payload.params } : {}) };
}

export function parseChannelPage(raw: Node, context: Context, fallback: (raw: Node) => FeedResult) {
  const choices: ChannelChoice[] = [];
  const tabs = raw.contents?.twoColumnBrowseResultsRenderer?.tabs || raw.contents?.singleColumnBrowseResultsRenderer?.tabs;
  const selected = tabs?.map((entry: Node) => entry.tabRenderer).find((tab: Node) => tab?.selected);
  // Keep sibling tab endpoints, but parse only the selected tab's content.
  // Channel and card conversion share this one parsed response.
  const data = tabs ? { ...raw, contents: { twoColumnBrowseResultsRenderer: {
    tabs: tabs.map((entry: Node) => entry.tabRenderer ? { ...entry, tabRenderer: {
      ...entry.tabRenderer, content: entry.tabRenderer === selected ? selected.content : undefined
    } } : entry)
  } } } : raw;
  let result: FeedResult;
  let page: ReturnType<typeof Parser.parseResponse>;
  try {
    page = Parser.parseResponse(data);
    result = channelFeed(page);
    if (!page.contents && !page.continuation_contents && !page.on_response_received_actions &&
      !page.on_response_received_commands && !page.on_response_received_endpoints)
      result = fallback(selected?.content || raw);
  } catch {
    return { ...fallback(selected?.content || raw), choices };
  }
  if (!tabs) return { ...result, choices };
  try {
    // Channel's control helpers reuse the parsed page. Continuations need no
    // Channel or Session instance, and no library HTTP method is called.
    const session = new Session(structuredClone({ ...context, user: context.user || {} }), '', 'v1', 0);
    const channel = new YT.Channel(session.actions, page, true);
    const tabKey = key(channel.current_tab?.endpoint.metadata.url || channel.current_tab?.title || 'channel');
    function add(kind: 'tab' | 'sort', label: unknown, endpoint: any) {
      if (typeof label !== 'string' || !label.trim() || label === 'N/A') return;
      if (endpoint?.metadata?.api_url && endpoint.metadata.api_url !== 'browse') return;
      const payload = endpoint?.payload;
      const body = typeof payload?.browseId === 'string' ? {
        browseId: payload.browseId, ...(typeof payload.params === 'string' ? { params: payload.params } : {})
      } : typeof payload?.token === 'string' ? { continuation: payload.token } : undefined;
      if (!body) return;
      choices.push({ id: `channel:${kind}:${kind === 'sort' ? tabKey + ':' : ''}${key(label)}`,
        label: (kind === 'sort' ? `Sort · ${label}` : label).slice(0, 80), selected: false, body });
    }
    for (const tab of channel.memo.getType(YTNodes.Tab)) {
      const url = tab.endpoint.metadata.url;
      try {
        const target = new URL(url || '', 'https://www.youtube.com');
        if (target.origin === 'https://www.youtube.com' &&
          /\/(?:featured|videos|shorts|streams|playlists|releases|podcasts|courses|shows)\/?$/.test(target.pathname))
          add('tab', tab.title, tab.endpoint);
      } catch { /* Ignore malformed tab destinations. */ }
    }
    for (const item of channel.memo.getType(YTNodes.SortFilterSubMenu)[0]?.sub_menu_items || [])
      add('sort', item.title, item.endpoint);
    try {
      for (const item of channel.filter_nodes.primary_filters || []) {
        const node = item as any;
        if (node.is_disabled) continue;
        add('sort', node.text?.toString() || node.title?.toString(),
          node.endpoint || node.renderer_context?.command_context?.on_tap);
      }
    } catch { /* Unknown filters must not hide channel videos. */ }
  } catch { /* Unavailable channel controls must not discard parsed cards. */ }
  return { ...result, choices: [...new Map(choices.map(item => [item.id, item])).values()] };
}
