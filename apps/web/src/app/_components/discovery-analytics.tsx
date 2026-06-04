"use client";

import Link, { type LinkProps } from "next/link";
import { usePostHog } from "posthog-js/react";
import { type FormEvent, type ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type DiscoveryEventProperties = Record<string, string | number | boolean | undefined>;

export function DiscoverySearchForm({ defaultQuery }: { defaultQuery?: string }) {
  const posthog = usePostHog();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const query = String(formData.get("q") ?? "").trim();

    if (query) {
      posthog?.capture("search_submitted", {
        query,
        surface: "discover",
      });
    }
  }

  return (
    <form className="mt-8 flex flex-col gap-3 sm:flex-row" action="/discover" onSubmit={onSubmit}>
      <input
        className="min-h-14 flex-1 rounded-control border border-white/25 bg-white/16 px-5 text-base text-white outline-none placeholder:text-white/62 focus:border-white/70 focus-visible:ring-2 focus-visible:ring-white/25"
        defaultValue={defaultQuery}
        name="q"
        placeholder="Search DJs, communities, worlds, events, genres..."
      />
      <button
        className={cn(buttonVariants({ size: "lg", variant: "inversePrimary" }), "min-h-14 px-6 font-semibold")}
        type="submit"
      >
        Search VRDex
      </button>
    </form>
  );
}

export function TrackedDiscoveryLink({
  children,
  eventName,
  properties,
  ...props
}: LinkProps & {
  children: ReactNode;
  className?: string;
  eventName: string;
  properties: DiscoveryEventProperties;
}) {
  const posthog = usePostHog();

  return (
    <Link
      {...props}
      onClick={() => {
        posthog?.capture(eventName, properties);
      }}
    >
      {children}
    </Link>
  );
}
