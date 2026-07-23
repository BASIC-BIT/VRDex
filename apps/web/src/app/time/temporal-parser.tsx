"use client";

import { api } from "@convex-generated-api";
import type {
  TemporalParseCompletedResponse,
  TemporalParsePendingResponse,
} from "@vrdex/api-contracts";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useFeatureFlagEnabled, usePostHog } from "posthog-js/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldText, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  captureProductEvent,
  mirrorTemporalParsingAccess,
  TEMPORAL_PARSING_UI_FLAG,
} from "@/lib/posthog";

type Result = TemporalParseCompletedResponse | TemporalParsePendingResponse;

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const posthogConfigured = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim());

function latencyBucket(milliseconds: number) {
  if (milliseconds < 2_000) return "under_2s" as const;
  if (milliseconds < 5_000) return "under_5s" as const;
  if (milliseconds < 30_000) return "under_30s" as const;
  return "over_30s" as const;
}

function formatInstant(isoInstant: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "long",
  }).format(new Date(isoInstant));
}

function completedOutcome(result: TemporalParseCompletedResponse) {
  return result.status;
}

class TemporalUserError extends Error {}

async function readTemporalResponse(response: Response): Promise<Result> {
  const body = await response.json().catch(() => null) as Result | null;
  if (response.ok && body !== null) {
    return body;
  }
  const message = response.status === 400
    ? "Check the time expression and time settings, then try again."
    : response.status === 401
      ? "Sign in again to use VRDex Time."
      : response.status === 403
        ? "Your account does not currently have access to VRDex Time."
        : response.status === 410
          ? "This request expired. Please try again."
          : response.status === 429
            ? "You have reached the current parsing limit. Please try again later."
            : response.status === 504
              ? "The parser timed out. Please try again."
              : "VRDex Time is temporarily unavailable. Please try again."
  throw new TemporalUserError(message);
}

