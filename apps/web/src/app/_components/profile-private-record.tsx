"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex-generated-api";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * What this profile holds that its page does not show, for the two viewers
 * entitled to it: the profile's owner, and an operator holding the grant that
 * already governs the private seed lookup.
 *
 * Rendered as its own section rather than merged into the page, so an operator
 * can tell at a glance what the public actually sees. Read-only: editing goes
 * through the editor, which enforces the same field policy the mutation does.
 *
 * Renders nothing for everyone else. The query returns null rather than
 * throwing because this sits on a public page, and a refusal would put an error
 * in front of ordinary readers.
 */

const FIELD_LABELS: Record<string, string> = {
  aliases: "Aliases",
  tags: "Tags",
  genres: "Genres",
  headline: "Headline",
  bio: "Bio",
  about: "About",
  avatarImageUrl: "Profile image",
  bannerImageUrl: "Banner",
  outboundLinks: "Links",
  region: "Region",
  timezone: "Timezone",
  personPronouns: "Pronouns",
  personRoleTags: "Roles",
  communitySubtype: "Subtype",
  communityCategoryTags: "Categories",
};

/**
 * One heading per reason a value is missing from the page.
 *
 * `public` is in here because visibility is a permission, not a rendering:
 * `about`, `genres` and `timezone` reach the profile record and no surface shows
 * them, so they are allowed everywhere and appear nowhere.
 */
const WITHHELD_GROUP_LABELS = {
  private: "Not shown publicly",
  unlisted: "On this page, not in search",
  public: "Not shown anywhere",
} as const;

function formatDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * Audit actions are internal identifiers, so they are humanized rather than
 * mapped. A map would need an entry for every action any other surface adds,
 * and a missing one would render as a raw snake_case string to the person least
 * able to interpret it.
 */
function actionLabel(action: string) {
  return action.replace(/_/g, " ");
}

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function WithheldProfileRecord({
  profilePath,
  profileType,
  slug,
}: {
  profilePath: string;
  profileType: "person" | "community";
  slug: string;
}) {
  const record = useQuery(api.seedAccess.withheldProfileRecord, { profileType, slug });

  if (record === undefined || record === null) {
    return null;
  }

  const isOwner = record.viewerRole === "owner";

  return (
    // `data-ph-no-capture` is what `SESSION_REPLAY_MASKED_SELECTOR` blocks on.
    // This section renders withheld field values and the names of everyone who
    // edited the profile, on a route that is otherwise public and therefore
    // recorded -- so viewing your own profile, or an operator opening one, would
    // put exactly the data this surface exists to protect into a replay.
    <section
      aria-label="Profile record"
      className="border-t border-border py-8 ph-no-capture"
      data-ph-no-capture
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {isOwner ? "Your profile record" : "Operator view"}
        </h2>
        {isOwner ? (
          <Link
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "shrink-0")}
            href={`${profilePath}/edit`}
          >
            Edit profile
          </Link>
        ) : null}
      </div>

      {/* Operators only. These are the stored state values, which is what an
          operator is here to read; to an owner they are jargon about their own
          profile that names nothing they can act on. */}
      {isOwner ? null : (
        <p className="mt-2 text-sm text-muted">
          {record.claimState} / {record.publicationState} / {record.publicSurfacingState}
        </p>
      )}

      {/* Three groups, because they are three different facts. A private field is
          nowhere by instruction; an unlisted one that the page renders is here
          for anyone holding the URL and only absent from search; anything else is
          on no surface at all -- a value nothing was ever built to show, or an
          unlisted one whose row the page gave to something else. Filing them
          together would tell an owner their unlisted alias is hidden when it is
          not, and send them looking for a value that is not on the page.

          Grouped on where the value is missing from, not on its visibility. The
          two agree for most fields and part company for exactly the cases worth
          telling apart. */}
      {(["private", "unlisted", "public"] as const).map((visibility) => {
        const fields = record.withheldFields.filter((field) =>
          visibility === "private"
            ? field.visibility === "private"
            : visibility === "unlisted"
              ? field.visibility === "unlisted" && field.onProfilePage
              : field.visibility !== "private" && !field.onProfilePage,
        );

        if (fields.length === 0) {
          return null;
        }

        return (
          <div className="mt-5" key={visibility}>
            <h3 className="text-sm font-semibold">{WITHHELD_GROUP_LABELS[visibility]}</h3>
            <dl className="mt-3 grid gap-3">
              {fields.map((field) => (
                <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4" key={field.key}>
                  <dt className="text-sm text-muted">{FIELD_LABELS[field.key] ?? field.key}</dt>
                  <dd className="text-sm break-words">{field.values.join(", ")}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}

      {record.history.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">History</h3>
          <ul className="mt-3 grid gap-2">
            {record.history.map((event) => (
              <li className="text-sm" key={event.id}>
                <span>{actionLabel(event.action)}</span>
                {event.actor ? <span className="text-muted"> by {event.actor}</span> : null}
                <span className="text-muted"> on {formatDate(event.createdAt)}</span>
                {event.note ? <span className="block text-xs text-muted">{event.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function ProfilePrivateRecord(props: {
  profilePath: string;
  profileType: "person" | "community";
  slug: string;
}) {
  // `ConvexClientProvider` deliberately renders no provider when the URL is
  // unset, and the public profile page still renders there from fixtures. A
  // `useQuery` under no provider throws on mount, which would take the whole
  // profile page down rather than hiding one operator-only section.
  if (!convexUrl) {
    return null;
  }

  return <WithheldProfileRecord {...props} />;
}
