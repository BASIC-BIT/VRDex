"use client";

import { cn } from "@/lib/cn";
import { usePreferenceSelectionPop } from "./use-preference-selection-pop";
import styles from "./preference-controls.module.css";

export type FavoriteButtonProps = {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  size?: "default" | "compact";
  className?: string;
};

export function FavoriteButton({ label, pressed, onToggle, size = "default", className }: FavoriteButtonProps) {
  const { iconRef, onClick, onAnimationEnd } = usePreferenceSelectionPop(pressed, onToggle);
  const name = `${pressed ? "Remove favorite" : "Favorite"}: ${label}`;
  return (
    <button type="button" aria-label={name} title={name} aria-pressed={pressed}
      className={cn(styles.control, styles.favorite, size === "compact" && styles.compact, className)} onClick={onClick}>
      <svg ref={iconRef} onAnimationEnd={onAnimationEnd} viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
        <path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91Z" />
      </svg>
    </button>
  );
}
