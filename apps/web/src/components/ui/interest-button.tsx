"use client";

import { cn } from "@/lib/cn";
import type { planSaveState } from "@/lib/timeline/plan-actions";
import { usePreferenceSelectionPop } from "./use-preference-selection-pop";
import styles from "./preference-controls.module.css";

export type InterestButtonProps = {
  label: string;
  state: ReturnType<typeof planSaveState>;
  onToggle: () => void;
  size?: "default" | "compact";
  className?: string;
};

export function InterestButton({ label, state, onToggle, size = "default", className }: InterestButtonProps) {
  const { iconRef, onClick, onAnimationEnd } = usePreferenceSelectionPop(state === "saved", onToggle);
  const title = state === "included" ? "Included with event" : state === "saved" ? "Remove interest" : "Interested";
  return (
    <button type="button" aria-label={`${title}: ${label}`} title={title} aria-pressed={state !== "unsaved"}
      disabled={state === "included"} data-state={state}
      className={cn(styles.control, styles.interest, size === "compact" && styles.compact, className)} onClick={onClick}>
      <svg ref={iconRef} onAnimationEnd={onAnimationEnd} viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
        <path data-glyph="plus" className={styles.plus} d="M12 5v14M5 12h14" />
        <path data-glyph="check" className={styles.check} d="m5 12 4.5 4.5L19 7" />
        <path data-glyph="remove" className={styles.remove} d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
  );
}