function ConnectedTemporalParser() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const access = useQuery(api.temporalParsing.getAccess, isAuthenticated ? {} : "skip");
  const setRetention = useMutation(api.temporalParsing.setRetentionPreference);
  const posthog = usePostHog();
  const uiFlag = useFeatureFlagEnabled(TEMPORAL_PARSING_UI_FLAG);
  const [text, setText] = useState("");
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [locale, setLocale] = useState("en-US");
  const [country, setCountry] = useState("US");
  const [subdivision, setSubdivision] = useState("");
  const [referenceInstant, setReferenceInstant] = useState("");
  const [retainInput, setRetainInput] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pageOpened = useRef(false);
  const enabled = access?.allowed === true && access.emailVerified && (
    !posthogConfigured || uiFlag !== false
  );

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
    const browserLocale = navigator.language || "en-US";
    setLocale(browserLocale);
    setCountry(new Intl.Locale(browserLocale).maximize().region ?? "US");
  }, []);

  useEffect(() => {
    if (access === undefined) return;
    mirrorTemporalParsingAccess(posthog, access.allowed && access.emailVerified);
    setRetainInput(access.retainInputs);
  }, [access, posthog]);

  useEffect(() => {
    if (!enabled || pageOpened.current) return;
    pageOpened.current = true;
    captureProductEvent(posthog, "temporal_page_opened", {
      retention_default: access?.retainInputs === false ? "do_not_retain" : "retain",
    });
    void fetch("/api/time/prewarm", { method: "POST" });
  }, [access?.retainInputs, enabled, posthog]);

  const resultSummary = useMemo(() => {
    if (result?.status !== "resolved") return null;
    if (result.kind === "instant" && result.canonical !== undefined) {
      return formatInstant(result.canonical.isoInstant);
    }
    if (result.kind === "time_range" && result.range !== undefined) {
      return `${formatInstant(result.range.start.canonical.isoInstant)} to ${formatInstant(result.range.end.canonical.isoInstant)}`;
    }
    return null;
  }, [result]);

  async function poll(pending: TemporalParsePendingResponse, startedAt: number) {
    let current = pending;
    while (current.status === "pending" && Date.now() < new Date(current.expiresAt).getTime()) {
      await new Promise((resolve) => setTimeout(resolve, current.retryAfterSeconds * 1_000));
      const response = await fetch(
        `/api/time/parse/${encodeURIComponent(current.continuationToken)}`,
        { cache: "no-store" },
      );
      const body = await readTemporalResponse(response);
      current = body as TemporalParsePendingResponse;
      setResult(body);
      if (body.status !== "pending") {
        captureProductEvent(posthog, "temporal_parse_completed", {
          latency: latencyBucket(Date.now() - startedAt),
          outcome: completedOutcome(body),
        });
        return;
      }
    }
    throw new TemporalUserError("This request expired. Please try again.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim() || submitting) return;
    const startedAt = Date.now();
    setSubmitting(true);
    setError(null);
    setResult(null);
    captureProductEvent(posthog, "temporal_parse_submitted", {
      retention: retainInput ? "retain" : "do_not_retain",
    });
    try {
      const idempotencyKey = crypto.randomUUID();
      const requestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          text,
          timeZone,
          locale,
          ...(country.trim() ? { country: country.trim() } : {}),
          ...(subdivision.trim() ? { subdivision: subdivision.trim() } : {}),
          ...(referenceInstant.trim() ? { referenceInstant: referenceInstant.trim() } : {}),
          retainInput,
        }),
      };
      let response: Response;
      try {
        response = await fetch("/api/time/parse", requestInit);
      } catch {
        response = await fetch("/api/time/parse", requestInit);
      }
      const body = await readTemporalResponse(response);
      setResult(body);
      if (body.status === "pending") {
        await poll(body, startedAt);
      } else {
        captureProductEvent(posthog, "temporal_parse_completed", {
          latency: latencyBucket(Date.now() - startedAt),
          outcome: completedOutcome(body),
        });
      }
    } catch (caught) {
      setError(caught instanceof TemporalUserError
        ? caught.message
        : "VRDex Time could not complete the parse. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function changeRetention(next: boolean) {
    if (!next && !window.confirm(
      "Turn off saving and delete your retained VRDex Time beta history?",
    )) {
      return;
    }
    const previous = retainInput;
    setRetainInput(next);
    setError(null);
    try {
      await setRetention({ retainInputs: next });
      captureProductEvent(posthog, "temporal_retention_changed", {
        retention_default: next ? "retain" : "do_not_retain",
      });
    } catch {
      setRetainInput(previous);
      setError("Your retention preference could not be saved. Please try again.");
    }
  }

  if (isLoading || access === undefined && isAuthenticated) {
    return <Card aria-busy="true">Loading...</Card>;
  }

  if (!isAuthenticated) {
    return (
      <Notice>
        <Link className="font-medium text-accent underline underline-offset-4" href="/sign-in">
          Sign in
        </Link>{" "}
        to use VRDex Time.
      </Notice>
    );
  }

  if (!access?.emailVerified) {
    return <Notice variant="warning">Verify your email before using VRDex Time.</Notice>;
  }

  if (!access.allowed) {
    return <Notice>VRDex Time is currently available only in the closed beta.</Notice>;
  }

  if (uiFlag === undefined) {
    return <Card aria-busy="true">Checking beta access...</Card>;
  }

  if (!uiFlag) {
    return <Notice>VRDex Time is currently available only in the closed beta.</Notice>;
  }

  return (
    <TemporalParserSurface
      country={country}
      error={error}
      locale={locale}
      onCountryChange={setCountry}
      onLocaleChange={setLocale}
      onReferenceInstantChange={setReferenceInstant}
      onRetentionChange={(next) => void changeRetention(next)}
      onSubmit={submit}
      onSubdivisionChange={setSubdivision}
      onTextChange={setText}
      onTimeZoneChange={setTimeZone}
      referenceInstant={referenceInstant}
      result={result}
      resultSummary={resultSummary}
      retainInput={retainInput}
      submitting={submitting}
      subdivision={subdivision}
      text={text}
      timeZone={timeZone}
    />
  );
}

export function TemporalParser() {
  if (!convexUrl) {
    return <Notice>VRDex Time is unavailable in this environment.</Notice>;
  }
  return <ConnectedTemporalParser />;
}

export type TemporalParserSurfaceProps = {
  contextInitiallyOpen?: boolean;
  country: string;
  error: string | null;
  locale: string;
  onCountryChange: (value: string) => void;
  onLocaleChange: (value: string) => void;
  onReferenceInstantChange: (value: string) => void;
  onRetentionChange: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSubdivisionChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onTimeZoneChange: (value: string) => void;
  referenceInstant: string;
  result: Result | null;
  resultSummary: string | null;
  retainInput: boolean;
  submitting: boolean;
  subdivision: string;
  text: string;
  timeZone: string;
};

