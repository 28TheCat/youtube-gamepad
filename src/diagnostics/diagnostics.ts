import type { Diagnostics } from '../../types/ports';
import { YTGamepadRuntime } from '../shared/runtime.ts';
let diagnosticChannel: import("../../types/ports").ApplicationChannel | undefined;
let flushDiagnostics: (() => void) | undefined;
export function configureDiagnosticsChannel(channel: import("../../types/ports").ApplicationChannel) { diagnosticChannel = channel; flushDiagnostics?.(); }
export let YTGamepadDiagnostics: Diagnostics | undefined;
// Application diagnostics use the private isolated channel in production.
(() => {
  const lifecycle = YTGamepadRuntime.scope('diagnostics');
  let ready = false;
  const pending: { module: string; operation: string; name: string; reason: string; stack: string; state: {}; }[] = [];
  const text = (value: unknown, limit?: number|undefined) => String(value ?? '').replace(/https?:\/\/[^\s)]+/g, '[URL]').slice(0, limit);
  function publish(entry: { module: string; operation: string; name: string; reason: string; stack: string; state: {}; }) {
    try { if (diagnosticChannel) diagnosticChannel.publish({ source: 'yt-gamepad-diagnostic', entry }); else window.postMessage({ source: 'yt-gamepad-diagnostic', entry }, location.origin); } catch (_) {}
  }
  function record(module: string, operation: string, error: unknown, state = {}) {
    // Diagnostics must never interfere with recovery, including exotic thrown values.
    try {
      const observed = error as {name?:unknown;message?:unknown;stack?:unknown} | null;
      const entry = { module: text(module, 40), operation: text(operation, 80),
        name: text(observed?.name || 'Error', 80), reason: text(observed?.message ?? error, 512),
        stack: text(observed?.stack, 1024), state };
      if (ready || diagnosticChannel) publish(entry);
      else { pending.push(entry); if (pending.length > 100) pending.shift(); }
    } catch (_) {}
  }
  flushDiagnostics = () => { ready = true; for (const entry of pending.splice(0)) publish(entry); };
  lifecycle.listen(window, 'message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'yt-gamepad-settings' || ready) return;
    ready = true;
    for (const entry of pending.splice(0)) publish(entry);
  });
  YTGamepadDiagnostics = { record };
  const published = YTGamepadDiagnostics;
  lifecycle.cleanup(() => { pending.length = 0; if (YTGamepadDiagnostics === published) YTGamepadDiagnostics = undefined; });
})();
