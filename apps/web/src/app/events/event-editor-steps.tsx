"use client";
import type { ReactNode } from "react";
import { CalendarDays, Music2, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EditorSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="grid gap-5 border-b border-border pb-8">
      <h2 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h2>
      {children}
    </section>
  );
}

export type EventEditorStep = "Details" | "Lineup" | "Review";
const icons = { Details: CalendarDays, Lineup: Music2, Review: ClipboardCheck };
export function EventEditorSteps({ steps, activeStep, onSelect, children, preview, heading, actions }: {
  steps: readonly EventEditorStep[]; activeStep: EventEditorStep; onSelect: (step: EventEditorStep) => void; children: ReactNode; preview?: ReactNode; heading?: ReactNode; actions?: ReactNode;
}) {
  return <div className="grid min-w-0 gap-6">
    {heading || actions ? <div className="flex flex-wrap items-center justify-between gap-4">{heading}{actions}</div> : null}
    {steps.length ? <nav aria-label="Event editor" className="mx-auto grid w-full max-w-2xl grid-cols-3 pb-4">
      {steps.map((step, index) => {
        const Icon = icons[step];
        return <div key={step} className="relative min-w-0">
          {index > 0 ? <span aria-hidden="true" className="pointer-events-none absolute left-[calc(-50%+1.625rem)] right-[calc(50%+1.625rem)] top-[26px] h-px bg-border" /> : null}
          <Button type="button" variant="ghost" aria-current={activeStep === step ? "step" : undefined} onClick={() => onSelect(step)} className="min-h-11 min-w-11 w-full flex-col gap-3 px-1 py-1 hover:bg-transparent">
            <span className={`relative flex size-11 shrink-0 items-center justify-center rounded-full border ${activeStep === step ? "border-accent bg-accent text-inverse ring-4 ring-accent/10" : "border-border-strong bg-background text-muted"}`}><Icon aria-hidden="true" className="size-5" /></span>
            <span className={activeStep === step ? "text-foreground" : "text-muted"}>{step}</span>
          </Button>
        </div>;
      })}
    </nav> : null}
    <div className={preview ? "grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]" : "min-w-0"}>
      <div className="min-w-0">{children}</div>
      {preview ? <aside aria-label="Event preview" className="grid min-w-0 gap-4 border-t border-border pt-6 lg:sticky lg:top-24 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">{preview}</aside> : null}
    </div>
  </div>;
}
