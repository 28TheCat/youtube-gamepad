export function interactiveComments() {
  const raw = { onResponseReceivedEndpoints: [
    { reloadContinuationItemsCommand: { continuationItems: [] } },
    { appendContinuationItemsAction: { continuationItems: [{ commentThreadRenderer: {
      commentViewModel: { commentViewModel: { commentId: 'parent', commentKey: 'entity:parent' } }
    } }] } }
  ], frameworkUpdates: { entityBatchUpdate: { mutations: [{ entityKey: 'entity:parent', payload: { commentEntityPayload: {
    key: 'entity:parent', properties: { content: { content: 'Original comment' } },
    author: { displayName: 'Author', channelId: 'UCtest' }, toolbar: { replyCount: '0' }
  } } }] } } };
  raw.onResponseReceivedEndpoints[0].reloadContinuationItemsCommand.continuationItems = [{ commentsHeaderRenderer: {
    createRenderer: { commentSimpleboxRenderer: { submitButton: { buttonRenderer: { serviceEndpoint: {
      createCommentEndpoint: { createCommentParams: 'create-token' }
    } } }, authorThumbnail: { thumbnails: [] } } }
  } }];
  raw.onResponseReceivedEndpoints[1].appendContinuationItemsAction.continuationItems[0].commentThreadRenderer.commentViewModel.commentViewModel.toolbarSurfaceKey = 'toolbar:parent';
  raw.frameworkUpdates.entityBatchUpdate.mutations.push({ entityKey: 'toolbar:parent', payload: { engagementToolbarSurfaceEntityPayload: {
    key: 'toolbar:parent', replyCommand: { createCommentReplyDialogEndpoint: { dialog: { commentReplyDialogRenderer: {
      replyButton: { buttonRenderer: { serviceEndpoint: { commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/comment/create_comment_reply' } }, createCommentReplyEndpoint: { createReplyParams: 'reply-token' } } } }, authorThumbnail: { thumbnails: [] }
    } } } }
  } } });
  return raw;
}
