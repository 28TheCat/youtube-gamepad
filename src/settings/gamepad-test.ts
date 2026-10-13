export interface GamepadReading {
  index: number;
  id: string;
  mapping: string;
  buttons: { pressed: boolean; touched: boolean; value: number }[];
  axes: number[];
}

// Copy each poll: browsers may reuse and mutate their Gamepad objects.
export function readGamepads(pads: readonly (Gamepad | null)[]): GamepadReading[] {
  return Array.from(pads).filter((pad): pad is Gamepad => !!pad?.connected).map(pad => ({
    index: pad.index, id: pad.id, mapping: pad.mapping,
    buttons: Array.from(pad.buttons, button => ({ pressed: button.pressed, touched: button.touched,
      value: Number.isFinite(button.value) ? Math.max(0, Math.min(1, button.value)) : 0 })),
    axes: Array.from(pad.axes, axis => Number.isFinite(axis) ? Math.max(-1, Math.min(1, axis)) : 0)
  }));
}

export function outsideDeadzone(x: number, y: number, deadzone: number) {
  // Match navigation's per-axis threshold, rather than a radial deadzone.
  return Math.max(Math.abs(x), Math.abs(y)) > deadzone;
}

export function createDeadzoneCalibration() {
  let device = '', started = 0, last = 0, samples = 0, peak = 0, running = false, stick = 0;
  const identity = (pad: GamepadReading) => `${pad.index}:${pad.id}:${pad.mapping}`;
  return {
    start(pad: GamepadReading, time: number, axis: 0 | 2 = 0) {
      running = false;
      if (pad.mapping !== 'standard' || pad.axes.length < axis + 2) return false;
      stick = axis;
      device = identity(pad); started = last = time; samples = peak = 0; running = true;
      return true;
    },
    cancel() { running = false; },
    sample(pad: GamepadReading | undefined, time: number):
      { state: 'idle' | 'cancelled' | 'moving' | 'sampling' | 'complete'; progress: number; peak: number; suggestion?: number } {
      if (!running) return { state: 'idle', progress: 0, peak };
      // A backgrounded or stalled page cannot provide continuous calibration.
      if (!pad || identity(pad) !== device || pad.axes.length < stick + 2 || time - last > 250 || time < last) {
        running = false; return { state: 'cancelled', progress: 0, peak };
      }
      last = time; samples++;
      peak = Math.max(peak, Math.abs(pad.axes[stick]), Math.abs(pad.axes[stick + 1]));
      if (peak > .70) { running = false; return { state: 'moving', progress: 0, peak }; }
      const progress = Math.min(1, (time - started) / 3000);
      if (progress < 1 || samples < 30) return { state: 'sampling', progress, peak };
      running = false;
      const suggestion = Math.max(.15, Math.min(.75, Math.ceil((peak + .05) * 20) / 20));
      return { state: 'complete', progress: 1, peak, suggestion };
    }
  };
}
