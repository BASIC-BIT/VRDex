"use client";

import { FormEvent, useState, useTransition } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex-generated-api";

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
      <div className="rounded-[1.5rem] border border-dashed border-border bg-surface px-5 py-6 text-sm leading-7 text-muted">
        Convex is not configured. Run the local backend before submitting suppression requests.
      </div>
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
        <label className="grid gap-2 text-sm font-medium">
          Request type
          <select
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent"
            name="requestType"
          >
            <option value="owner_opt_out">I own this listing and want it opted out</option>
            <option value="pre_claim_safety">This unclaimed listing needs safety review</option>
          </select>
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Profile type
          <select
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent"
            name="profileType"
          >
            <option value="person">Person</option>
            <option value="community">Community</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          Profile slug
          <input
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
            name="profileSlug"
            placeholder="dj-aurora"
          />
        </label>

        <label className="grid gap-2 text-sm font-medium">
          Display name if slug is unknown
          <input
            className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
            name="displayName"
            placeholder="DJ Aurora"
          />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium">
        Contact for follow-up
        <input
          className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
          name="requesterContact"
          placeholder="Email or Discord handle"
        />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Note
        <textarea
          className="min-h-32 rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent"
          name="requesterNote"
          placeholder="Briefly explain the request. Do not include sensitive proof in this first form."
        />
      </label>

      <div className="rounded-[1.25rem] border border-border bg-surface-strong px-4 py-4 text-sm leading-6 text-muted">
        Submitted requests do not automatically hide a listing. Accepted opt-out or suppression states are enforced across profile pages, search, and event/person references.
      </div>

      <button
        className="inline-flex w-fit items-center justify-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        disabled={status.kind === "submitting"}
        type="submit"
      >
        {status.kind === "submitting" ? "Submitting..." : "Submit request"}
      </button>

      {status.kind === "success" ? (
        <p className="rounded-[1rem] border border-green-700/20 bg-green-700/10 px-4 py-3 text-sm leading-6 text-green-900">
          Request submitted for review.
        </p>
      ) : null}
      {status.kind === "error" ? (
        <p className="rounded-[1rem] border border-accent/35 bg-accent/10 px-4 py-3 text-sm leading-6 text-accent-strong">
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
