import { Innertube, Session, Parser } from 'youtubei.js/web';
import { createYouTubeHeaders, requestYouTube } from './youtube-request';

export interface AccountProfile {
  key: string; name: string; handle: string; avatar: string; selected: boolean; disabled: boolean;
}
export interface AccountSnapshot { signedIn: boolean; accounts: AccountProfile[] }

// Identity-switching commands and credentials stay in MAIN. Only display data
// crosses the bridge; this service never changes the active account.
export function createAccountService() {
  let destroyed = false, controller = new AbortController();
  let identity = '', cached: AccountSnapshot | undefined, loadedAt = 0;
  let pending: Promise<AccountSnapshot> | undefined;
  const config = (key: string) => (window as any).ytcfg?.get?.(key);
  async function read(refresh = false): Promise<AccountSnapshot> {
    if (destroyed) return Promise.reject(Error('Account service destroyed'));
    const sid = document.cookie.split(/;\s*/).find(value => value.startsWith('SAPISID='))?.slice(8)
      || document.cookie.split(/;\s*/).find(value => value.startsWith('__Secure-3PAPISID='))?.slice(18) || '';
    const signedIn = config('LOGGED_IN') === true || config('LOGGED_IN') !== false && !!sid;
    const context = config('INNERTUBE_CONTEXT');
    const key = JSON.stringify([sid, signedIn, config('SESSION_INDEX'), config('DELEGATED_SESSION_ID'), context?.user]);
    if (identity !== key) {
      controller.abort(); controller = new AbortController(); identity = key;
      cached = undefined; pending = undefined; loadedAt = 0;
    }
    if (!signedIn) return Promise.resolve({ signedIn: false, accounts: [] });
    if (!context?.client) return Promise.reject(Error('YouTube context unavailable'));
    if (pending) return pending;
    if (cached && Date.now() - loadedAt < (refresh ? 2000 : 60000)) return Promise.resolve(structuredClone(cached));
    const signal = controller.signal;
    const session = new Session(structuredClone({ ...context, user: context.user || {} }), '', 'v1', 0,
      undefined, undefined, undefined, async () => { throw Error('Unexpected account request'); });
    session.logged_in = true;
    session.actions.execute = (async (endpoint: string, args: Record<string, any>) => {
      if (endpoint.replace(/^\//, '') !== 'account/accounts_list') throw Error('Unexpected account endpoint');
      const headers = await createYouTubeHeaders(context, sid);
      if (destroyed || signal.aborted || identity !== key) throw Error('Account request cancelled');
      const raw = await requestYouTube('account/accounts_list', { method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ context, requestType: args.requestType, callCircumstance: args.callCircumstance }), signal });
      if (destroyed || signal.aborted || identity !== key) throw Error('Account request cancelled');
      return args.parse ? Parser.parseResponse(raw) : { success: true, status_code: 200, data: raw };
    }) as typeof session.actions.execute;
    const task = (async () => {
      const items = await new Innertube(session).account.getInfo(true);
      const accounts = items.slice(0, 50).map((item, index) => {
        let avatar = '';
        const url = item.account_photo?.[0]?.url;
        try { if (url && url.length <= 4096 && new URL(url).protocol === 'https:') avatar = url; } catch { /* No avatar. */ }
        return { key: String(index), name: item.account_name.toString().slice(0, 200),
          handle: item.channel_handle.toString().slice(0, 200), avatar,
          selected: item.is_selected, disabled: item.is_disabled };
      });
      if (!accounts.length) throw Error('Account list unavailable');
      if (destroyed || signal.aborted || identity !== key) throw Error('Account request cancelled');
      cached = { signedIn: true, accounts }; loadedAt = Date.now();
      return structuredClone(cached);
    })();
    pending = task;
    void task.finally(() => { if (pending === task) pending = undefined; }).catch(() => {});
    return task;
  }
  return { read, destroy() { destroyed = true; controller.abort(); cached = undefined; pending = undefined; } };
}
