import { PAGE_REQUEST, PAGE_RESPONSE, parsePageMessage, videoDetails } from './page-protocol';
import type { PageAccess, PageOperation } from './page-protocol';

// DOM events cross Chrome worlds synchronously. JSON strings avoid sharing
// objects/functions and preserve the existing synchronous site port contract.
// This bridge never accepts extension API requests from the page.
export function createPageClient(): PageAccess {
  let sequence = 0;
  const session = crypto.randomUUID();
  let requesting = false;
  let available = false;
  function request(operation: PageOperation) {
    if (requesting) return;
    const id = `${session}:${++sequence}`;
    let response: Record<string, unknown> | undefined;
    const receive = (event: Event) => {
      const value = parsePageMessage((event as CustomEvent).detail);
      if (value?.id === id && value.operation === operation) response = value;
    };
    document.addEventListener(PAGE_RESPONSE, receive);
    requesting = true;
    try {
      document.dispatchEvent(new CustomEvent(PAGE_REQUEST, { detail: JSON.stringify({ version: 1, id, operation }) }));
    } finally {
      requesting = false;
      document.removeEventListener(PAGE_RESPONSE, receive);
    }
    available = response?.ok === true;
    return available ? response?.value : undefined;
  }
  return {
    get available() { return available; },
    ping: () => request('ping') === true,
    readVideoDetails: () => videoDetails(request('readVideoDetails')),
    showControls: () => { request('showControls'); },
    hideControls: () => { request('hideControls'); }
  };
}
