"use client";
import { Fragment, type ReactNode } from "react";
import { CalendarDays, Music2, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export type EventEditorStep = "Details" | "Lineup" | "Review";
const icons = { Details: CalendarDays, Lineup: Music2, Review: ClipboardCheck };
export function EventEditorSteps({ steps, activeStep, onSelect, children, preview, heading, actions }: {
  steps: readonly EventEditorStep[]; activeStep: EventEditorStep; onSelect: (step: EventEditorStep) => void; children: ReactNode; preview?: ReactNode; heading?: ReactNode; actions?: ReactNode;
}) {
  return <div className="grid min-w-0 gap-6">
    {heading || actions ? <div className="flex flex-wrap items-center justify-between gap-4">{heading}{actions}</div> : null}
    {steps.length ? <nav aria-label="Event editor" className="flex items-center border-b border-border pb-4">
      {steps.map((step, index) => {
        const Icon = icons[step];
        return <Fragment key={step}>
          {index > 0 ? <span aria-hidden="true" className="h-px w-3 shrink-0 bg-border sm:w-8" /> : null}
          <Button type="button" variant="ghost" aria-current={activeStep === step ? "step" : undefined} onClick={() => onSelect(step)} className={`min-h-11 min-w-0 flex-1 flex-col gap-1 px-1 sm:flex-row sm:gap-2 sm:px-4 ${activeStep === step ? "bg-accent/10" : "text-muted"}`}><Icon aria-hidden="true" className={`size-5 shrink-0 ${activeStep === step ? "text-accent" : "text-muted"}`} />{step}</Button>
        </Fragment>;
      })}
    </nav> : null}
    <div className={preview ? "grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]" : "min-w-0"}>
      <div className="min-w-0">{children}</div>
      {preview ? <aside aria-label="Event preview" className="grid min-w-0 gap-4 border-t border-border pt-6 lg:sticky lg:top-24 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">{preview}</aside> : null}
    </div>
  </div>;
}
