"use client";

import { useState } from "react";

import { SignOutControl } from "../../account/sign-out-control";
import { Card } from "@/components/ui/card";
import { PageContainer, PageShell } from "@/components/ui/page-shell";

export function SignOutPreview({ shouldFail }: { shouldFail: boolean }) {
  const [attempts, setAttempts] = useState(0);
  const [signedOut, setSignedOut] = useState(false);

  async function signOut() {
    setAttempts((current) => current + 1);
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (shouldFail) {
      throw new Error("Fixture sign-out failure");
    }

    setSignedOut(true);
  }

  return (
    <PageShell>
      <PageContainer className="py-8" max="3xl">
        <Card>
          <h1 className="text-2xl font-semibold">Account</h1>
          <div className="mt-5">
            {signedOut ? <p role="status">Signed out</p> : <SignOutControl signOut={signOut} />}
          </div>
          <output className="mt-4 block text-sm text-muted" aria-label="Sign-out attempts">
            Attempts: {attempts}
          </output>
        </Card>
      </PageContainer>
    </PageShell>
  );
}
