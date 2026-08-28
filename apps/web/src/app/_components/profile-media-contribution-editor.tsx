"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "@convex-generated-api";

import { prepareProfileMediaMultipartFallback } from "@/app/account/media-kit/prepare-profile-media-upload";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { profileMediaMimeType } from "@/lib/profile-media-kit";

type ContributionProfile = {
  id: Id<"profiles">;
  profileType: "person" | "community";
  updatedAt: number;
};

function safeMessage(error: unknown) {
  const data = error instanceof ConvexError && typeof error.data === "object"
    ? error.data as { code?: unknown; message?: unknown }
    : null;
  const safeCodes = new Set([
    "MEDIA_EMAIL_UNVERIFIED",
    "MEDIA_INPUT_INVALID",
    "MEDIA_PLACEMENT_INVALID",
    "MEDIA_PROFILE_CHANGED",
    "MEDIA_TARGET_CLAIMED",
    "MEDIA_TARGET_UNAVAILABLE",
  ]);
  if (
    typeof data?.code === "string" &&
    safeCodes.has(data.code) &&
    typeof data.message === "string"
  ) {
    return data.message;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/^.*?Uncaught Error:\s*/s, "").split("\n")[0] ?? "";
  const safePatterns = [
    /A signed-in account is required\./,
    /Verify email/,
    /Refresh profile/,
    /This profile (?:is not accepting media contributions|has been claimed)/,
    /A source URL, file name, and credit are required\./,
    /Profile media assets must .+\./,
    /Profile media asset imports must .+\./,
    /Asset (?:labels|credits) must be \d+ characters or fewer\./,
    /Accessibility descriptions must be \d+ characters or fewer\./,
    /Credit links must .+\./,
    /Image required/,
    /Unsupported image/,
    /This image (?:already exists in the profile media kit|was already proposed for the profile)\./,
    /The image upload failed\./,
  ];

  return safePatterns.some((pattern) => pattern.test(normalized))
    ? normalized
    : "Submission failed";
}

export function ProfileMediaContributionEditor({
  autoFocus = false,
  profile,
}: {
  autoFocus?: boolean;
  profile: ContributionProfile;
}) {
  const router = useRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const createUploadIntent = useMutation(api.profileMediaSubmissions.createUploadIntent);
  const withdraw = useMutation(api.profileMediaSubmissions.withdraw);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (autoFocus) sectionRef.current?.scrollIntoView({ block: "start" });
  }, [autoFocus]);

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
        throw new Error("Image required");
      }
      const mimeType = profileMediaMimeType(selectedFile.type, selectedFile.name);
      if (mimeType === null) throw new Error("Unsupported image");
      const prepared = await prepareProfileMediaMultipartFallback(selectedFile);
      const file = prepared.file;
      const intent = await createUploadIntent({
        profileId: profile.id,
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
      router.push("/account/media-contributions");
    } catch (error) {
      if (submissionId !== undefined) {
        await withdraw({ submissionId }).catch(() => false);
      }
      setStatus(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-border py-6" id="media-contributions" ref={sectionRef}>
      <h2 className="text-lg font-semibold">Media contributions</h2>
      <Card className="mt-4">
        <form className="grid gap-5" onSubmit={submit}>
          <Field>
            Image
            <Input accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" name="file" required type="file" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              Source URL
              <Input name="sourceUrl" placeholder="https://" required type="url" />
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
          {status ? <Notice role="status" variant="error">{status}</Notice> : null}
          <Button disabled={busy} type="submit" variant="primary">
            {busy ? "Submitting…" : "Submit for review"}
          </Button>
        </form>
      </Card>
    </section>
  );
}
