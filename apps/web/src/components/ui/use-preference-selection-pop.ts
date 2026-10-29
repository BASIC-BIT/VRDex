"use client";

import { useLayoutEffect, useReducer, useRef } from "react";
import styles from "./preference-controls.module.css";

/** A local activation is consumed by its next commit, including a rejected update. */
export function usePreferenceSelectionPop(selected: boolean, onToggle: () => void) {
  const iconRef = useRef<SVGSVGElement>(null);
  const [activation, activate] = useReducer((value: number) => value + 1, 0);
  const previous = useRef({ selected, activation });
  useLayoutEffect(() => {
    const icon = iconRef.current;
    function clear() { icon?.classList.remove(styles.pop); }
    // Media changes can cancel an active animation without an animationend event.
    icon?.addEventListener("animationcancel", clear);
    return () => icon?.removeEventListener("animationcancel", clear);
  }, []);
  useLayoutEffect(() => {
    if (!selected) iconRef.current?.classList.remove(styles.pop);
    else if (!previous.current.selected && activation !== previous.current.activation &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      iconRef.current?.classList.add(styles.pop);
    }
    previous.current = { selected, activation };
  });
  return {
    iconRef,
    onClick() {
      activate();
      onToggle();
    },
    onAnimationEnd() {
      iconRef.current?.classList.remove(styles.pop);
    },
  };
}
