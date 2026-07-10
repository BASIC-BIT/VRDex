import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export function TableFrame({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("overflow-x-auto rounded-control border border-border bg-surface", className)} {...props} />;
}

export function Table({ className, ...props }: ComponentPropsWithoutRef<"table">) {
  return <table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentPropsWithoutRef<"thead">) {
  return <thead className={cn("border-b border-border bg-surface-muted text-xs uppercase tracking-[0.18em] text-muted", className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentPropsWithoutRef<"td">) {
  return <td className={cn("px-4 py-3", className)} {...props} />;
}

export function TableHeaderCell({ className, ...props }: ComponentPropsWithoutRef<"th">) {
  return <th className={cn("px-4 py-3 font-medium", className)} {...props} />;
}
