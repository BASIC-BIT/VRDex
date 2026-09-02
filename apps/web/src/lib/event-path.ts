export function publicEventPath(event: {
  communitySlug?: string;
  slug?: string;
}): string | undefined {
  return event.communitySlug && event.slug
    ? `/${event.communitySlug}/events/${event.slug}`
    : undefined;
}

export function eventEditPath(event: {
  communitySlug?: string;
  slug?: string;
}): string | undefined {
  const publicPath = publicEventPath(event);
  return publicPath === undefined ? undefined : `${publicPath}/edit`;
}
