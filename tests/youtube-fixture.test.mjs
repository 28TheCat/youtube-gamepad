import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeYouTubeFixture } from '../scripts/sanitize-youtube-fixture.mjs';

test('fixture redaction removes credentials, content, URLs and identifiers throughout nested responses', () => {
  const raw = { responseContext: { visitorData: 'secret-visitor' }, contents: [{ videoRenderer: {
    videoId: 'private-video', title: { simpleText: 'private-title' },
    thumbnail: { thumbnails: [{ url: 'https://private.test/personal', width: 640 }] },
    navigationEndpoint: { watchEndpoint: { videoId: 'private-video' }, clickTrackingParams: 'secret-tracking' },
    authorization: 'secret-header', unknownField: 'secret-new-field'
  } }] };
  const result = sanitizeYouTubeFixture(raw);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /private|secret/);
  const card = result.contents[0].videoRenderer;
  assert.equal(card.videoId, card.navigationEndpoint.watchEndpoint.videoId);
  assert.equal(card.thumbnail.thumbnails[0].width, 640);
  assert.equal(raw.contents[0].videoRenderer.videoId, 'private-video');
});

test('oversized fixture structures are rejected', () => {
  assert.throws(() => sanitizeYouTubeFixture(Array(50001).fill('text')), /limit/);
});
