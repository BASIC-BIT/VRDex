"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Component, createContext, useContext, type ReactNode } from "react";
import { api } from "@convex-generated-api";
import {
  BrandLink,
  PageContainer,
  PageNav,
  PageShell,
} from "@/components/ui/page-shell";
import { Notice } from "@/components/ui/notice";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { clubNavigation } from "./club-workspace-model";

export type WorkspaceData = NonNullable<
  FunctionReturnType<typeof api.clubStaff.getWorkspace>
>;
const WorkspaceContext = createContext<WorkspaceData | null>(null);

export function useClubWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Club workspace is unavailable.");
  return workspace;
}

export function ClubAccessNotice() {
  return (
    <Notice variant="warning">You do not have access to this page.</Notice>
  );
}

export class ClubErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Notice variant="error" role="alert">
        Unable to load this page.
        <Button
          className="ml-3"
          size="sm"
          variant="secondary"
          onClick={() => this.setState({ failed: false })}
        >
          Retry
        </Button>
      </Notice>
    ) : (
      this.props.children
    );
  }
}

export function ClubWorkspaceView({
  data,
  pathname,
  children,
}: {
  data: WorkspaceData;
  pathname: string;
  children: ReactNode;
}) {
  const items = clubNavigation(
    data.community.slug,
    data.actor.kind === "owner",
    data.actor.permissions,
    data.readableCategories,
  );
  return (
    <WorkspaceContext.Provider value={data}>
      <div
        className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 ph-no-capture"
        data-ph-no-capture
      >
        <aside className="min-w-0 border-b border-border pb-4 lg:border-r lg:border-b-0 lg:pr-5">
          <p className="break-words text-lg font-semibold">
            {data.community.displayName}
          </p>
          <nav
            aria-label="Club navigation"
            className="mt-4 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid"
          >
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onFocus={(event) =>
                  event.currentTarget.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                  })
                }
                aria-current={pathname === item.href ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-control px-3 py-2.5 text-sm transition focus-visible:ring-2 focus-visible:ring-focus",
                  pathname === item.href
                    ? "bg-surface-strong font-semibold text-foreground"
                    : "text-muted hover:bg-surface-strong hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <p className="mt-5 text-xs text-muted lg:mt-10">
            {data.connectionState?.replaceAll("_", " ") ?? "Not connected"}
          </p>
          <Link
            className="mt-4 inline-block text-xs text-muted underline underline-offset-4"
            href="/account"
          >
            All profiles
          </Link>
        </aside>
        <section className="min-w-0">
          <ClubErrorBoundary key={pathname}>{children}</ClubErrorBoundary>
        </section>
      </div>
    </WorkspaceContext.Provider>
  );
}

function ConnectedWorkspace({
  communitySlug,
  children,
}: {
  communitySlug: string;
  children: ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const data = useQuery(
    api.clubStaff.getWorkspace,
    isLoading || !isAuthenticated ? "skip" : { communitySlug },
  );
  if (isLoading) return <Notice role="status">Loading club…</Notice>;
  if (!isAuthenticated)
    return (
      <Link
        className={buttonVariants()}
        href={`/sign-in?returnTo=${encodeURIComponent(pathname)}`}
      >
        Sign in
      </Link>
    );
  if (data === undefined) return <Notice role="status">Loading club…</Notice>;
  if (data === null) return <ClubAccessNotice />;
  return (
    <ClubWorkspaceView data={data} pathname={pathname}>
      {children}
    </ClubWorkspaceView>
  );
}

export function ClubWorkspace({
  communitySlug,
  children,
}: {
  communitySlug: string;
  children: ReactNode;
}) {
  return (
    <PageShell>
      <PageContainer max="7xl">
        <PageNav>
          <BrandLink />
        </PageNav>
        <ClubErrorBoundary key={communitySlug}>
          <ConnectedWorkspace communitySlug={communitySlug}>
            {children}
          </ConnectedWorkspace>
        </ClubErrorBoundary>
      </PageContainer>
    </PageShell>
  );
}