export function TemporalParserSurface({
  contextInitiallyOpen = false,
  country,
  error,
  locale,
  onCountryChange,
  onLocaleChange,
  onReferenceInstantChange,
  onRetentionChange,
  onSubmit,
  onSubdivisionChange,
  onTextChange,
  onTimeZoneChange,
  referenceInstant,
  result,
  resultSummary,
  retainInput,
  submitting,
  subdivision,
  text,
  timeZone,
}: TemporalParserSurfaceProps) {
  return (
    <div className="grid gap-5">
      <Card>
        <form className="grid gap-5" onSubmit={onSubmit}>
          <Field>
            Time expression
            <Textarea
              autoFocus
              className="ph-no-capture min-h-28 resize-y text-base"
              data-ph-no-capture
              maxLength={500}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder="Next Friday at 8pm Eastern"
              required
              value={text}
            />
            <FieldText>{text.length}/500</FieldText>
          </Field>

          <details className="rounded-control border border-border bg-surface-strong px-4 py-3" open={contextInitiallyOpen || undefined}>
            <summary className="cursor-pointer text-sm font-medium">Context</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field>
                Timezone
                <Input onChange={(event) => onTimeZoneChange(event.target.value)} value={timeZone} />
              </Field>
              <Field>
                Locale
                <Input onChange={(event) => onLocaleChange(event.target.value)} value={locale} />
              </Field>
              <Field>
                Country
                <Input
                  maxLength={2}
                  onChange={(event) => onCountryChange(event.target.value.toUpperCase())}
                  placeholder="US"
                  value={country}
                />
              </Field>
              <Field>
                Subdivision
                <Input
                  maxLength={3}
                  onChange={(event) => onSubdivisionChange(event.target.value.toUpperCase())}
                  placeholder="IN (optional)"
                  value={subdivision}
                />
              </Field>
              <Field className="sm:col-span-2">
                Reference instant
                <Input
                  onChange={(event) => onReferenceInstantChange(event.target.value)}
                  placeholder="ISO 8601 override (optional)"
                  value={referenceInstant}
                />
                <FieldText>Leave blank to use the request time.</FieldText>
              </Field>
            </div>
          </details>

          <label className="flex items-start gap-3 text-sm leading-6">
            <input
              checked={retainInput}
              className="mt-1 size-4 accent-[var(--accent)]"
              onChange={(event) => onRetentionChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              Save my time expressions to improve the parser.
              <span className="block text-xs text-muted">
                Turning this off deletes retained beta history. Do not submit secrets or sensitive personal information.
              </span>
            </span>
          </label>

          <div>
            <Button disabled={!text.trim() || submitting} type="submit">
              {submitting ? "Parsing..." : "Parse time"}
            </Button>
          </div>
        </form>
      </Card>

      {error !== null ? <Notice variant="error">{error}</Notice> : null}
      {result?.status === "pending" ? (
        <Notice>Model warming. Your result will appear here automatically.</Notice>
      ) : null}
      {result?.status === "resolved" ? (
        <Card aria-live="polite" surface="strong">
          <p className="text-lg font-medium">{resultSummary}</p>
          <dl className="mt-4 grid gap-2 font-mono text-xs text-muted sm:grid-cols-2">
            <div>
              <dt>Result type</dt>
              <dd className="mt-1 text-foreground">{result.kind}</dd>
            </div>
            <div>
              <dt>Model confidence</dt>
              <dd className="mt-1 text-foreground">{Math.round(result.confidence * 100)}%</dd>
            </div>
            {result.canonical !== undefined ? (
              <div className="sm:col-span-2">
                <dt>Canonical instant</dt>
                <dd className="mt-1 break-all text-foreground">{result.canonical.isoInstant}</dd>
              </div>
            ) : null}
            {result.kind === "time_range" ? (
              <>
                <div className="sm:col-span-2">
                  <dt>Canonical start</dt>
                  <dd className="mt-1 break-all text-foreground">
                    {result.range.start.canonical.isoInstant}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt>Canonical end</dt>
                  <dd className="mt-1 break-all text-foreground">
                    {result.range.end.canonical.isoInstant}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        </Card>
      ) : null}
      {result?.status === "needs_clarification" ? (
        <Card aria-live="polite" surface="strong">
          <p className="font-medium">{result.question}</p>
          {result.alternatives.length > 0 ? (
            <ul className="mt-3 grid gap-2 text-sm text-muted">
              {result.alternatives.map((alternative, index) => (
                <li key={`${alternative.epoch}-${index}`}>
                  <span className="text-foreground">{alternative.label}</span>
                  <span className="ml-2">{formatInstant(alternative.canonical.isoInstant)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
      {result?.status === "no_plan" ? (
        <Notice variant="warning" aria-live="polite">{result.reason}</Notice>
      ) : null}
    </div>
  );
}
