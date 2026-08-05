"use client";

import { FormEvent, useState, useTransition } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

function textField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export function SuppressionRequestForm() {
  const requestSuppression = useMutation(api.suppressions.requestProfileSuppression);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();

  if (!convexUrl) {
    return (
      <Notice className="px-5 py-6 leading-7" variant="dashed">
        Convex is not configured. Run the local backend before submitting suppression requests.
      </Notice>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setStatus({ kind: "submitting" });

    try {
      await requestSuppression({
        requestType: textField(formData.get("requestType")) as
          | "owner_opt_out"
          | "pre_claim_safety",
        profileSlug: textField(formData.get("profileSlug")) || undefined,
        profileType: (textField(formData.get("profileType")) || undefined) as
          | "person"
          | "community"
          | undefined,
        displayName: textField(formData.get("displayName")) || undefined,
        requesterContact: textField(formData.get("requesterContact")) || undefined,
        requesterNote: textField(formData.get("requesterNote")) || undefined,
      });
      form.reset();
      startTransition(() => setStatus({ kind: "success" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      startTransition(() =>
        setStatus({ kind: "error", message: message || "Suppression request failed." }),
      );
    }
  }

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          Request type
          <Select name="requestType">
            <option value="owner_opt_out">I own this listing and want it opted out</option>
            <option value="pre_claim_safety">This unclaimed listing needs safety review</option>
          </Select>
        </Field>

        <Field>
          Profile type
          <Select name="profileType">
            <option value="person">Person</option>
            <option value="community">Community</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          Profile slug
          <Input name="profileSlug" placeholder="dj-aurora" />
        </Field>

        <Field>
          Display name if slug is unknown
          <Input name="displayName" placeholder="DJ Aurora" />
        </Field>
      </div>

      <Field>
        Contact for follow-up
        <Input name="requesterContact" placeholder="Email or Discord handle" />
      </Field>

      <Field>
        Note
        <Textarea className="min-h-32" name="requesterNote" placeholder="Briefly explain the request. Do not include sensitive proof in this first form." />
      </Field>

      <Button className="w-fit" disabled={status.kind === "submitting"} size="lg" type="submit" variant="primary">
        {status.kind === "submitting" ? "Submitting..." : "Submit request"}
      </Button>

      {status.kind === "success" ? (
        <Notice variant="success">
          Request submitted for review.
        </Notice>
      ) : null}
      {status.kind === "error" ? (
        <Notice variant="error">
          {status.message}
        </Notice>
      ) : null}
    </form>
  );
}
