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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  if (failed) {
    return (
      <div className={cn(className, "grid place-items-center p-4 text-center")}>
        <div>
          <p className="text-sm text-muted" role="status">Preview unavailable.</p>
          <button
            className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-3")}
            onClick={() => {
              setFailed(false);
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
    // Controlled VRDex asset routes are intentionally rendered as ordinary images.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      className={className}
      key={attempt}
      loading="lazy"
      onError={() => setFailed(true)}
      src={src}
    />
  );
}
