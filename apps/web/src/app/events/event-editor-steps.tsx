"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export type EventEditorStep = "Source" | "Details" | "Lineup" | "Review";
export function EventEditorSteps({ steps, activeStep, onSelect, children, preview }: {
  steps: readonly EventEditorStep[]; activeStep: EventEditorStep; onSelect: (step: EventEditorStep) => void; children: ReactNode; preview?: ReactNode;
}) {
  return <div className="grid min-w-0 gap-6">
    {steps.length ? <nav aria-label="Event editor" className="grid grid-flow-col auto-cols-fr gap-1 border-b border-border pb-4 sm:gap-3">
      {steps.map((step, index) => <Button key={step} type="button" variant={activeStep === step ? "primary" : "secondary"} aria-current={activeStep === step ? "step" : undefined} onClick={() => onSelect(step)} className="min-w-0 gap-2 px-2 sm:px-4"><span aria-hidden="true" className="hidden sm:inline">{index + 1}. </span>{step}</Button>)}
    </nav> : null}
    <div className={preview ? "grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]" : "min-w-0"}>
      <div className="min-w-0">{children}</div>
      {preview ? <aside aria-label="Event preview" className="grid min-w-0 gap-4 border-t border-border pt-6 lg:sticky lg:top-24 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">{preview}</aside> : null}
    </div>
  </div>;
}
