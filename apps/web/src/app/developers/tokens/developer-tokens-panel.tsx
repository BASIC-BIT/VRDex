"use client";

import { api } from "@convex-generated-api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Component, type FormEvent, type ReactNode, useState } from "react";

import { buttonVariants, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldText, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Table, TableCell, TableFrame, TableHead, TableHeaderCell } from "@/components/ui/table";
import { cn } from "@/lib/cn";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const tokenScopes = [
  { value: "public:read", label: "Public reads" },
  { value: "mcp:read", label: "MCP reads" },
  { value: "profile:read", label: "Profile reads" },
  { value: "community:read", label: "Community reads" },
  { value: "events:read", label: "Event reads" },
  { value: "assets:read", label: "Asset reads" },
] as const;

function expiresAtFromForm(value: FormDataEntryValue | null) {
  const days = Number(value);

  if (!Number.isFinite(days) || days <= 0) {
    return undefined;
  }

  return Date.now() + days * 86_400_000;
}

function formatDate(value: number | undefined) {
  if (value === undefined) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function tokenStatusText(status: string) {
  return status === "revoked" ? "Revoked" : "Active";
}

function ConnectedDeveloperTokensPanel() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const tokens = useQuery(
    api.apiTokens.listPersonalTokens,
    isAuthenticated ? { includeRevoked: true } : "skip",
  );
  const revokeToken = useMutation(api.apiTokens.revokePersonalToken);
  const [createdTokenValue, setCreatedTokenValue] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const scopes = formData.getAll("scope").map(String);
    const label = String(formData.get("label") ?? "");
    const expiresAt = expiresAtFromForm(formData.get("expiresInDays"));

    setStatus(null);
    setCreatedTokenValue(null);

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/developer/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          scopes,
          ...(expiresAt === undefined ? {} : { expiresAt }),
        }),
      });
      const body = (await response.json()) as { detail?: string; tokenValue?: string };

      if (!response.ok || !body.tokenValue) {
        setStatus(body.detail ?? "Token creation failed.");
        return;
      }

      form.reset();
      setCreatedTokenValue(body.tokenValue);
      setStatus("Token created.");
    } catch {
      setStatus("Token creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyCreatedToken() {
    if (createdTokenValue === null) {
      return;
    }

    await navigator.clipboard.writeText(createdTokenValue);
    setStatus("Token copied.");
  }

  if (isLoading) {
    return <p className="text-sm text-muted">Loading account...</p>;
  }

  if (!isAuthenticated) {
    return (
      <Card surface="strong">
        <h2 className="text-2xl font-semibold">Sign in required</h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          Developer tokens belong to a signed-in VRDex account.
        </p>
        <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
          Sign in
        </Link>
      </Card>
    );
  }

  if (tokens === undefined) {
    return <p className="text-sm text-muted">Loading tokens...</p>;
  }

  if (tokens === null) {
    return (
      <Card surface="strong">
        <h2 className="text-2xl font-semibold">Sign in required</h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          Developer tokens belong to a signed-in VRDex account.
        </p>
        <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
          Sign in
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.86fr_1.2fr]">
      <Card surface="strong">
        <h2 className="text-2xl font-semibold">Create token</h2>
        <form className="mt-5 grid gap-4" onSubmit={createToken}>
          <Field>
            Label
            <Input name="label" placeholder="Local MCP" required />
          </Field>

          <Field>
            Expires
            <Select defaultValue="" name="expiresInDays">
              <option value="">No expiry</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </Select>
          </Field>

          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">Scopes</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {tokenScopes.map((scope) => (
                <label className="flex items-center gap-2 text-sm" key={scope.value}>
                  <input
                    className="size-4 rounded border-border accent-[var(--color-accent)]"
                    defaultChecked={scope.value === "public:read"}
                    name="scope"
                    type="checkbox"
                    value={scope.value}
                  />
                  <span>{scope.label}</span>
                </label>
              ))}
            </div>
            <FieldText>Select only the access this token needs.</FieldText>
          </fieldset>

          <Button disabled={isSubmitting} size="lg" type="submit" variant="primary">
            Create token
          </Button>
        </form>

        {createdTokenValue ? (
          <div className="mt-5 grid gap-3 rounded-control border border-border bg-surface px-4 py-4">
            <p className="text-sm font-medium">Token value</p>
            <Input readOnly value={createdTokenValue} />
            <Button disabled={isSubmitting} type="button" onClick={copyCreatedToken}>
              Copy token
            </Button>
          </div>
        ) : null}

        {status ? (
          <Notice className="mt-5" variant="dashed">
            {status}
          </Notice>
        ) : null}
      </Card>

      <Card surface="white">
        <h2 className="text-2xl font-semibold">Personal tokens</h2>
        <div className="mt-5">
          {tokens.length === 0 ? (
            <p className="text-sm text-muted">No tokens yet.</p>
          ) : (
            <TableFrame>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Label</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Scopes</TableHeaderCell>
                    <TableHeaderCell>Last used</TableHeaderCell>
                    <TableHeaderCell>Expires</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell>
                  </tr>
                </TableHead>
                <tbody className="divide-y divide-border">
                  {tokens.map((token) => (
                    <tr key={token.id}>
                      <TableCell>
                        <div className="font-medium">{token.label}</div>
                        <div className="mt-1 font-mono text-xs text-muted">{token.tokenPrefix}</div>
                      </TableCell>
                      <TableCell>{tokenStatusText(token.status)}</TableCell>
                      <TableCell className="max-w-56 font-mono text-xs leading-5">
                        {token.scopes.join(", ")}
                      </TableCell>
                      <TableCell>{formatDate(token.lastUsedAt)}</TableCell>
                      <TableCell>{formatDate(token.expiresAt)}</TableCell>
                      <TableCell>
                        <Button
                          disabled={isSubmitting || token.status === "revoked"}
                          size="sm"
                          type="button"
                          variant="secondary"
                          onClick={async () => {
                            if (!window.confirm(`Revoke ${token.label}?`)) {
                              return;
                            }

                            setIsSubmitting(true);

                            try {
                              await revokeToken({
                                tokenId: token.id,
                                reason: "Revoked from developer token dashboard.",
                              });
                              setStatus("Token revoked.");
                            } catch {
                              setStatus("Token revocation failed.");
                            } finally {
                              setIsSubmitting(false);
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableFrame>
          )}
        </div>
      </Card>
    </div>
  );
}

class DeveloperTokensErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Notice className="leading-7" variant="dashed">
          Developer tokens are temporarily unavailable.
        </Notice>
      );
    }

    return this.props.children;
  }
}

export function DeveloperTokensPanel() {
  if (!convexUrl) {
    return (
      <Notice className="leading-7" variant="dashed">
        Convex is not configured in this environment, so developer tokens are unavailable.
      </Notice>
    );
  }

  return (
    <DeveloperTokensErrorBoundary>
      <ConnectedDeveloperTokensPanel />
    </DeveloperTokensErrorBoundary>
  );
}
