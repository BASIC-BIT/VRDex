import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

const metadataListVariants = cva("flex flex-wrap items-center", {
  variants: {
    density: {
      compact: "gap-x-2 gap-y-1 text-caption",
      default: "gap-x-3 gap-y-1 text-body-sm",
    },
    tone: {
      default: "text-muted",
      subtle: "text-subtle",
    },
  },
  defaultVariants: {
    density: "default",
    tone: "default",
  },
});

export type MetadataListProps = ComponentPropsWithoutRef<"ul"> &
  VariantProps<typeof metadataListVariants>;

export function MetadataList({ className, density, tone, ...props }: MetadataListProps) {
  return (
    <ul
      className={cn(metadataListVariants({ density, tone }), className)}
      role="list"
      {...props}
    />
  );
}

export function MetadataItem({ className, ...props }: ComponentPropsWithoutRef<"li">) {
  return <li className={cn("min-w-0", className)} {...props} />;
}
