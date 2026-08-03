"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { FormEvent, MouseEvent, useEffect, useRef, useState, useTransition } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Field, FieldText, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import {
  PROFILE_LINK_MAX_COUNT,
  PROFILE_LINK_TYPE_LABELS,
  PROFILE_LINK_TYPES,
  type ProfileLinkType,
} from "../../../../../convex/_profileLinks";

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

type ProfileLinkInput = {
  type: ProfileLinkType;
  url: string;
};

type ProfileSubmissionPayload =
  | {
      profileType: "person";
      displayName: string;
      aliases: string[];
      tags: string[];
      outboundLinks: ProfileLinkInput[];
      person: { roleTags: string[] };
    }
  | {
      profileType: "community";
      displayName: string;
      aliases: string[];
      tags: string[];
      outboundLinks: ProfileLinkInput[];
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
  // Retrying cannot succeed while the suppression stands, so the generic
  // "backend unreachable, try again" fallback would be actively misleading.
  /This profile cannot be submitted\./,
];

function submissionErrorMessage(error: unknown): string {
  // Structured data first: Convex redacts plain error messages on production
  // deployments, so pattern-matching the message alone never sees this case there.
  const data = (error as { data?: { code?: string; message?: string } } | null)?.data;

  if (data?.code === "IDENTITY_SUPPRESSED") {
    return data.message ?? "This profile cannot be submitted.";
  }

  // Link problems are always fixable in the form, and the structured payload is
  // what survives production redaction.
  if (data?.code === "INVALID_PROFILE_LINK" && data.message) {
    return data.message;
  }

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

/**
 * Rows are uncontrolled, so both lists come back in DOM order and pair by
 * index. Rows left blank are dropped rather than rejected.
 */
function linksFromFormData(formData: FormData): ProfileLinkInput[] {
  const types = formData.getAll("linkType");
  const urls = formData.getAll("linkUrl");

  return types.flatMap((type, index) => {
    const url = stringField(urls[index] ?? null).trim();

    return url ? [{ type: stringField(type) as ProfileLinkType, url }] : [];
  });
}

function payloadFromFormData(formData: FormData): ProfileSubmissionPayload {
  const selectedType = stringField(formData.get("profileType")) as ProfileType;
  const sharedPayload = {
    displayName: stringField(formData.get("displayName")),
    aliases: splitList(formData.get("aliases")),
    tags: splitList(formData.get("tags")),
    outboundLinks: linksFromFormData(formData),
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
  // Stable ids rather than indices: the inputs are uncontrolled, so keying by
  // index would shift the surviving rows' DOM values when one is removed.
  const [linkRows, setLinkRows] = useState<number[]>([]);
  const linkRowSeq = useRef(0);
  const successDialogRef = useRef<HTMLDialogElement>(null);
  const [, startTransition] = useTransition();
  const successResult = status.kind === "success" ? status.result : null;

  useEffect(() => {
    const dialog = successDialogRef.current;

    if (successResult && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [successResult]);

  function addLinkRow() {
    linkRowSeq.current += 1;
    setLinkRows((rows) => [...rows, linkRowSeq.current]);
  }

  function removeLinkRow(rowId: number) {
    setLinkRows((rows) => rows.filter((row) => row !== rowId));
  }

  function closeSuccessDialog() {
    successDialogRef.current?.close();
    setStatus({ kind: "idle" });
  }

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) {
      closeSuccessDialog();
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    setStatus({ kind: "submitting" });

    try {
      const result = await submitProfile(payloadFromFormData(formData));

      form.reset();
      setProfileType("person");
      setLinkRows([]);
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

      <div className="grid gap-3">
        <span className="text-sm font-medium">Links</span>

        {linkRows.map((rowId) => (
          <div className="flex items-end gap-3" key={rowId}>
            <Field className="w-44 shrink-0">
              <FieldText>Type</FieldText>
              <Select defaultValue="website" name="linkType">
                {PROFILE_LINK_TYPES.map((linkType) => (
                  <option key={linkType} value={linkType}>
                    {PROFILE_LINK_TYPE_LABELS[linkType]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field className="flex-1">
              <FieldText>URL</FieldText>
              <Input maxLength={2048} name="linkUrl" placeholder="https://soundcloud.com/name" type="url" />
            </Field>

            <Button
              aria-label="Remove link"
              className="size-11 shrink-0 p-0"
              type="button"
              variant="ghost"
              onClick={() => removeLinkRow(rowId)}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
        ))}

        {linkRows.length < PROFILE_LINK_MAX_COUNT ? (
          <div>
            <Button size="sm" type="button" variant="secondary" onClick={addLinkRow}>
              Add link
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
        <Button className="sm:min-w-40" disabled={isSubmitting} size="lg" type="submit" variant="primary">
          {isSubmitting ? "Submitting..." : "Submit profile"}
        </Button>
      </div>

      {status.kind === "error" ? (
        <Notice variant="error">
          {status.message}
        </Notice>
      ) : null}

      <dialog
        aria-labelledby="profile-submission-success-title"
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-card border border-border bg-surface p-0 text-foreground shadow-hero backdrop:bg-black/70"
        ref={successDialogRef}
        onCancel={() => setStatus({ kind: "idle" })}
        onClick={closeOnBackdrop}
      >
        <div className="relative p-6 sm:p-8">
          <Button
            aria-label="Close"
            className="absolute top-4 right-4 size-9 p-0"
            size="sm"
            type="button"
            variant="ghost"
            onClick={closeSuccessDialog}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
          <h2 className="pr-10 text-2xl font-semibold" id="profile-submission-success-title">
            Profile added
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            The profile is ready to view.
          </p>
          {successResult ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                className={buttonVariants({ size: "lg", variant: "primary" })}
                href={successResult.profilePath}
              >
                View profile
              </Link>
              <Button size="lg" type="button" variant="secondary" onClick={closeSuccessDialog}>
                Add another
              </Button>
            </div>
          ) : null}
        </div>
      </dialog>
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
            outboundLinks: payload.outboundLinks,
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
