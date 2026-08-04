import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react";

import { cn } from "@/lib/cn";

const fieldControlClassName =
  "rounded-control border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent focus-visible:ring-2 focus-visible:ring-focus";

export function Field({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn("grid gap-2 text-sm font-medium", className)}>{children}</label>;
}

export function FieldText({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return <span className={cn("text-xs leading-5 text-muted", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return <input className={cn(fieldControlClassName, className)} {...props} />;
}

// `ref` added explicitly rather than by switching to `ComponentProps`, which
// resolves `onChange` differently and loses event inference at every other call
// site. React 19 passes `ref` as an ordinary prop; the profile switcher needs
// one so focus can be moved to it when the profile it names disappears.
export function Select({
  className,
  ...props
}: ComponentPropsWithoutRef<"select"> & { ref?: Ref<HTMLSelectElement> }) {
  return <select className={cn(fieldControlClassName, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<"textarea">) {
  return <textarea className={cn(fieldControlClassName, className)} {...props} />;
}
