"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState, useTransition, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";

import { buttonVariants, Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";
import { protectedRouteSignInPath } from "@/lib/protected-route-redirect";
import { ProfileFields } from "./profile-fields";
import { profileFieldsPayload } from "./profile-fields-model";

/**
 * One editor for a profile's owner and for a community contributor.
 *
 * Which fields each may write is decided in the backend by
 * `canEditProfileField`, and the form asks `profiles:editableProfile` what it
 * got rather than deciding locally. That keeps this from becoming a second
 * field policy that drifts from the one the mutation enforces.
 *
 * It loads the record as stored, not as published: the public projection omits
 * private fields, so an editor filling in a form built from it would save an
 * array that silently dropped everything already there.
 */

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type EditStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const userSafeErrorPatterns = [
  /A signed-in user is required\./,
  /Display name must be at least \d+ characters\./,
  /Display name must be \d+ characters or fewer\./,
  /(?:Aliases|Tags|Role tags|Category tags) items must be \d+ characters or fewer\./,
  /(?:Aliases|Tags|Role tags|Category tags) can include at most \d+ entries\./,
  /Community subtype must be \d+ characters or fewer\./,
  /The \w+ field cannot be edited on a profile you do not own\./,
  /This profile cannot be submitted\./,
];

function editErrorMessage(error: unknown): string {
  // Structured data first: Convex redacts plain error messages on production
  // deployments, so pattern-matching the message alone never sees this there.
  const data = (error as { data?: { code?: string; message?: string } } | null)?.data;

  if (data?.code && data.message) {
    return data.message;
  }

  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of userSafeErrorPatterns) {
    const match = message.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return BACKEND_ERROR_COPY;
}

type ProfileEditFormProps = {
  profilePath: string;
  /** The type the route claims, checked against the record before editing. */
  profileType: "person" | "community";
  slug: string;
};

function EditPanel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="border-t border-border py-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ConnectedProfileEditForm({
  profilePath,
  profileType,
  slug,
}: ProfileEditFormProps) {
  const router = useRouter();
  // With the route type, so `/p/<community-slug>/edit` is refused rather than
  // editing the community profile and returning to a `/p/` path that 404s.
  const profile = useQuery(api.profiles.editableProfile, { profileType, slug });
  const updateProfile = useMutation(api.profiles.updateProfileFromBrowser);
  const [status, setStatus] = useState<EditStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();
  // The version the inputs on screen were filled from, pinned for the life of
  // this form. `profile` is live, and the fields are uncontrolled: when somebody
  // else saves while this page is open, Convex pushes a newer `updatedAt` while
  // every `defaultValue` keeps the values it mounted with. Sending the live
  // number would pass the backend's check with a payload built from what the
  // other editor just replaced -- the form posts every group it rendered, so a
  // display-name fix would carry stale tags and links over their edit. That is
  // the exact overwrite the check exists to refuse, arriving through the check.
  const loadedUpdatedAt = useRef<number | null>(null);

  if (profile !== undefined && profile !== null && loadedUpdatedAt.current === null) {
    loadedUpdatedAt.current = profile.updatedAt;
  }

  if (profile === undefined) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  if (profile === null) {
    return (
      <EditPanel title="This profile cannot be edited">
        <Link className={buttonVariants({ size: "lg", variant: "secondary" })} href={profilePath}>
          Back to profile
        </Link>
      </EditPanel>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (profile === undefined || profile === null) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const payload = profileFieldsPayload(formData, profile.profileType);

    setStatus({ kind: "saving" });

    try {
      // `profileType` is the form's own discriminator, not an updatable field.
      const fields = Object.fromEntries(
        Object.entries(payload).filter(([key]) => key !== "profileType"),
      ) as Omit<typeof payload, "profileType">;

      // Spread as-is. The payload already carries only the fields the form
      // rendered, and the update path reads every key it receives as an
      // instruction -- so naming the rest here would clear fields this writer
      // was never shown. An emptied narrative field becomes `null`, which is how
      // that path spells "clear this" rather than "leave it alone".
      const saved = await updateProfile({
        slug,
        expectedUpdatedAt: loadedUpdatedAt.current ?? profile.updatedAt,
        ...fields,
        // Emptied means cleared, same as the narrative fields, and `person` is
        // only present when the form rendered that group at all.
        ...(payload.profileType !== "person" || payload.person === undefined
          ? {}
          : { person: { ...payload.person, pronouns: payload.person.pronouns || null } }),
        ...(fields.headline === undefined ? {} : { headline: fields.headline || null }),
        ...(fields.bio === undefined ? {} : { bio: fields.bio || null }),
        ...(fields.region === undefined ? {} : { region: fields.region || null }),
        ...(fields.timezone === undefined ? {} : { timezone: fields.timezone || null }),
      });

      // Moved to the version this save produced. The pin exists so a form cannot
      // carry the values it mounted with over somebody else's edit; leaving it on
      // the loaded version would make an owner's own second save look like that
      // conflict, which only became reachable once a save could keep them here.
      loadedUpdatedAt.current = saved.updatedAt;

      startTransition(() => {
        // Only where there is a public page to land on. `draft_private`, opted
        // out and suppressed profiles are editable by their owner and 404 for
        // everybody including them, so pushing there turned a successful save
        // into a not-found -- and this route is the one surface those owners
        // have, now that the record panel hangs off it too. They stay here with
        // refreshed values instead.
        if (profile.publiclyViewable) {
          setStatus({ kind: "idle" });
          router.push(profilePath);
        } else {
          setStatus({ kind: "saved" });
        }

        router.refresh();
      });
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: editErrorMessage(error) }));
    }
  }

  const isSaving = status.kind === "saving";

  return (
    // Masked for the same reason the record panel is, and the finding that named
    // that one applies here too: the editor hydrates stored values, so an owner
    // correcting a bio the public cannot see would put it in a replay. Nobody
    // reviewing a session recording needs the field contents to see that
    // somebody used the form.
    <form className="grid gap-5 ph-no-capture" data-ph-no-capture onSubmit={onSubmit}>
      {profile.subject === "community_submitter" ? (
        <Notice variant="info">
          Nobody has claimed this profile. Your edits go live right away, and may be reviewed
          later by platform staff.
        </Notice>
      ) : null}

      <ProfileFields
        defaults={{
          displayName: profile.displayName,
          aliases: profile.aliases,
          tags: profile.tags,
          headline: profile.headline ?? "",
          bio: profile.bio ?? "",
          region: profile.region ?? "",
          timezone: profile.timezone ?? "",
          roleTags: profile.person?.roleTags ?? [],
          pronouns: profile.person?.pronouns ?? "",
          subtype: profile.community?.subtype ?? "",
          categoryTags: profile.community?.categoryTags ?? [],
          links: profile.outboundLinks,
        }}
        editableFields={profile.editableFields}
        profileType={profile.profileType}
        showNarrativeFields
      />

      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
        <Button className="sm:min-w-40" disabled={isSaving} size="lg" type="submit" variant="primary">
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
        <Link
          className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "sm:min-w-32")}
          href={profilePath}
        >
          Cancel
        </Link>
      </div>

      {/*
        Only reached when the save did not navigate away, which is the profiles
        with no public page to navigate to. `Saved.` is the wording the media kit
        panel already uses for the same event rather than a new sentence.
      */}
      {status.kind === "saved" ? <Notice variant="info">Saved.</Notice> : null}

      {status.kind === "error" ? <Notice variant="error">{status.message}</Notice> : null}
    </form>
  );
}

