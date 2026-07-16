"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { Search } from "lucide-react";
import Link from "next/link";

import { api } from "@convex-generated-api";
import { buttonVariants } from "@/components/ui/button";
import { EntityImage } from "@/components/ui/entity-image";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/cn";

const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

function SignedOutControl() {
  return (
    <Link className={buttonVariants({ variant: "secondary" })} href="/sign-in">
      Sign in
    </Link>
  );
}

function ConnectedAccountControl() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const viewer = useQuery(api.accounts.viewer, isAuthenticated ? {} : "skip");

  if (isLoading) {
    return <span aria-hidden="true" className="h-10 w-24 rounded-control border border-border bg-surface-strong" />;
  }

  if (!isAuthenticated) {
    return <SignedOutControl />;
  }

  const label = viewer?.user.name ?? viewer?.user.email ?? "Account";

  return (
    <Link className={cn(buttonVariants({ variant: "secondary" }), "gap-2 py-1.5 pr-3 pl-1.5")} href="/account">
      <EntityImage alt="" className="size-7 rounded-control" label={label} sizes="28px" src={viewer?.user.image} />
      <span>Account</span>
    </Link>
  );
}

function AccountControl() {
  return convexEnabled ? <ConnectedAccountControl /> : <SignedOutControl />;
}

export function NavUtilities() {
  return (
    <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
      <Link
        aria-label="Search"
        className={cn(buttonVariants({ variant: "ghost" }), "size-10 p-0")}
        href="/search"
        title="Search"
      >
        <Search aria-hidden="true" className="size-4" />
      </Link>
      <ThemeToggle className="size-10 p-0" />
      <AccountControl />
    </div>
  );
}
