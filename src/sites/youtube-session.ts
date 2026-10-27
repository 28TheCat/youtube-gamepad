import { Session } from 'youtubei.js/web';
import type { Context } from 'youtubei.js/web';

/** Each service supplies its own transport and keeps its endpoint/identity checks. */
export function createYouTubeSession(context: Context, transport: NonNullable<ConstructorParameters<typeof Session>[7]>) {
  return new Session(structuredClone({ ...context, user: context.user || {} }),
    '', 'v1', 0, undefined, undefined, undefined, transport);
}
