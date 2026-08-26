"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { api } from "@convex-generated-api";

import { prepareProfileMediaMultipartFallback } from "@/app/account/media-kit/prepare-profile-media-upload";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Field, FieldText, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { profileMediaMimeType } from "@/lib/profile-media-kit";

type ContributionProfile = {
  id: string;
  slug: string;
  displayName: string;
  profileType: "person" | "community";
  updatedAt: number;
};

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/^.*?Uncaught Error:\s*/s, "").split("\n")[0] ?? "";
  const safePatterns = [
    /A signed-in account is required\./,
    /A verified email address is required to contribute media\./,
    /This profile (?:is not accepting media contributions|has been claimed|changed\.)/,
    /A source URL, file name, and credit are required\./,
    /Profile media assets must .+\./,
    /Profile media asset imports must .+\./,
    /Asset (?:labels|credits) must be \d+ characters or fewer\./,
    /Accessibility descriptions must be \d+ characters or fewer\./,
    /Credit links must .+\./,
    /Choose one image to submit\./,
    /Choose a PNG, JPEG, WebP, or SVG image\./,
    /This image (?:already exists in the profile media kit|was already proposed for the profile)\./,
    /The image upload failed\./,
  ];

  return safePatterns.some((pattern) => pattern.test(normalized))
    ? normalized
    : "The media contribution could not be submitted. Try again.";
}

export function ProfileMediaContributionForm({ profile }: { profile: ContributionProfile }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const createUploadIntent = useMutation(api.profileMediaSubmissions.createUploadIntent);
  const withdraw = useMutation(api.profileMediaSubmissions.withdraw);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "success"; message: string } | null>(null);

  if (isLoading) {
    return <p aria-busy="true" className="text-sm text-muted">Loading sign-in state…</p>;
  }

  if (!isAuthenticated) {
    return (
      <main className="grid gap-6">
        <SectionTitle>Add media for {profile.displayName}</SectionTitle>
        <Card className="grid gap-4">
          <p className="text-sm text-muted">Sign in with a verified email to contribute media.</p>
          <Link className={buttonVariants({ variant: "primary" })} href={`/sign-in?returnTo=${encodeURIComponent(`/${profile.slug}/contribute-media`)}`}>
            Sign in
          </Link>
        </Card>
      </main>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setStatus(null);
    let submissionId: Id<"profileMediaSubmissions"> | undefined;
    try {
      const data = new FormData(form);
      const selectedFile = data.get("file");
      if (!(selectedFile instanceof File) || selectedFile.size === 0) {
        throw new Error("Choose one image to submit.");
      }
      const mimeType = profileMediaMimeType(selectedFile.type, selectedFile.name);
      if (mimeType === null) throw new Error("Choose a PNG, JPEG, WebP, or SVG image.");
      const prepared = await prepareProfileMediaMultipartFallback(selectedFile);
      const file = prepared.file;
      const intent = await createUploadIntent({
        profileId: profile.id as Id<"profiles">,
        requestedPlacement: profile.profileType === "person" ? "profile_image" : "primary_logo",
        originalFileName: file.name,
        mimeType: profileMediaMimeType(file.type, file.name) ?? file.type,
        byteSize: file.size,
        sourceUrl: String(data.get("sourceUrl") ?? ""),
        label: String(data.get("label") ?? "") || undefined,
        altText: String(data.get("altText") ?? "") || undefined,
        credit: String(data.get("credit") ?? ""),
        creditUrl: String(data.get("creditUrl") ?? "") || undefined,
        contributorNote: String(data.get("contributorNote") ?? "") || undefined,
        expectedProfileUpdatedAt: profile.updatedAt,
      });
      submissionId = intent.submissionId;
      const uploadData = new FormData();
      uploadData.set("file", file);
      const response = await fetch(intent.uploadUrl, {
        method: "POST",
        headers: { [intent.uploadTokenHeader]: intent.uploadToken },
        body: uploadData,
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "The image upload failed.");
      form.reset();
      setStatus({ kind: "success", message: "Submitted for review." });
    } catch (error) {
      if (submissionId !== undefined) {
        await withdraw({ submissionId }).catch(() => false);
      }
      setStatus({ kind: "error", message: safeMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid gap-6">
      <div>
        <SectionTitle>Add media for {profile.displayName}</SectionTitle>
        <Link className="mt-3 inline-block text-sm text-muted underline" href={`/${profile.slug}`}>
          Back to profile
        </Link>
      </div>
      <Card>
        <form className="grid gap-5" onSubmit={submit}>
          <Field>
            Image
            <Input accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" name="file" required type="file" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              Source URL
              <Input name="sourceUrl" placeholder="https://" required type="url" />
              <FieldText>Use the page that establishes where the image came from.</FieldText>
            </Field>
            <Field>
              Credit
              <Input name="credit" required />
            </Field>
            <Field>
              Credit URL
              <Input name="creditUrl" placeholder="https://" type="url" />
            </Field>
            <Field>
              Public label
              <Input maxLength={80} name="label" />
            </Field>
          </div>
          <Field>
            Alt text
            <Input maxLength={180} name="altText" />
          </Field>
          <Field>
            Note for reviewer
            <Textarea maxLength={500} name="contributorNote" rows={3} />
          </Field>
          {status ? (
            <Notice role="status" variant={status.kind === "success" ? "success" : "error"}>
              {status.message}{" "}
              {status.kind === "success" ? (
                <Link className="underline" href="/account/media-contributions">View contributions</Link>
              ) : null}
            </Notice>
          ) : null}
          <Button disabled={busy} type="submit" variant="primary">
            {busy ? "Submitting…" : "Submit for review"}
          </Button>
        </form>
      </Card>
      <Link className={buttonVariants({ variant: "ghost" })} href="/account/media-contributions">
        My media contributions
      </Link>
    </main>
  );
}
