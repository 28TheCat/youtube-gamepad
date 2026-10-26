export function modernVideo(id = 'modern', watchedPercent) {
  return { lockupViewModel: {
    contentId: id, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    rendererContext: { commandContext: { onTap: { innertubeCommand: { watchEndpoint: { videoId: id } } } } },
    metadata: { lockupMetadataViewModel: {
      title: { content: 'My Opinion on Halloween' },
      image: { decoratedAvatarViewModel: { avatar: { avatarViewModel: {
        image: { sources: [{ url: 'https://yt3.ggpht.com/creator=s88', width: 88, height: 88 }] }
      } } } },
      metadata: { contentMetadataViewModel: { metadataRows: [
        { metadataParts: [{ text: { content: 'JaidenAnimations' } }] },
        { metadataParts: [{ text: { content: '1694万次观看' } }, { text: { content: '9年前' } }] }
      ] } }
    } },
    contentImage: { thumbnailViewModel: {
      image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 270 }] },
      overlays: [{ thumbnailOverlayBadgeViewModel: { position: 'THUMBNAIL_OVERLAY_BADGE_POSITION_BOTTOM_END',
        thumbnailBadges: [{ thumbnailBadgeViewModel: { text: '8:47', badgeStyle: 'THUMBNAIL_BADGE_STYLE_DEFAULT' } }]
      } }, ...(watchedPercent === undefined ? [] : [{ thumbnailBottomOverlayViewModel: {
        progressBar: { thumbnailOverlayProgressBarViewModel: { startPercent: watchedPercent } }
      } }])]
    } }
  } };
}
