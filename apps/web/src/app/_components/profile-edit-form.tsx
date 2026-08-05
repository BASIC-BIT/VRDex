"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";

import { buttonVariants, Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
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

  return "Saving failed. Please try again once the backend is reachable.";
}

function EditPanel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="border-t border-border py-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ConnectedProfileEditForm({ slug, profilePath }: { slug: string; profilePath: string }) {
  const router = useRouter();
  const profile = useQuery(api.profiles.editableProfile, { slug });
  const updateProfile = useMutation(api.profiles.updateProfileFromBrowser);
  const [status, setStatus] = useState<EditStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  if (profile === undefined) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  if (profile === null) {
    return (
      <EditPanel title="This profile cannot be edited here">
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
      await updateProfile({
        slug,
        displayName: payload.displayName,
        aliases: payload.aliases,
        tags: payload.tags,
        outboundLinks: payload.outboundLinks,
        ...(payload.profileType === "person"
          ? { person: { roleTags: payload.person.roleTags } }
          : {
              community: {
                subtype: payload.community.subtype,
                categoryTags: payload.community.categoryTags,
              },
            }),
      });

      startTransition(() => {
        setStatus({ kind: "idle" });
        router.push(profilePath);
        router.refresh();
      });
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: editErrorMessage(error) }));
    }
  }

  const isSaving = status.kind === "saving";

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      {profile.subject === "community_submitter" ? (
        <Notice variant="info">
          Nobody has claimed this profile. Your edit is recorded against your account.
        </Notice>
      ) : null}

      <ProfileFields
        defaults={{
          displayName: profile.displayName,
          aliases: profile.aliases,
          tags: profile.tags,
          roleTags: profile.person?.roleTags ?? [],
          subtype: profile.community?.subtype ?? "",
          categoryTags: profile.community?.categoryTags ?? [],
          links: profile.outboundLinks,
        }}
        profileType={profile.profileType}
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

      {status.kind === "error" ? <Notice variant="error">{status.message}</Notice> : null}
    </form>
  );
}

export function ProfileEditForm({ profilePath, slug }: { profilePath: string; slug: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (!convexUrl) {
    return (
      <EditPanel title="Profile editing is unavailable">
        <p className="text-sm text-muted">Try again later.</p>
      </EditPanel>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted">Loading sign-in state...</p>;
  }

  if (!isAuthenticated) {
    return (
      <EditPanel title="Sign-in required">
        <Link className={buttonVariants({ size: "lg", variant: "primary" })} href="/sign-in">
          Sign in
        </Link>
      </EditPanel>
    );
  }

  return <ConnectedProfileEditForm profilePath={profilePath} slug={slug} />;
}
