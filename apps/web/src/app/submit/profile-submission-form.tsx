"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type ProfileType = "person" | "community";

type SubmissionStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      result: ProfileSubmissionResult;
    }
  | { kind: "error"; message: string };

type ProfileSubmissionResult = {
  profilePath: string;
  slug: string;
};

type ProfileSubmissionPayload =
  | {
      profileType: "person";
      displayName: string;
      aliases: string[];
      tags: string[];
      person: { roleTags: string[] };
    }
  | {
      profileType: "community";
      displayName: string;
      aliases: string[];
      tags: string[];
      community: { subtype: string; categoryTags: string[] };
    };

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

function payloadFromFormData(formData: FormData): ProfileSubmissionPayload {
  const selectedType = stringField(formData.get("profileType")) as ProfileType;
  const sharedPayload = {
    displayName: stringField(formData.get("displayName")),
    aliases: splitList(formData.get("aliases")),
    tags: splitList(formData.get("tags")),
  };

  if (selectedType === "community") {
    return {
      ...sharedPayload,
      profileType: "community",
      community: {
        subtype: stringField(formData.get("subtype")),
        categoryTags: splitList(formData.get("categoryTags")),
      },
    };
  }

  return {
    ...sharedPayload,
    profileType: "person",
    person: {
      roleTags: splitList(formData.get("roleTags")),
    },
  };
}

function DisabledSubmissionPanel() {
  return (
    <div className="border-t border-border py-6">
      <h2 className="text-lg font-semibold">Profile submission is unavailable</h2>
      <p className="mt-2 text-sm text-muted">Try again later.</p>
    </div>
  );
}

function SignInRequiredSubmissionPanel() {
  return (
    <div className="border-t border-border py-6">
      <h2 className="text-lg font-semibold">Sign-in required</h2>
      <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
        Sign in
      </Link>
    </div>
  );
}

function SubmissionFormFields({ submitProfile }: {
  submitProfile: (payload: ProfileSubmissionPayload) => Promise<ProfileSubmissionResult>;
}) {
  const [profileType, setProfileType] = useState<ProfileType>("person");
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    setStatus({ kind: "submitting" });

    try {
      const result = await submitProfile(payloadFromFormData(formData));

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
        <Field>
          Profile type
          <Select
            name="profileType"
            value={profileType}
            onChange={(event) => setProfileType(event.target.value as ProfileType)}
          >
            <option value="person">Person</option>
            <option value="community">Community</option>
          </Select>
        </Field>

        <Field>
          Display name
          <Input name="displayName" placeholder="DJ Celine" required />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          Aliases
          <Input name="aliases" placeholder="Comma-separated names" />
        </Field>

        <Field>
          Tags
          <Input name="tags" placeholder="house, trance, vrchat" />
        </Field>
      </div>

      {profileType === "person" ? (
        <Field>
          Person roles
          <Input name="roleTags" placeholder="DJ, VJ, photographer" />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            Community subtype
            <Input name="subtype" placeholder="Club, collective, venue" />
          </Field>

          <Field>
            Community categories
            <Input name="categoryTags" placeholder="events, music, hangout" />
          </Field>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
        <Button className="sm:min-w-40" disabled={isSubmitting} size="lg" type="submit" variant="primary">
          {isSubmitting ? "Submitting..." : "Submit profile"}
        </Button>

        {status.kind === "success" ? (
          <Link
            className={buttonVariants({ size: "lg", variant: "secondary" })}
            href={status.result.profilePath}
          >
            View {status.result.profilePath}
          </Link>
        ) : null}
      </div>

      {status.kind === "error" ? (
        <Notice variant="error">
          {status.message}
        </Notice>
      ) : null}
    </form>
  );
}

function ConnectedSubmissionForm() {
  const submitProfile = useMutation(api.profiles.submitCommunityProfile);

  return <SubmissionFormFields submitProfile={submitProfile} />;
}

function E2eSubmissionForm() {
  const [runId] = useState(() => {
    if (typeof document === "undefined") {
      return `playwright-${crypto.randomUUID()}`;
    }

    const cookieName = "vrdex_e2e_run_id=";
    const cookieRunId = document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(cookieName))
      ?.slice(cookieName.length);

    return cookieRunId ? decodeURIComponent(cookieRunId) : `playwright-${crypto.randomUUID()}`;
  });

  return (
    <SubmissionFormFields
      submitProfile={async (payload) => {
        const response = await fetch("/api/e2e/profile-submissions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId,
            profileType: payload.profileType,
            displayName: payload.displayName,
            aliases: payload.aliases,
            tags: payload.tags,
            ...(payload.profileType === "person"
              ? { roleTags: payload.person.roleTags }
              : {
                  subtype: payload.community.subtype,
                  categoryTags: payload.community.categoryTags,
                }),
          }),
        });

        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errorBody?.error ?? "E2E profile submission failed.");
        }

        return (await response.json()) as ProfileSubmissionResult;
      }}
    />
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

export function ProfileSubmissionForm({ e2eMode = false }: { e2eMode?: boolean }) {
  if (e2eMode) {
    return <E2eSubmissionForm />;
  }

  if (!convexUrl) {
    return <DisabledSubmissionPanel />;
  }

  return <AuthenticatedProfileSubmissionForm />;
}
