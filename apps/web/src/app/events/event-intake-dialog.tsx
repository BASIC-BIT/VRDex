"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function EventIntakeDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} className="ph-no-capture fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-panel border border-border bg-background p-5 text-foreground backdrop:bg-black/60 sm:p-6" data-ph-no-capture>
    <div className="mb-5 flex items-center justify-between gap-4"><h2 id={titleId} className="text-xl font-semibold">Import event info</h2><Button type="button" variant="ghost" onClick={onClose} className="min-h-11">Close</Button></div>
    {children}
  </dialog>;
}
