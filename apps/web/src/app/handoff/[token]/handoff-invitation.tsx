"use client";

import type { FunctionReference } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, type ReactNode, useState } from "react";

import { api } from "@convex-generated-api";
import { buttonVariants, Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/cn";
import {
  defaultHandoffSelectionKey,
  type HandoffField,
  type HandoffPreview,
  normalizeHandoffPreview,
  normalizeOwnerDestination,
} from "./handoff-contract";
import type { HandoffFixture } from "./handoff-fixtures";

type SeedHandoffsApi = {
  previewInvitation: FunctionReference<"query", "public", { token: string }, unknown>;
  acceptInvitation: FunctionReference<
    "mutation",
    "public",
    { token: string; selectedFieldIds: string[] },
    unknown
  >;
};

const seedHandoffsApi = (api as unknown as { seedHandoffs: SeedHandoffsApi }).seedHandoffs;

type ViewerState = "ready" | "signed_out" | "unverified_email";

function invitationPath(token: string): string {
  return `/handoff/${encodeURIComponent(token)}`;
}

function signInPath(token: string): string {
  return `/sign-in?returnTo=${encodeURIComponent(invitationPath(token))}`;
}

function fieldDisplayValue(field: HandoffField): string {
  if (!field.url) {
    return field.value;
  }

  try {
    const url = new URL(field.url);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return field.value;
  }
}

function LoadingInvitation() {
  return (
    <div aria-busy="true" className="py-16" role="status">
      <p className="text-sm font-medium text-[#16746f]">Opening your invitation</p>
      <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Preparing your review.</h1>
      <div className="mt-8 grid gap-3" aria-hidden="true">
        <span className="h-16 animate-pulse bg-white/70" />
        <span className="h-24 animate-pulse bg-white/55" />
        <span className="h-24 animate-pulse bg-white/40" />
      </div>
    </div>
  );
}

const terminalStates = {
  invalid: {
    title: "Invitation not found",
    message: "This handoff link is not valid. Check that the complete link was opened.",
  },
  expired: {
    title: "Invitation expired",
    message: "This handoff can no longer be accepted. Ask the sender for a new invitation.",
  },
  revoked: {
    title: "Invitation revoked",
    message: "This handoff was withdrawn and can no longer be accepted.",
  },
} as const;

function TerminalInvitation({ preview }: { preview: Exclude<HandoffPreview, { state: "ready" }> }) {
  if (preview.state === "accepted") {
    return (
      <div className="py-16">
        <p className="text-sm font-medium text-[#16746f]">Handoff complete</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Invitation already accepted</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted">
          This prepared identity has already been transferred to its owner account.
        </p>
        <Link
          className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-7")}
          href={preview.ownerDestination ?? "/account"}
        >
          Open account
        </Link>
      </div>
    );
  }

  const content = terminalStates[preview.state];

  return (
    <div className="py-16">
      <p className="text-sm font-medium text-[#9f3f27]">Handoff unavailable</p>
      <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">{content.title}</h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-muted">{content.message}</p>
      <Link className={cn(buttonVariants({ size: "lg" }), "mt-7")} href="/">
        Return to VRDex
      </Link>
    </div>
  );
}

function PreparedIdentity({ preview }: { preview: Extract<HandoffPreview, { state: "ready" }> }) {
  const initial = preview.displayName.slice(0, 1).toUpperCase();

  return (
    <section className="grid gap-6 border-y border-[#182f36]/15 bg-white/55 px-5 py-6 sm:grid-cols-[auto_1fr] sm:items-center sm:px-7">
      <div className="flex h-16 w-16 items-center justify-center rounded-card border border-[#16746f]/25 bg-[#dcefed] font-mono text-xl font-semibold text-[#105c58]">
        {initial}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase text-muted">Prepared identity</p>
        <h1 className="mt-2 break-words text-4xl font-semibold leading-tight sm:text-5xl">
          {preview.displayName}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {preview.profileType === "community" ? "Community" : "Person"} handoff
          {preview.expiresAt ? ` | Expires ${new Date(preview.expiresAt).toLocaleDateString()}` : ""}
        </p>
        {preview.sourceName ? (
          <p className="mt-2 text-xs text-muted">Source: {preview.sourceName}</p>
        ) : null}
      </div>
    </section>
  );
}

function FieldChoice({
  checked,
  disabled,
  field,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  field: HandoffField;
  onChange: (checked: boolean) => void;
}) {
  const displayValue = fieldDisplayValue(field);

  return (
    <div className="grid min-h-24 grid-cols-[auto_minmax(0,1fr)] gap-4 rounded-card border border-[#182f36]/15 bg-white/75 px-4 py-4 sm:px-5">
      <input
        aria-label={`Include ${field.label}`}
        checked={checked}
        className="mt-1 h-5 w-5 accent-[#16746f]"
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{field.label}</p>
        {field.links && field.links.length > 0 ? (
          <ul className="mt-2 grid gap-1.5">
            {field.links.map((link) => (
              <li key={`${link.label}:${link.url}`}>
                <a
                  className="block break-all text-sm leading-6 text-[#105c58] underline decoration-[#16746f]/35 underline-offset-4 hover:decoration-[#16746f]"
                  href={link.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {link.label}: {fieldDisplayValue({ ...field, url: link.url })}
                </a>
              </li>
            ))}
          </ul>
        ) : field.url ? (
          <a
            className="mt-2 block break-all text-sm leading-6 text-[#105c58] underline decoration-[#16746f]/35 underline-offset-4 hover:decoration-[#16746f]"
            href={field.url}
            rel="noreferrer"
            target="_blank"
          >
            {displayValue}
          </a>
        ) : (
          <p className="mt-2 break-words text-sm leading-6 text-muted">{displayValue}</p>
        )}
      </div>
    </div>
  );
}

function ReviewInvitation({
  fixture,
  preview,
  token,
  viewerState,
}: {
  fixture: HandoffFixture | null;
  preview: Extract<HandoffPreview, { state: "ready" }>;
  token: string;
  viewerState: ViewerState;
}) {
  const router = useRouter();
  const acceptInvitation = useMutation(seedHandoffsApi.acceptInvitation);
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>(
    () => JSON.parse(defaultHandoffSelectionKey(preview.fields)) as string[],
  );
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  function toggleField(fieldId: string, selected: boolean) {
    setSelectedFieldIds((current) =>
      selected
        ? [...new Set([...current, fieldId])]
        : current.filter((candidate) => candidate !== fieldId),
    );
  }

  async function accept() {
    setError(null);
    setIsAccepting(true);

    try {
      const result = fixture
        ? fixture.acceptResult
        : await acceptInvitation({ token, selectedFieldIds });
      const destination = normalizeOwnerDestination(result).ownerDestination;

      if (!destination) {
        throw new Error("Missing owner destination");
      }

      if (fixture) {
        window.sessionStorage.setItem(
          "vrdex.e2e.handoff.selectedFieldIds",
          JSON.stringify(selectedFieldIds),
        );
      }

      router.replace(destination);
    } catch {
      setError("The handoff could not be accepted. Refresh the invitation and try again.");
      setIsAccepting(false);
    }
  }

  const choicesDisabled = viewerState !== "ready" || isAccepting;

  return (
    <div className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
      <section>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-semibold">Choose the details to keep</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Each selected detail will move into your owner-controlled profile.
            </p>
          </div>
          <p className="text-sm text-muted">
            {selectedFieldIds.length} of {preview.fields.length} selected
          </p>
        </div>

        <div className="mt-5 grid gap-3">
          {preview.fields.length > 0 ? (
            preview.fields.map((field) => (
              <FieldChoice
                checked={selectedFieldIds.includes(field.id)}
                disabled={choicesDisabled}
                field={field}
                key={field.id}
                onChange={(selected) => toggleField(field.id, selected)}
              />
            ))
          ) : (
            <Notice variant="dashed">No optional details were included with this invitation.</Notice>
          )}
        </div>
      </section>

      <aside className="border-t border-[#182f36]/15 pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">
        {viewerState === "signed_out" ? (
          <>
            <h2 className="text-xl font-semibold">Continue to your account</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Sign in or create an account, then return here to accept the handoff.
            </p>
            <Link
              className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5 w-full")}
              href={signInPath(token)}
            >
              Continue to sign in
            </Link>
          </>
        ) : viewerState === "unverified_email" ? (
          <>
            <h2 className="text-xl font-semibold">Verify your email first</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              A verified email is required before this identity can be transferred.
            </p>
            <Link
              className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5 w-full")}
              href="/account"
            >
              Open account
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold">Finalize</h2>
            <Button
              className="mt-5 w-full"
              disabled={isAccepting}
              size="lg"
              type="button"
              variant="primary"
              onClick={() => void accept()}
            >
              {isAccepting ? "Accepting..." : "Take ownership"}
            </Button>
          </>
        )}

        {error ? <Notice className="mt-4" variant="error">{error}</Notice> : null}
      </aside>
    </div>
  );
}

function ConnectedHandoffInvitation({ fixture, token }: { fixture: HandoffFixture | null; token: string }) {
  const previewResult = useQuery(
    seedHandoffsApi.previewInvitation,
    fixture ? "skip" : { token },
  );
  const viewer = useQuery(api.accounts.viewer, fixture ? "skip" : {});

  if (fixture?.loading || (!fixture && (previewResult === undefined || viewer === undefined))) {
    return <LoadingInvitation />;
  }

  const preview = normalizeHandoffPreview(fixture ? fixture.preview : previewResult);

  if (preview.state !== "ready") {
    return <TerminalInvitation preview={preview} />;
  }

  const viewerState: ViewerState = fixture?.viewerState
    ?? (viewer === null
      ? "signed_out"
      : viewer?.user.emailVerified
        ? "ready"
        : "unverified_email");

  return (
    <>
      <PreparedIdentity preview={preview} />
      <ReviewInvitation
        key={`${token}:${defaultHandoffSelectionKey(preview.fields)}`}
        fixture={fixture}
        preview={preview}
        token={token}
        viewerState={viewerState}
      />
    </>
  );
}

class HandoffErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="py-16">
          <p className="text-sm font-medium text-[#9f3f27]">Handoff unavailable</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Invitation could not be opened</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted">
            Refresh the page or ask the sender to confirm the invitation.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export function HandoffInvitation({ fixture, token }: { fixture: HandoffFixture | null; token: string }) {
  return (
    <PageShell className="handoff-shell ph-no-capture py-6 sm:py-8" data-ph-no-capture>
      <PageContainer max="5xl">
        <PageNav className="border-b border-[#182f36]/15 pb-5">
          <BrandLink />
          <Link className={buttonVariants({ size: "sm", variant: "ghost" })} href="/account">
            Account
          </Link>
        </PageNav>
        <HandoffErrorBoundary>
          <ConnectedHandoffInvitation fixture={fixture} token={token} />
        </HandoffErrorBoundary>
      </PageContainer>
    </PageShell>
  );
}
