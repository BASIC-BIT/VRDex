"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex-generated-api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type ProfileType = "person" | "community";

type SubmissionStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      result: {
        profilePath: string;
        slug: string;
      };
    }
  | { kind: "error"; message: string };

const userSafeErrorPatterns = [
  /Profile submissions require a signed-in user\./,
  /Display name must be at least \d+ characters\./,
  /Display name must be \d+ characters or fewer\./,
  /(?:Aliases|Tags|Role tags|Category tags) items must be \d+ characters or fewer\./,
  /(?:Aliases|Tags|Role tags|Category tags) can include at most \d+ entries\./,
  /Community subtype must be \d+ characters or fewer\./,
  /Community fields cannot be submitted for a person profile\./,
  /Person fields cannot be submitted for a community profile\./,
];

function submissionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of userSafeErrorPatterns) {
    const match = message.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return "Profile submission failed. Please try again once the backend is reachable.";
}

function splitList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function DisabledSubmissionPanel() {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-border bg-surface px-5 py-6">
      <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
        Submission flow
      </p>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
        Convex URL not configured
      </h2>
      <p className="mt-3 text-sm leading-7 text-muted">
        Run <code className="font-mono text-[0.95em]">pnpm bootstrap:backend:local</code> before testing profile submission locally. The mutation also requires a signed-in Convex identity, so anonymous writes stay blocked.
      </p>
    </div>
  );
}

function SignInRequiredSubmissionPanel() {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-border bg-surface px-5 py-6">
      <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">
        Submission flow
      </p>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
        Sign-in required
      </h2>
      <p className="mt-3 text-sm leading-7 text-muted">
        Sign in before submitting profile records. Community submissions create unclaimed profiles with narrow source attribution and safe public fields.
      </p>
      <Link className="mt-5 inline-flex rounded-full bg-accent px-5 py-3 text-sm font-medium text-white" href="/sign-in">
        Sign in
      </Link>
    </div>
  );
}

function ConnectedSubmissionForm() {
  const submitProfile = useMutation(api.profiles.submitCommunityProfile);
  const [profileType, setProfileType] = useState<ProfileType>("person");
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const selectedType = stringField(formData.get("profileType")) as ProfileType;

    setStatus({ kind: "submitting" });

    try {
      const sharedPayload = {
        profileType: selectedType,
        displayName: stringField(formData.get("displayName")),
        aliases: splitList(formData.get("aliases")),
        tags: splitList(formData.get("tags")),
      };
      const result = await submitProfile(
        selectedType === "person"
          ? {
              ...sharedPayload,
              profileType: "person",
              person: {
                roleTags: splitList(formData.get("roleTags")),
              },
            }
          : {
              ...sharedPayload,
              profileType: "community",
              community: {
                subtype: stringField(formData.get("subtype")),
                categoryTags: splitList(formData.get("categoryTags")),
              },
            },
      );

      form.reset();
      setProfileType("person");
      startTransition(() => setStatus({ kind: "success", result }));
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: submissionErrorMessage(error) }));
    }
  }

  const isSubmitting = status.kind === "submitting";

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          Profile type
          <select
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent"
            name="profileType"
            value={profileType}
            onChange={(event) => setProfileType(event.target.value as ProfileType)}
          >
            <option value="person">Person</option>
            <option value="community">Community</option>
          </select>
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Display name
          <input
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
            name="displayName"
            placeholder="DJ Celine"
            required
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          Aliases
          <input
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
            name="aliases"
            placeholder="Comma-separated names"
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Shared tags
          <input
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
            name="tags"
            placeholder="house, trance, vrchat"
          />
        </label>
      </div>

      {profileType === "person" ? (
        <label className="grid gap-2 text-sm font-medium">
          Person roles
          <input
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
            name="roleTags"
            placeholder="DJ, VJ, photographer"
          />
        </label>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            Community subtype
            <input
              className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
              name="subtype"
              placeholder="Club, collective, venue"
            />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Community categories
            <input
              className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
              name="categoryTags"
              placeholder="events, music, hangout"
            />
          </label>
        </div>
      )}

      <div className="rounded-[1.25rem] border border-border bg-surface-strong px-4 py-4 text-sm leading-6 text-muted">
        Community submissions intentionally skip custom slugs, freeform bios, about text, image URLs, private contact details, and claim signals. VRDex generates the slug and marks the profile as unclaimed until an owner claim flow exists.
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Submitting..." : "Submit profile"}
        </button>

        {status.kind === "success" ? (
          <Link
            className="inline-flex items-center justify-center rounded-full border border-border bg-surface-strong px-5 py-3 text-sm font-medium"
            href={status.result.profilePath}
          >
            View {status.result.profilePath}
          </Link>
        ) : null}
      </div>

      {status.kind === "error" ? (
        <p className="rounded-[1rem] border border-accent/35 bg-accent/10 px-4 py-3 text-sm leading-6 text-accent-strong">
          {status.message}
        </p>
      ) : null}
    </form>
  );
}

function AuthenticatedProfileSubmissionForm() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <p className="text-sm text-muted">Loading sign-in state...</p>;
  }

  if (!isAuthenticated) {
    return <SignInRequiredSubmissionPanel />;
  }

  return <ConnectedSubmissionForm />;
}

export function ProfileSubmissionForm() {
  if (!convexUrl) {
    return <DisabledSubmissionPanel />;
  }

  return <AuthenticatedProfileSubmissionForm />;
}
