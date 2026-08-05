import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react";

import { cn } from "@/lib/cn";

// `pl-3.5` rather than `pl-4`: 16px sat far enough off the border to read as an
// indent. Shared by all three controls so a select and the input beside it still
// line up.
// `w-full min-w-0` is load-bearing, not decoration. A grid item defaults to
// `min-width: auto`, so a control wide enough at its intrinsic minimum — a
// select is as wide as its longest option, and these have sentence-length ones —
// sizes its track past the container instead of shrinking. On a phone that ran
// every field off the right edge of its card and under the edge of the screen.
const fieldControlClassName =
  "w-full min-w-0 rounded-control border border-border bg-surface-strong pl-3.5 pr-4 py-3 font-normal outline-none transition placeholder:text-muted/65 focus:border-accent focus-visible:ring-2 focus-visible:ring-focus";

export function Field({ children, className }: { children: ReactNode; className?: string }) {
  // Same reason: the label is itself the grid item in most of these layouts, so
  // it has to be allowed to shrink before the control inside it can.
  return (
    <label className={cn("grid min-w-0 gap-2 text-sm font-medium", className)}>{children}</label>
  );
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
  // Chrome insets its own dropdown arrow by `padding-right`, so the extra 4px is
  // what moves the pip off the border — the select's text still ends where an
  // input's would, since the arrow occupies that space anyway.
  return <select className={cn(fieldControlClassName, "pr-5", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<"textarea">) {
  return <textarea className={cn(fieldControlClassName, className)} {...props} />;
}
