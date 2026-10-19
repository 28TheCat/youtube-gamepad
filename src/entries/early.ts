import { startEarly } from '../app/early-start';
import { isShortsPlaybackRoute } from '../shared/shorts-route';
// Capture intent before YouTube's startup scripts normalize the watch URL.
isShortsPlaybackRoute();
startEarly();
