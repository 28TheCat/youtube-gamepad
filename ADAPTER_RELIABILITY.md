# YouTube adapter reliability

`createYouTubeHeaders` in `sites/youtube-request.ts` is the shared MAIN-world
header builder for browse, recommendations, comments, watch actions, accounts
and sidebar requests. Account and sidebar services pass their captured SID so
identity checks retain the same scope. The helper never forwards a Cookie header.

Playback readiness uses a separate bounded `readPlayerVideoId` bridge operation.
MAIN reads only the native player's current video ID; metadata, account state
and actions continue using their existing API services. Before a destination
has decoded frames, stale or missing identity still prevents takeover. Once
identity and frames match, controls need not wait for player/next API metadata.
Direct watch and Shorts startup leaves native playback visible and interactive
while extension initialization is pending; browse startup retains its flash guard.
Regression coverage deliberately holds destination metadata requests open and
verifies that decoded destination frames release the loading indicator.

Read-only adapter requests use `src/sites/youtube-request.ts`: one 20-second
deadline includes response-body reading and retry backoff. Cancellation races
the transport, so even a transport that ignores AbortSignal cannot keep the
caller waiting. Network failures and HTTP 502/503/504 retry at most once, after
250 ms. Authentication errors, rate limits, malformed JSON and invalid envelopes
do not retry automatically. Credentials and request bodies stay in MAIN.

Services must still reject late results against their captured route and state.
Cancelling a previous route must never display an error on the current route.
Service-level deadlines also cover authentication and parser work; transport
deadlines alone do not bound the whole operation.

The browse controller invokes native fallback if the current first-page request
fails without usable cards. Pagination failure retains loaded cards and the
continuation for manual retry. The surface also falls back if category discovery
cannot initialize within eight seconds. Fallback changes only the current tab's
mode, preserves the stored preference, explains the failure beside the mode
switch, and allows an explicit retry. It does not globally disable the extension.

Normalized feed responses that contain cards but lose every card to bridge
validation are errors rather than legitimate empty feeds. Actual empty arrays
remain valid. Unknown renderer layouts still require ongoing parser coverage;
envelope validation is not proof that every YouTube layout is supported.

Regression tests cover deadline expiry during fetch and JSON reading,
cancellation before fetch and during backoff, bounded retries, invalid responses,
stale routes, first-page recovery, retained pagination and actual Chromium
extension recovery with clickable native content.

See `tests/fixtures/youtube/README.md` for real-response capture and redaction.
Synthetic fixtures and intercepted browser responses are not live YouTube
acceptance evidence. Real-site and physical-controller acceptance remain
separate release requirements.
