"use client";

import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function MediaPreviewImage({
  alt,
  className,
  src,
}: {
  alt: string;
  className?: string;
  src: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const failed = failedSrc === src;
  const loaded = loadedSrc === src;

  if (failed) {
    return (
      <div className={cn(className, "grid place-items-center p-4 text-center")}>
        <div>
          <p className="text-sm text-muted" role="status">Preview unavailable.</p>
          <button
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-3")}
            onClick={() => {
              setFailedSrc(null);
              setLoadedSrc(null);
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {!loaded ? (
        <div
          aria-label="Loading image"
          className="absolute inset-0 grid place-items-center bg-canvas-muted"
          role="status"
        >
          <span
            aria-hidden="true"
            className="size-5 animate-spin rounded-full border-2 border-border border-t-foreground/70"
          />
        </div>
      ) : null}
      {/* Controlled VRDex asset routes are intentionally rendered as ordinary images. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt}
        className={cn(className, "transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
        key={attempt}
        loading="lazy"
        onError={() => setFailedSrc(src)}
        onLoad={() => setLoadedSrc(src)}
        src={src}
      />
    </>
  );
}
