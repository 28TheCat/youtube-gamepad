/** Only YouTube's explicit channel identity badges count as verification. */
export function channelBadge(author: any, byline?: any): 'verified' | 'artist' | undefined {
  if (author?.is_verified_artist === true) return 'artist';
  if (author?.is_verified === true) return 'verified';
  const icons: string[] = (byline?.runs || []).flatMap((run: any) => {
    const image = run.attachment?.element?.type?.imageType?.image;
    return (image?.sources || []).map((source: any) => source.clientResource?.imageName);
  });
  if (icons.includes('OFFICIAL_ARTIST_BADGE')) return 'artist';
  if (icons.some(icon => ['CHECK_CIRCLE_FILLED', 'CHECK_CIRCLE_THICK', 'CHECK_CIRCLE', 'VERIFIED'].includes(icon))) return 'verified';
}
