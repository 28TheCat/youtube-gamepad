export interface PreviewPlayer {
  mute(): void;
  playVideo(): void;
  destroy(): void;
}
interface PreviewPlayerEvents {
  onReady: (event: { target: PreviewPlayer }) => void;
  onStateChange: (event: { data: number }) => void;
  onError: () => void;
}

// Content scripts cannot load remote JavaScript. Speak the embedded player's
// message protocol locally instead, keeping all executable code in the bundle.
export class EmbeddedPreviewPlayer implements PreviewPlayer {
  private readonly origin: string;
  private readonly timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private ready = false;
  private readonly receive: (event: MessageEvent) => void;

  constructor(private readonly frame: HTMLIFrameElement, events: PreviewPlayerEvents) {
    this.origin = new URL(frame.src).origin;
    const listen = () => this.send({ event: 'listening', id: frame.id });
    this.receive = event => {
      if (this.disposed || event.source !== frame.contentWindow || event.origin !== this.origin) return;
      let message;
      try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.event === 'onReady' && !this.ready) {
        this.ready = true;
        clearInterval(this.timer);
        for (const name of ['onStateChange', 'onError']) this.command('addEventListener', [name]);
        events.onReady({ target: this });
      } else if (message.event === 'onStateChange' && typeof message.info === 'number') {
        events.onStateChange({ data: message.info });
      } else if (message.event === 'infoDelivery' && typeof message.info?.playerState === 'number') {
        events.onStateChange({ data: message.info.playerState });
      } else if (message.event === 'onError') events.onError();
    };
    window.addEventListener('message', this.receive);
    this.timer = setInterval(listen, 250);
    listen();
  }
  private send(message: object) {
    if (!this.disposed) this.frame.contentWindow?.postMessage(JSON.stringify(message), this.origin);
  }
  private command(func: string, args: unknown[] = []) { this.send({ event: 'command', func, args }); }
  mute() { this.command('mute'); }
  playVideo() { this.command('playVideo'); }
  destroy() {
    this.command('stopVideo');
    this.disposed = true;
    clearInterval(this.timer);
    window.removeEventListener('message', this.receive);
  }
}
