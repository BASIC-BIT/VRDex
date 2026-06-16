"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import { Field, FieldText, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import type { Id } from "../../../../../convex/_generated/dataModel";

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

type ProfileAssetPlacement = "profile_image" | "banner" | "primary_logo" | "additional_logo";

type ProfileAssetUploadPayload = {
  intentId: Id<"profileAssetUploadIntents">;
  uploadToken: string;
  label?: string;
  caption?: string;
  placements: ProfileAssetPlacement[];
  position?: number;
};

type CreateUploadIntent = (payload: {
  originalFileName?: string;
  sourceUrl?: string;
  mimeType: string;
  byteSize?: number;
}) => Promise<{
  intentId: Id<"profileAssetUploadIntents">;
  uploadToken: string;
}>;

type ProfileSubmissionPayload =
  | {
      profileType: "person";
      displayName: string;
      aliases: string[];
      tags: string[];
      assets?: ProfileAssetUploadPayload[];
      person: { roleTags: string[] };
    }
  | {
      profileType: "community";
      displayName: string;
      aliases: string[];
      tags: string[];
      assets?: ProfileAssetUploadPayload[];
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

function fileField(formData: FormData, name: string): File | undefined {
  const value = formData.get(name);

  return value instanceof File && value.size > 0 ? value : undefined;
}

function fileListField(formData: FormData, name: string): File[] {
  return formData.getAll(name).filter((value): value is File => value instanceof File && value.size > 0);
}

function optionalStringField(value: FormDataEntryValue | null): string | undefined {
  const text = stringField(value).trim();

  return text ? text : undefined;
}

function mimeTypeForFile(file: File): string {
  if (file.type) {
    return file.type;
  }

  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lowerName.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/png";
}

function mimeTypeForUrl(url: string): string {
  const lowerUrl = url.toLowerCase().split("?")[0] ?? "";

  if (lowerUrl.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (lowerUrl.endsWith(".jpg") || lowerUrl.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lowerUrl.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/png";
}

async function uploadAssetFile(
  createUploadIntent: CreateUploadIntent,
  file: File,
): Promise<Pick<ProfileAssetUploadPayload, "intentId" | "uploadToken">> {
  const intent = await createUploadIntent({
    originalFileName: file.name,
    mimeType: mimeTypeForFile(file),
    byteSize: file.size,
  });
  const formData = new FormData();
  formData.set("file", file);
  const response = await fetch(`/api/v0/profile-assets/upload-intents/${intent.intentId}`, {
    method: "POST",
    headers: { "x-vrdex-upload-token": intent.uploadToken },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? "Profile media upload failed.");
  }

  return intent;
}

async function importAssetUrl(
  createUploadIntent: CreateUploadIntent,
  sourceUrl: string,
): Promise<Pick<ProfileAssetUploadPayload, "intentId" | "uploadToken">> {
  const intent = await createUploadIntent({
    sourceUrl,
    mimeType: mimeTypeForUrl(sourceUrl),
  });
  const response = await fetch(`/api/v0/profile-assets/upload-intents/${intent.intentId}`, {
    method: "POST",
    headers: { "x-vrdex-upload-token": intent.uploadToken },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? "Profile media import failed.");
  }

  return intent;
}

async function uploadAssetsFromFormData(
  formData: FormData,
  createUploadIntent?: CreateUploadIntent,
): Promise<ProfileAssetUploadPayload[]> {
  const profileImage = fileField(formData, "profileImage");
  const primaryLogo = fileField(formData, "primaryLogo");
  const primaryLogoSourceUrl = optionalStringField(formData.get("primaryLogoSourceUrl"));
  const additionalLogos = fileListField(formData, "additionalLogos");
  const useProfileImageAsLogo = formData.get("useProfileImageAsPrimaryLogo") === "on";
  const uploads: ProfileAssetUploadPayload[] = [];

  if (!profileImage && !primaryLogo && !primaryLogoSourceUrl && additionalLogos.length === 0) {
    return uploads;
  }

  if (!createUploadIntent) {
    throw new Error("Profile media uploads require the live authenticated submission flow.");
  }

  if (profileImage) {
    const intent = await uploadAssetFile(createUploadIntent, profileImage);
    uploads.push({
      ...intent,
      label: optionalStringField(formData.get("profileImageLabel")) ?? "Profile image",
      placements: useProfileImageAsLogo && !primaryLogo && !primaryLogoSourceUrl
        ? ["profile_image", "primary_logo"]
        : ["profile_image"],
    });
  }

  if (primaryLogo) {
    const intent = await uploadAssetFile(createUploadIntent, primaryLogo);
    uploads.push({
      ...intent,
      label: optionalStringField(formData.get("primaryLogoLabel")) ?? "Primary logo",
      caption: optionalStringField(formData.get("primaryLogoCaption")),
      placements: ["primary_logo"],
    });
  } else if (primaryLogoSourceUrl) {
    const intent = await importAssetUrl(createUploadIntent, primaryLogoSourceUrl);
    uploads.push({
      ...intent,
      label: optionalStringField(formData.get("primaryLogoLabel")) ?? "Primary logo",
      caption: optionalStringField(formData.get("primaryLogoCaption")),
      placements: ["primary_logo"],
    });
  }

  for (const [index, file] of additionalLogos.entries()) {
    const intent = await uploadAssetFile(createUploadIntent, file);
    uploads.push({
      ...intent,
      label: `Logo ${index + 2}`,
      placements: ["additional_logo"],
      position: index + 1,
    });
  }

  return uploads;
}

function payloadFromFormData(formData: FormData, assets?: ProfileAssetUploadPayload[]): ProfileSubmissionPayload {
  const selectedType = stringField(formData.get("profileType")) as ProfileType;
  const sharedPayload = {
    displayName: stringField(formData.get("displayName")),
    aliases: splitList(formData.get("aliases")),
    tags: splitList(formData.get("tags")),
    ...(assets && assets.length > 0 ? { assets } : {}),
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
    <Card surface="dashed">
      <Eyebrow>Submission flow</Eyebrow>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
        Convex URL not configured
      </h2>
      <p className="mt-3 text-sm leading-7 text-muted">
        Run <code className="font-mono text-[0.95em]">pnpm bootstrap:backend:local</code> before testing profile submission locally. The mutation also requires a signed-in Convex identity, so anonymous writes stay blocked.
      </p>
    </Card>
  );
}

function SignInRequiredSubmissionPanel() {
  return (
    <Card surface="dashed">
      <Eyebrow>Submission flow</Eyebrow>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
        Sign-in required
      </h2>
      <p className="mt-3 text-sm leading-7 text-muted">
        Sign in before submitting profile records. Community submissions create unclaimed profiles with narrow source attribution and safe public fields.
      </p>
      <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
        Sign in
      </Link>
    </Card>
  );
}

function SubmissionFormFields({
  submitProfile,
  createUploadIntent,
  helperText,
}: {
  submitProfile: (payload: ProfileSubmissionPayload) => Promise<ProfileSubmissionResult>;
  createUploadIntent?: CreateUploadIntent;
  helperText?: string;
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
      const assets = await uploadAssetsFromFormData(formData, createUploadIntent);
      const result = await submitProfile(payloadFromFormData(formData, assets));

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
          Shared tags
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

      <Notice>
        {helperText ??
          "Community submissions intentionally skip custom slugs, freeform bios, private contact details, and claim signals. Media-kit files are stored in VRDex-managed storage and marked with community-submitted provenance."}
      </Notice>

      <Card surface="dashed" padding="sm">
        <Eyebrow>Media kit</Eyebrow>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field>
            Profile image
            <Input accept="image/png,image/jpeg,image/webp,image/svg+xml" name="profileImage" type="file" />
            <FieldText>Optional avatar/profile picture. PNG, JPG, WebP, or SVG.</FieldText>
          </Field>
          <Field>
            Profile image label
            <Input name="profileImageLabel" placeholder="Profile image" />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm font-medium">
          <input className="size-4 accent-[var(--color-accent)]" name="useProfileImageAsPrimaryLogo" type="checkbox" />
          Use profile image as primary logo when no separate primary logo is provided
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field>
            Primary logo upload
            <Input accept="image/png,image/svg+xml" name="primaryLogo" type="file" />
            <FieldText>PNG or SVG recommended for event runners.</FieldText>
          </Field>
          <Field>
            Primary logo HTTPS URL
            <Input name="primaryLogoSourceUrl" placeholder="https://example.com/logo.svg" type="url" />
            <FieldText>VRDex downloads the file into managed storage instead of hotlinking it.</FieldText>
          </Field>
          <Field>
            Primary logo label
            <Input name="primaryLogoLabel" placeholder="Primary logo" />
          </Field>
          <Field>
            Primary logo caption
            <Input name="primaryLogoCaption" placeholder="Optional public caption" />
          </Field>
        </div>
        <Field className="mt-4">
          Additional logos
          <Input accept="image/png,image/svg+xml" multiple name="additionalLogos" type="file" />
          <FieldText>Optional extra public logo files available for download.</FieldText>
        </Field>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button disabled={isSubmitting} size="lg" type="submit" variant="primary">
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
  const createUploadIntent = useMutation(api.profileAssets.createUploadIntent);

  return <SubmissionFormFields createUploadIntent={createUploadIntent} submitProfile={submitProfile} />;
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
      helperText="E2E mode is enabled for this test run. The form still writes to Convex and public discovery, but the request is guarded by a server-side Playwright token instead of an interactive user session."
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
