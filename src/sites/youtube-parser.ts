import { Misc, Parser, YTNodes } from 'youtubei.js/web';

export type ParsedPage = ReturnType<typeof Parser.parseResponse>;
type Node = Record<string, any>;
Parser.setParserErrorHandler(() => {});

// 18.1.0 defaults omitted style ranges, but not command ranges. Commands can
// also span multiple styled runs, which its single-run matcher cannot handle.
// Collaborative owner titles can report command lengths beyond their content.
// Repair the public Text factory so every library renderer uses the same fix.
const textFactory = Misc.Text.fromAttributed as typeof Misc.Text.fromAttributed & { ytgCommandRanges?: boolean };
if (!textFactory.ytgCommandRanges) {
  Misc.Text.fromAttributed = Object.assign(function (this: typeof Misc.Text, data: Parameters<typeof textFactory>[0]) {
    if (!data.commandRuns?.length) return textFactory.call(this, data);
    const commands = data.commandRuns.flatMap(run => {
      const startIndex = run.startIndex ?? 0;
      const length = run.length ?? data.content.length - startIndex;
      if (!Number.isInteger(startIndex) || !Number.isInteger(length) || length <= 0) return [];
      const start = Math.max(0, startIndex);
      const end = Math.min(data.content.length, startIndex + length);
      return end > start ? [{ ...run, startIndex: start, length: end - start }] : [];
    });
    const boundaries = new Set<number>();
    for (const run of [...(data.styleRuns || []), ...commands]) {
      const start = run.startIndex ?? 0;
      boundaries.add(start);
      boundaries.add(start + (run.length ?? data.content.length));
    }
    const commandRuns = commands.flatMap(run => {
      const end = run.startIndex + run.length;
      const cuts = [run.startIndex, ...[...boundaries].filter(index => index > run.startIndex && index < end), end]
        .sort((a, b) => a - b);
      return cuts.slice(1).map((index, i) => ({ ...run, startIndex: cuts[i], length: index - cuts[i] }));
    });
    return textFactory.call(this, { ...data, commandRuns });
  }, { ytgCommandRanges: true });
}

// Small 18.1.0 schema repairs, applied by the library's node registry. These
// provide optional defaults; they never extract cards, endpoints or tokens.
for (const name of ['Video', 'GridVideo', 'CompactVideo', 'PlaylistVideo', 'PlaylistPanelVideo', 'Movie', 'Playlist', 'Mix', 'CompactPlaylist', 'CompactMix', 'ChildVideo']) {
  const Original = Parser.getParserByName(name);
  if ((Original as any).ytgOptionalDefaults) continue;
  Parser.addRuntimeParser(name, class extends Original {
    static ytgOptionalDefaults = true;
    constructor(raw: Node) {
      const data = { ...raw };
      if (['Playlist', 'Mix', 'CompactPlaylist', 'CompactMix'].includes(name) && !data.thumbnail && !Array.isArray(data.thumbnails)) data.thumbnails = [];
      if (name === 'ChildVideo' && !data.lengthText) data.lengthText = { simpleText: '' };
      if (data.thumbnail && !Array.isArray(data.thumbnail.thumbnails) && !Array.isArray(data.thumbnail.sources)) data.thumbnail = undefined;
      if (name === 'Movie' && !Array.isArray(data.thumbnailOverlays)) data.thumbnailOverlays = [];
      if (name === 'PlaylistVideo' && data.title && !data.title.accessibility?.accessibilityData)
        data.title = { ...data.title, accessibility: { accessibilityData: { label: '' } } };
      data.ownerText ||= data.shortBylineText;
      data.longBylineText ||= data.shortBylineText || data.ownerText;
      super(data);
      if (raw.isPlayable === false) Object.assign(this, { is_playable: false });
    }
  });
}

// Parse only the active tab, once. The upstream Tab whitelist omits some
// playlist containers; the general library parser already supports them.
if (!(Parser.getParserByName('Tab') as any).ytgSelectedContent) {
  Parser.addRuntimeParser('Tab', class extends YTNodes.Tab {
    static ytgSelectedContent = true;
    constructor(raw: Node) {
      super({ ...raw, content: undefined });
      // Topic destinations can include an empty sectionList beside the real
      // richGrid. parseItem otherwise takes the first renderer and loses it.
      const content = raw.content?.richGridRenderer ? { richGridRenderer: raw.content.richGridRenderer } : raw.content;
      this.content = raw.selected ? Parser.parseItem(content) as typeof this.content : null;
    }
  });
}

