import { PublicProfileLinks } from "./public-profile-links";
import type { PublicSearchPerson } from "@/lib/public-search";
import { orderedPublicSearchGenres, publicSearchGenreLabel } from "@/lib/public-search-genres";

const disclosureClassName = "w-fit cursor-pointer rounded-control text-sm font-medium text-accent-strong underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

export function PublicSearchResultDetails({ person }: { person: PublicSearchPerson }) {
  const genres = orderedPublicSearchGenres(person.genres);
  const visibleGenres = genres.slice(0, 3).map(publicSearchGenreLabel);
  const remainingGenres = genres.slice(3).map(publicSearchGenreLabel);

  if (genres.length === 0 && person.outboundLinks.length === 0) return null;

  return (
    <div className="grid min-w-0 gap-3 px-4 pb-4 sm:pl-22">
      {visibleGenres.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm leading-6 text-muted">
          <span>{visibleGenres.join(" · ")}</span>
          {remainingGenres.length > 0 ? (
            <details className="min-w-0">
              <summary aria-label={`${remainingGenres.length} more genres`} className={disclosureClassName}>
                +{remainingGenres.length}
              </summary>
              <p className="mt-1 text-muted">{remainingGenres.join(" · ")}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {person.outboundLinks.length > 0 ? (
        <details className="min-w-0">
          <summary className={disclosureClassName}>Links</summary>
          <div className="min-w-0 pt-3">
            <PublicProfileLinks links={person.outboundLinks} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
