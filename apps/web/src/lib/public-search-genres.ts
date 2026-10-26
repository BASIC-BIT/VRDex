import type { PublicSearchGenre } from "./public-search";

export function publicSearchGenreLabel(genre: PublicSearchGenre): string {
  return genre.displayLabel?.trim() || genre.displayName.trim();
}

export function orderedPublicSearchGenres(genres: readonly PublicSearchGenre[]): PublicSearchGenre[] {
  return genres.filter((genre) => publicSearchGenreLabel(genre))
    .sort((first, second) => Number(second.featured === true) - Number(first.featured === true));
}
