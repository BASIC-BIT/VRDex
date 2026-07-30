"use client";

import { api } from "@convex-generated-api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import {
  Component,
  type FormEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";

import { buttonVariants, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldText, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Table, TableCell, TableFrame, TableHead, TableHeaderCell } from "@/components/ui/table";
import { cn } from "@/lib/cn";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const oauthScopes = [
  { value: "public:read", label: "Public reads" },
  { value: "mcp:read", label: "MCP reads" },
  { value: "profile:read", label: "Profile reads" },
  { value: "community:read", label: "Community reads" },
  { value: "events:read", label: "Event reads" },
  { value: "assets:read", label: "Asset reads" },
] as const;

function splitLines(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function optionalField(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();

  return text.length === 0 ? undefined : text;
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

function statusText(status: string) {
  return status === "revoked" ? "Revoked" : "Active";
}

function clientTypeText(clientType: string) {
  return clientType === "confidential" ? "Confidential" : "Public";
}

function ownerText(
  application: { ownerKind: string; ownerCommunityProfileId?: string },
  communitiesById: ReadonlyMap<string, { displayName: string; slug: string }>,
) {
  if (application.ownerKind !== "community" || application.ownerCommunityProfileId === undefined) {
    return "Personal account";
  }

  const community = communitiesById.get(application.ownerCommunityProfileId);

  return community === undefined ? "Community" : community.displayName;
}

function ConnectedOAuthAppsPanel() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const applications = useQuery(
    api.oauthApps.listPersonalApplications,
    isAuthenticated ? { includeRevoked: true } : "skip",
  );
  const ownershipOptions = useQuery(
    api.oauthApps.listPersonalApplicationOwnershipOptions,
    isAuthenticated ? {} : "skip",
  );
  const revokeApplication = useMutation(api.oauthApps.revokePersonalApplication);
  const formRef = useRef<HTMLFormElement>(null);
  const [clientType, setClientType] = useState("public");
  const [createdClientSecret, setCreatedClientSecret] = useState<string | null>(null);
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function createApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const selectedClientType = String(formData.get("clientType") ?? "public");
    const ownerCommunitySlug = optionalField(formData.get("ownerCommunitySlug"));
    const displayName = String(formData.get("displayName") ?? "");

    // Same rationale as token creation: guards the accidental click, not the
    // attacker. Authorization stays on the mutation.
    if (
      !window.confirm(
        `Create the OAuth application "${displayName || "Untitled"}"? The client secret is shown once.`,
      )
    ) {
      return;
    }

    setStatus(null);
    setCreatedClientId(null);
    setCreatedClientSecret(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/developer/oauth-apps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientType: selectedClientType,
          displayName: String(formData.get("displayName") ?? ""),
          description: optionalField(formData.get("description")),
          docsUrl: optionalField(formData.get("docsUrl")),
          privacyUrl: optionalField(formData.get("privacyUrl")),
          ...(ownerCommunitySlug === undefined ? {} : { ownerCommunitySlug }),
          redirectUris: splitLines(formData.get("redirectUris")),
          allowedScopes: formData.getAll("scope").map(String),
        }),
      });
      const body = (await response.json()) as {
        application?: { clientId?: string };
        clientSecretValue?: string;
        code?: string;
        detail?: string;
      };

      if (!response.ok || !body.application?.clientId) {

        setStatus(body.detail ?? "OAuth app creation failed.");
        return;
      }

      form.reset();
      setClientType("public");
      setCreatedClientId(body.application.clientId);
      setCreatedClientSecret(body.clientSecretValue ?? null);
      setStatus("OAuth app created.");
    } catch {
      setStatus("OAuth app creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copySecret() {
    if (createdClientSecret === null) {
      return;
    }

    await navigator.clipboard.writeText(createdClientSecret);
    setStatus("Client secret copied.");
  }

  if (isLoading) {
    return <p className="text-sm text-muted">Loading account...</p>;
  }

  if (!isAuthenticated || applications === null) {
    return (
      <Card surface="strong">
        <h2 className="text-2xl font-semibold">Sign in required</h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          OAuth apps belong to a signed-in VRDex account.
        </p>
        <Link className={cn(buttonVariants({ size: "lg", variant: "primary" }), "mt-5")} href="/sign-in">
          Sign in
        </Link>
      </Card>
    );
  }

  if (applications === undefined) {
    return <p className="text-sm text-muted">Loading OAuth apps...</p>;
  }

  if (ownershipOptions === undefined) {
    return <p className="text-sm text-muted">Loading app owners...</p>;
  }

  const ownedCommunities = ownershipOptions?.communities ?? [];
  const communitiesById = new Map<string, { displayName: string; slug: string }>(
    ownedCommunities.map((community) => [
      String(community.id),
      {
        displayName: community.displayName,
        slug: community.slug,
      },
    ] as const),
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.2fr]">
      <Card surface="strong">
        <h2 className="text-2xl font-semibold">Create app</h2>
        <form
          className="mt-5 grid gap-4"
          onSubmit={createApplication}
          ref={formRef}
        >
          <Field>
            App name
            <Input name="displayName" placeholder="Local MCP client" required />
          </Field>

          <Field>
            Owner
            <Select name="ownerCommunitySlug">
              <option value="">Personal account</option>
              {ownedCommunities.map((community) => (
                <option key={community.id} value={community.slug}>
                  {community.displayName}
                </option>
              ))}
            </Select>
            <FieldText>Personal account or claimed community.</FieldText>
          </Field>

          <Field>
            Client type
            <Select
              name="clientType"
              value={clientType}
              onChange={(event) => setClientType(event.currentTarget.value)}
            >
              <option value="public">Public</option>
              <option value="confidential">Confidential</option>
            </Select>
            <FieldText>
              {clientType === "confidential"
                ? "Confidential apps receive a one-time client secret."
                : "Public apps use PKCE and do not receive a client secret."}
            </FieldText>
          </Field>

          <Field>
            Redirect URIs
            <Textarea
              className="min-h-24"
              name="redirectUris"
              placeholder="http://127.0.0.1:3333/callback"
              required
            />
            <FieldText>Use one exact redirect URI per line.</FieldText>
          </Field>

          <Field>
            Description
            <Textarea className="min-h-20" name="description" placeholder="Public profile lookup for local tools" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              Docs URL
              <Input name="docsUrl" placeholder="https://example.com/docs" type="url" />
            </Field>
            <Field>
              Privacy URL
              <Input name="privacyUrl" placeholder="https://example.com/privacy" type="url" />
            </Field>
          </div>

          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">Scopes</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {oauthScopes.map((scope) => (
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
            <FieldText>These scopes cap what the future OAuth flow can grant.</FieldText>
          </fieldset>

          <Button disabled={isSubmitting} size="lg" type="submit" variant="primary">
            Create app
          </Button>
        </form>

        {createdClientId ? (
          <div className="mt-5 grid gap-3 rounded-control border border-border bg-surface px-4 py-4">
            <p className="text-sm font-medium">Client id</p>
            <Input readOnly value={createdClientId} />
            {createdClientSecret ? (
              <>
                <p className="text-sm font-medium">Client secret</p>
                <Input readOnly value={createdClientSecret} />
                <Button disabled={isSubmitting} type="button" onClick={copySecret}>
                  Copy secret
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {status ? (
          <Notice className="mt-5" variant="dashed">
            {status}
          </Notice>
        ) : null}
      </Card>

      <Card surface="white">
        <h2 className="text-2xl font-semibold">Registered apps</h2>
        <div className="mt-5">
          {applications.length === 0 ? (
            <p className="text-sm text-muted">No OAuth apps yet.</p>
          ) : (
            <TableFrame>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>App</TableHeaderCell>
                    <TableHeaderCell>Owner</TableHeaderCell>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Scopes</TableHeaderCell>
                    <TableHeaderCell>Redirects</TableHeaderCell>
                    <TableHeaderCell>Secrets</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell>
                  </tr>
                </TableHead>
                <tbody className="divide-y divide-border">
                  {applications.map((application) => (
                    <tr key={application.id}>
                      <TableCell>
                        <div className="font-medium">{application.displayName}</div>
                        <div className="mt-1 font-mono text-xs text-muted">{application.clientId}</div>
                        <div className="mt-1 text-xs text-muted">Created {formatDate(application.createdAt)}</div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{ownerText(application, communitiesById)}</span>
                      </TableCell>
                      <TableCell>{clientTypeText(application.clientType)}</TableCell>
                      <TableCell>{statusText(application.status)}</TableCell>
                      <TableCell className="max-w-52 font-mono text-xs leading-5">
                        {application.allowedScopes.join(", ")}
                      </TableCell>
                      <TableCell className="max-w-64 font-mono text-xs leading-5">
                        {application.redirectUris.join(", ")}
                      </TableCell>
                      <TableCell className="font-mono text-xs leading-5">
                        {application.activeSecretPrefixes.length === 0
                          ? "None"
                          : application.activeSecretPrefixes.join(", ")}
                      </TableCell>
                      <TableCell>
                        <Button
                          disabled={isSubmitting || application.status === "revoked"}
                          size="sm"
                          type="button"
                          variant="secondary"
                          onClick={async () => {
                            if (!window.confirm(`Revoke ${application.displayName}?`)) {
                              return;
                            }

                            setIsSubmitting(true);

                            try {
                              await revokeApplication({
                                applicationId: application.id,
                                reason: "Revoked from OAuth app dashboard.",
                              });
                              setStatus("OAuth app revoked.");
                            } catch {

                              setStatus("OAuth app revocation failed.");
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

class OAuthAppsErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Notice className="leading-7" variant="dashed">
          OAuth apps are temporarily unavailable.
        </Notice>
      );
    }

    return this.props.children;
  }
}

export function OAuthAppsPanel() {
  if (!convexUrl) {
    return (
      <Notice className="leading-7" variant="dashed">
        Convex is not configured in this environment, so OAuth apps are unavailable.
      </Notice>
    );
  }

  return (
    <OAuthAppsErrorBoundary>
      <ConnectedOAuthAppsPanel />
    </OAuthAppsErrorBoundary>
  );
}
