import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { modernVideo } from './helpers/modern-video.mjs';

const compiled = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  target: 'es2022', lib: { entry: fileURLToPath(new URL('../src/sites/youtube-search.ts', import.meta.url)),
    formats: ['iife'], name: 'ParserFixture' } } });
const sandbox = { URL, console };
vm.runInNewContext((Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code, sandbox);
const { parseYouTubeJsBrowse } = sandbox.ParserFixture;
const video = id => ({ videoRenderer: { videoId: id, title: { simpleText: id },
  thumbnail: { thumbnails: [] }, navigationEndpoint: { watchEndpoint: { videoId: id } } } });

test('legacy and modern cards retain bounded watch progress and omit absent or invalid values', () => {
  for (const [input, expected] of [[37, 37], [100, 100], [140, 100], [0, undefined], [-5, undefined], [NaN, undefined], ['50', undefined]]) {
    const legacy = video('legacy');
    legacy.videoRenderer.thumbnailOverlays = [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: input } }];
    assert.equal(parseYouTubeJsBrowse({ contents: [legacy] }).items[0].watchedPercent, expected);
    assert.equal(parseYouTubeJsBrowse({ contents: [modernVideo('modern', input)] }).items[0].watchedPercent, expected);
  }
  assert.equal(parseYouTubeJsBrowse({ contents: [video('new')] }).items[0].watchedPercent, undefined);
});

test('channel badges retain YouTube verification and artist identity without guessing from text', () => {
  for (const [style, expected] of [['BADGE_STYLE_TYPE_VERIFIED', 'verified'], ['BADGE_STYLE_TYPE_VERIFIED_ARTIST', 'artist'], ['BADGE_STYLE_TYPE_PREMIUM', undefined]]) {
    const raw = video('badged');
    raw.videoRenderer.ownerBadges = [{ metadataBadgeRenderer: { style, label: 'Verified' } }];
    assert.equal(parseYouTubeJsBrowse({ contents: [raw] }).items[0].channelBadge, expected);
  }
  for (const [icon, expected] of [['CHECK_CIRCLE_FILLED', 'verified'], ['OFFICIAL_ARTIST_BADGE', 'artist'], ['SUBSCRIPTIONS', undefined]]) {
    const raw = modernVideo();
    const text = raw.lockupViewModel.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text;
    text.attachmentRuns = [{ startIndex: text.content.length, length: 0, element: { type: { imageType: {
      image: { sources: [{ clientResource: { imageName: icon } }] }
    } } } }];
    assert.equal(parseYouTubeJsBrowse({ contents: [raw] }).items[0].channelBadge, expected);
  }
  assert.equal(parseYouTubeJsBrowse({ contents: [modernVideo()] }).items[0].channelBadge, undefined);
});

test('modern video cards retain creator avatars, views, publication time and duration', () => {
  const card = parseYouTubeJsBrowse({ contents: [modernVideo()] }).items[0];
  assert.equal(card.channel, 'JaidenAnimations');
  assert.equal(card.channelAvatar, 'https://yt3.ggpht.com/creator=s88');
  assert.equal(card.viewCount, '1694万次观看');
  assert.equal(card.publishedTime, '9年前');
  assert.equal(card.duration, '8:47');
  const raw = modernVideo();
  raw.lockupViewModel.metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel.avatar.avatarViewModel.image.sources[0].url = 'javascript:alert(1)';
  assert.equal(parseYouTubeJsBrowse({ contents: [raw] }).items[0].channelAvatar, undefined);
});

test('modern home cards separate inline creator, views and publication time', () => {
  const raw = modernVideo();
  const metadata = raw.lockupViewModel.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel;
  metadata.metadataRows = [{ metadataParts: metadata.metadataRows.flatMap(row => row.metadataParts) }];
  const card = parseYouTubeJsBrowse({ contents: [raw] }).items[0];
  assert.equal(card.channel, 'JaidenAnimations');
  assert.equal(card.viewCount, '1694万次观看');
  assert.equal(card.publishedTime, '9年前');
});

test('modern channel cards retain publication time when the byline row is omitted', () => {
  const raw = modernVideo();
  raw.lockupViewModel.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows.shift();
  const card = parseYouTubeJsBrowse({ contents: [raw] }).items[0];
  assert.equal(card.viewCount, '1694万次观看');
  assert.equal(card.publishedTime, '9年前');
  assert.equal(card.channel, '', 'view counts must not become a channel name');
});

test('API cards preserve order and exclude unavailable entries through library parsing', () => {
  const unavailable = { playlistVideoRenderer: { ...video('unavailable').videoRenderer, isPlayable: false } };
  const result = parseYouTubeJsBrowse({ contents: [video('one'), unavailable, video('two')] });
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:one', 'video:two']);
});

test('movie cards missing optional overlays use the library parser without modifying API data', () => {
  const movie = { movieRenderer: { videoId: 'legacy', title: { simpleText: 'Legacy' } } };
  Object.freeze(movie.movieRenderer);
  const result = parseYouTubeJsBrowse({ contents: [video('one'), movie, video('two')] });
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:one', 'video:legacy', 'video:two']);
  assert.equal(result.items[1].title, 'Legacy');
  assert.equal(movie.movieRenderer.thumbnailOverlays, undefined);
});

test('malformed cards cannot remove adjacent valid results', () => {
  const result = parseYouTubeJsBrowse({ contents: [video('one'), { movieRenderer: null }, video('two')] });
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:one', 'video:two']);
});

test('bundled search parser preserves lockup metadata with omitted command offsets', t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const result = parseYouTubeJsBrowse({ contents: [video('one'), {
    lockupViewModel: { contentId: 'modern', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      metadata: { lockupMetadataViewModel: { title: { content: 'Modern video' },
        metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: {
          content: 'Creator', commandRuns: [{ onTap: { browseEndpoint: { browseId: 'UCcreator' } } }]
        } }] }] } } } }
    }
  }, video('two')] });
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:one', 'video:modern', 'video:two']);
  assert.equal(result.items[1].title, 'Modern video');
  assert.equal(result.items[1].channel, 'Creator');
  assert.equal(warnings.mock.callCount(), 0);
});
