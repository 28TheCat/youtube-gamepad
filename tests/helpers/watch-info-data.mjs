const toggle = isToggled => ({ toggleButtonRenderer: { isToggled, defaultText: { simpleText: 'Like' } } });
export function next() {
  return { contents: { twoColumnWatchNextResults: {
    results: { results: { contents: [
      { videoPrimaryInfoRenderer: { title: { simpleText: 'Title' }, videoActions: { menuRenderer: { topLevelButtons: [
        { segmentedLikeDislikeButtonRenderer: { likeButton: toggle(false), dislikeButton: toggle(false) } }
      ] } } } },
      { videoSecondaryInfoRenderer: { owner: { videoOwnerRenderer: { title: { runs: [{ text: 'Creator' }] },
        thumbnail: { thumbnails: [{ url: 'https://example.com/avatar.jpg', width: 80 }] } } },
        subscribeButton: { subscribeButtonRenderer: { channelId: 'UCcreator', subscribed: false, enabled: true } } } }
    ] } }, secondaryResults: { secondaryResults: { results: [] } }
  } } };
}
export const player = id => ({ videoDetails: { videoId: id, channelId: 'UCcreator', title: `Title ${id}`,
  author: 'Creator', shortDescription: 'Description', viewCount: '42', allowRatings: true, lengthSeconds: '60' } });
export function option(id, selected = false) {
  const command = action => ({ playlistEditEndpoint: { playlistId: id,
    actions: [{ action, ...(action === 'ACTION_ADD_VIDEO' ? { addedVideoId: 'first' } : { setVideoId: 'private-set-id' }) }] } });
  return { playlistAddToOptionRenderer: { playlistId: id, title: { simpleText: `List ${id}` },
    containsSelectedVideos: selected ? 'ALL' : 'NONE',
    addToPlaylistServiceEndpoint: command('ACTION_ADD_VIDEO'), removeFromPlaylistServiceEndpoint: command('ACTION_REMOVE_VIDEO') } };
}
