import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

export const cardVariants = cva("rounded-panel border", {
  variants: {
    surface: {
      default: "border-border bg-surface",
      strong: "border-border bg-surface-strong",
      white: "border-border bg-surface-strong shadow-sm",
      glass: "border-border bg-surface",
      dashed: "border-dashed border-border bg-surface",
      dark: "border-white/15 bg-white/14 text-white backdrop-blur",
    },
    padding: {
      none: "",
      sm: "px-4 py-4",
      md: "px-5 py-6 sm:px-6",
      lg: "px-6 py-8 sm:px-8",
    },
  },
  defaultVariants: {
    surface: "default",
    padding: "md",
  },
});

export type CardProps = ComponentPropsWithoutRef<"section"> & VariantProps<typeof cardVariants>;

export function Card({ className, padding, surface, ...props }: CardProps) {
  return <section className={cn(cardVariants({ padding, surface }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex flex-col gap-3", className)} {...props} />;
}

export function Eyebrow({ className, tone = "muted", ...props }: ComponentPropsWithoutRef<"p"> & { tone?: "muted" | "inverse" }) {
  return (
    <p
      className={cn(
        "font-mono text-xs uppercase tracking-[0.24em]",
        tone === "inverse" ? "text-white/70" : "text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function SectionTitle({ className, ...props }: ComponentPropsWithoutRef<"h2">) {
  return <h2 className={cn("text-3xl font-semibold tracking-[-0.04em]", className)} {...props} />;
}

export function SectionDescription({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("max-w-md text-sm leading-6 text-muted", className)} {...props} />;
}

export function SectionHeading({
  children,
  className,
  description,
  eyebrow,
}: {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col justify-between gap-3 sm:flex-row sm:items-end", className)}>
      <div>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <SectionTitle className={eyebrow ? "mt-3" : undefined}>{children}</SectionTitle>
      </div>
      {description ? <SectionDescription>{description}</SectionDescription> : null}
    </div>
  );
}
