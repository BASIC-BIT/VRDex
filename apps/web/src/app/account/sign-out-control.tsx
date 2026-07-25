"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type SignOutControlProps = {
  signOut: () => Promise<void>;
};

export function SignOutControl({ signOut }: SignOutControlProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestPendingRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (isOpen && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-dialog-cancel]")?.focus();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  function openDialog() {
    setError(null);
    setIsOpen(true);
  }

  function closeDialog() {
    if (!requestPendingRef.current) {
      setIsOpen(false);
    }
  }

  async function confirmSignOut() {
    if (requestPendingRef.current) {
      return;
    }

    requestPendingRef.current = true;
    setError(null);
    setIsPending(true);

    try {
      await signOut();
      setIsOpen(false);
    } catch {
      setError("We couldn’t sign you out. Try again.");
    } finally {
      requestPendingRef.current = false;
      setIsPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="dangerGhost" onClick={openDialog}>
        Sign out
      </Button>
      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-panel border border-border bg-surface-strong p-0 text-foreground shadow-panel backdrop:bg-black/65 backdrop:backdrop-blur-sm"
        ref={dialogRef}
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClose={() => setIsOpen(false)}
      >
        <div className="p-5 sm:p-6">
          <h2 className="text-xl font-semibold" id={titleId}>
            Sign out?
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted" id={descriptionId}>
            This signs the current session out.
          </p>
          {error ? (
            <p className="mt-4 text-sm text-danger-strong" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              className="w-full sm:w-auto"
              data-dialog-cancel
              disabled={isPending}
              type="button"
              variant="secondary"
              onClick={closeDialog}
            >
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto"
              disabled={isPending}
              type="button"
              variant="danger"
              onClick={() => void confirmSignOut()}
            >
              {isPending ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function AccountSignOutControl() {
  const { signOut } = useAuthActions();

  return <SignOutControl signOut={signOut} />;
}