function AuthenticatedProfileEditForm({ profilePath, profileType, slug }: ProfileEditFormProps) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <p className="text-sm text-muted">Loading sign-in state...</p>;
  }

  if (!isAuthenticated) {
    return (
      <EditPanel title="Sign-in required">
        {/* With the return path, or signing in lands them somewhere else and the
            edit they came to make is gone. These routes are not in
            `isProtectedRoute`, so no server redirect builds this for them --
            this branch is the whole of the signed-out handling, and the sign-in
            page only comes back when `returnTo` is present. Built with the same
            helper the protected routes use, so it stays one format. */}
        <Link
          className={buttonVariants({ size: "lg", variant: "primary" })}
          href={protectedRouteSignInPath(`${profilePath}/edit`)}
        >
          Sign in
        </Link>
      </EditPanel>
    );
  }

  return <ConnectedProfileEditForm profilePath={profilePath} profileType={profileType} slug={slug} />;
}

export function ProfileEditForm({ profilePath, profileType, slug }: ProfileEditFormProps) {
  // Ahead of every Convex hook, not beside them. `ConvexClientProvider` renders
  // no provider when the URL is unset, so `useConvexAuth` throws on mount there
  // and the fallback below is never reached -- the same shape as the fixture
  // crash on the public profile page, and the reason the submit form splits its
  // connected half into its own component.
  if (!convexUrl) {
    return (
      <EditPanel title="Profile editing is unavailable">
        <p className="text-sm text-muted">Try again later.</p>
      </EditPanel>
    );
  }

  return (
    <AuthenticatedProfileEditForm profilePath={profilePath} profileType={profileType} slug={slug} />
  );
}
