"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";

export function ProfileAvatarImage({
  alt,
  fallback,
  src,
}: {
  alt: string;
  fallback: string;
  src?: string;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  const failed = failedSrc === src;
  const showImage = Boolean(src && !failed);

  return (
    <span aria-busy={showImage && !loaded} className="contents">
      {!loaded ? fallback : null}
      {showImage ? (
        // Controlled VRDex asset routes are intentionally rendered as ordinary images.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={alt}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0",
          )}
          fetchPriority="high"
          loading="eager"
          onError={() => setFailedSrc(src ?? null)}
          onLoad={() => setLoadedSrc(src ?? null)}
          src={src}
        />
      ) : null}
    </span>
  );
}
