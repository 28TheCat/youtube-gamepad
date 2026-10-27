import type { WatchAction } from '../../types/ports';
import { createPanelOperation, type PanelOperationPort } from './panel-operation';

/** Shared write state; each surface keeps its own layout and success behavior. */
export function createWatchActionOperations<T extends WatchAction = WatchAction>(port: PanelOperationPort & {
  request(action: T): Promise<boolean>;
}) {
  const state = { loading: false, failed: false };
  const operation = createPanelOperation(port, state);
  return {
    state,
    reset: operation.reset,
    run(action: T) { return operation.run(() => port.request(action), ok => ok); }
  };
}
