# YouTube response regression captures

No real network captures have been checked in yet. Existing renderer fixtures in
the tests are synthetic and must not be described as real YouTube responses.

To add a real capture, copy only an API response JSON from browser developer
tools. Do not export a HAR, cookies, request headers or authenticated context.
Pipe the response through `node scripts/sanitize-youtube-fixture.mjs` using stdin
and write its stdout to a JSON file here. Never commit the raw response.

The sanitizer removes tracking/context fields and replaces all other strings
except a small set of renderer enums. Review object keys and numeric values too;
redaction is conservative and does not establish anonymity by itself.

For each capture, record date, route kind (home/search/channel/comments/next),
anonymous or signed-in, source as a real browser response, and the renderer
variant in a companion Markdown file. Do not include account names or page URLs.
Add a parser regression asserting item identity consistency, pagination, empty
results and malformed adjacent cards. Check that replacement text has not made
the fixture structurally invalid for YouTube.js before accepting it.
