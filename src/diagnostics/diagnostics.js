// MAIN-world errors are untrusted telemetry, never extension commands.
(() => {
  const lifecycle = window.YTGamepadRuntime.scope('diagnostics');
  let ready = false;
  const pending = [];
  const text = (value, limit) => String(value ?? '').replace(/https?:\/\/[^\s)]+/g, '[URL]').slice(0, limit);
  function publish(entry) {
    try { window.postMessage({ source: 'yt-gamepad-diagnostic', entry }, location.origin); } catch (_) {}
  }
  function record(module, operation, error, state = {}) {
    // Diagnostics must never interfere with recovery, including exotic thrown values.
    try {
      const entry = { module: text(module, 40), operation: text(operation, 80),
        name: text(error?.name || 'Error', 80), reason: text(error?.message ?? error, 512),
        stack: text(error?.stack, 1024), state };
      if (ready) publish(entry);
      else { pending.push(entry); if (pending.length > 100) pending.shift(); }
    } catch (_) {}
  }
  lifecycle.listen(window, 'message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'yt-gamepad-settings' || ready) return;
    ready = true;
    for (const entry of pending.splice(0)) publish(entry);
  });
  window.YTGamepadDiagnostics = { record };
  const published = window.YTGamepadDiagnostics;
  lifecycle.cleanup(() => { pending.length = 0; if (window.YTGamepadDiagnostics === published) delete window.YTGamepadDiagnostics; });
})();