// 18.1.0's Menu whitelist omits the legacy segmented rating button even
// though VideoInfo supports it. Let the library parse those buttons once.
if (!(Parser.getParserByName('Menu') as any).ytgRatingButtons) {
  Parser.addRuntimeParser('Menu', class extends YTNodes.Menu {
    static ytgRatingButtons = true;
    constructor(raw: Node) {
      super({ ...raw, topLevelButtons: undefined });
      this.top_level_buttons = Parser.parseArray(raw.topLevelButtons) as typeof this.top_level_buttons;
    }
  });
}

// A full API response is parsed once. Standalone renderer fixtures use the
// same library parser through a contents envelope, without a second parser.
export function parseYouTubePage(raw: Node): ParsedPage {
  const envelope = ['contents', 'continuationContents', 'onResponseReceivedActions',
    'onResponseReceivedCommands', 'onResponseReceivedEndpoints'].some(key => key in raw);
  return Parser.parseResponse(envelope ? raw : { contents: raw });
}

export function commandRoots(page: ParsedPage): unknown[] {
  return [page.on_response_received_actions, page.on_response_received_commands, page.on_response_received_endpoints]
    .flatMap(commands => commands?.filter((command: any) => command.slot !== 'RELOAD_CONTINUATION_SLOT_HEADER') || []);
}

export function contentRoots(page: ParsedPage): unknown[] {
  const contents = page.contents;
  let main: any = contents?.is_array ? contents.array() : contents?.item();
  if (main?.tabs) main = main.tabs.find((tab: any) => tab.selected)?.content;
  if (main?.type === 'TwoColumnSearchResults') main = main.primary_contents;
  return [main, page.continuation_contents, ...commandRoots(page)];
}

// Walk parsed content containers only. Menus, ads, watch cards and unselected
// tabs cannot leak unrelated links or continuation tokens into a list.
export function walkParsed(roots: unknown, visit: (node: any) => boolean | void, includeHeaders = false) {
  const seen = new Set<object>();
  function walk(value: any, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 35 || seen.size >= 30000 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const child of value) walk(child, depth + 1); return; }
    if (value.slot === 'RELOAD_CONTINUATION_SLOT_HEADER' || /^(?:Ad|DisplayAd|Promoted)/.test(value.type || '')) return;
    if (visit(value) === false) return;
    if (value.tabs) { walk(value.tabs.find((tab: any) => tab.selected)?.content, depth + 1); return; }
    for (const key of ['contents', 'items', 'content', 'chips', 'videos', 'primary', 'primary_contents']) walk(value[key], depth + 1);
    if (includeHeaders) walk(value.header, depth + 1);
  }
  walk(roots, 0);
}

export function continuationToken(roots: unknown): string | undefined {
  let token: string | undefined;
  walkParsed(roots, node => {
    if (token) return false;
    const value = node.type === 'ContinuationItem' || node.type === 'ContinuationItemView'
      ? node.endpoint?.payload?.token : node.continuation;
    if (typeof value === 'string') { token = value; return false; }
  });
  return token;
}

export function parsedChips(page: ParsedPage): InstanceType<typeof YTNodes.ChipCloudChip>[] {
  const chips: InstanceType<typeof YTNodes.ChipCloudChip>[] = [];
  const header = page.header;
  walkParsed([...contentRoots(page), header?.is_array ? header.array() : header?.item()], node => {
    if (node.type === 'ChipCloudChip') { chips.push(node); return false; }
  }, true);
  return chips;
}

export function listEndpoint(endpoint?: InstanceType<typeof YTNodes.NavigationEndpoint>): { path: 'browse' | 'search'; body: Node } | undefined {
  if (!endpoint) return;
  const path = endpoint.metadata.api_url?.replace(/^\/+/, '');
  if (path && !['browse', 'search'].includes(path)) return;
  const payload = endpoint.payload;
  if (endpoint.name === 'browseEndpoint' && typeof payload.browseId === 'string')
    return { path: 'browse', body: { browseId: payload.browseId, ...(typeof payload.params === 'string' ? { params: payload.params } : {}) } };
  if (endpoint.name === 'searchEndpoint' && typeof payload.query === 'string')
    return { path: 'search', body: { query: payload.query, ...(typeof payload.params === 'string' ? { params: payload.params } : {}) } };
  if (endpoint.name === 'continuationCommand' && typeof payload.token === 'string')
    return { path: path === 'search' ? 'search' : 'browse', body: { continuation: payload.token } };
}
