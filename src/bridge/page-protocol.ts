import type { YouTubeVideoDetails } from '../../types/core';

export const PAGE_REQUEST = 'ytg-page-request-v1';
export const PAGE_RESPONSE = 'ytg-page-response-v1';
export const PAGE_HISTORY = 'ytg-page-history-v1';
export type PageOperation = 'ping' | 'readVideoDetails' | 'showControls' | 'hideControls';
export interface PageAccess {
  ping?(): boolean;
  readonly available?: boolean;
  readVideoDetails(): YouTubeVideoDetails | undefined;
  showControls(): void;
  hideControls(): void;
}

// All data crossing the page boundary is untrusted, including private API output.
export function videoDetails(raw: unknown): YouTubeVideoDetails | undefined {
  if (!raw || typeof raw !== 'object') return;
  const source = raw as Record<string, unknown>;
  const result: YouTubeVideoDetails = {};
  for (const key of ['videoId', 'title', 'author', 'shortDescription', 'channelId', 'viewCount'] as const) {
    if (typeof source[key] === 'string') result[key] = source[key].slice(0, key === 'shortDescription' ? 20000 : 2000);
  }
  if (typeof source.isLive === 'boolean') result.isLive = source.isLive;
  return result;
}

export function parsePageMessage(detail: unknown): Record<string, unknown> | undefined {
  if (typeof detail !== 'string' || detail.length > 40000) return;
  try {
    const value = JSON.parse(detail);
    if (value && typeof value === 'object' && value.version === 1) return value;
  } catch { /* Malformed page traffic is ignored. */ }
}
