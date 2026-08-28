"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";

import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

const statusLabel = {
  upload_pending: "Upload pending",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
} as const;

export function MediaContributionsPanel() {
  const submissions = useQuery(api.profileMediaSubmissions.listMine);
  const withdraw = useMutation(api.profileMediaSubmissions.withdraw);

  return (
    <main className="grid gap-6">
      <SectionTitle>Media contributions</SectionTitle>
      {submissions === undefined ? <p aria-busy="true" className="text-sm text-muted">Loading…</p> : null}
      <div className="grid gap-4">
        {submissions?.map((submission) => (
          <Card key={submission.submissionId}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                {submission.profileIsPublic ? (
                  <Link className="text-lg font-semibold hover:underline" href={`/${submission.profileSlug}`}>
                    {submission.profileDisplayName}
                  </Link>
                ) : <p className="text-lg font-semibold">{submission.profileDisplayName}</p>}
                <p className="mt-1 text-sm text-muted">{statusLabel[submission.status]}</p>
              </div>
              {submission.status === "upload_pending" ||
              submission.status === "submitted" ||
              submission.status === "under_review" ? (
                <Button
                  onClick={() => void withdraw({ submissionId: submission.submissionId })}
                  type="button"
                  variant="ghost"
                >
                  Withdraw
                </Button>
              ) : null}
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Requested use</dt><dd>{submission.requestedPlacement === "profile_image" ? "Profile image" : "Primary logo"}</dd></div>
              <div><dt className="text-muted">Credit</dt><dd>{submission.credit}</dd></div>
            </dl>
            {submission.publicDisposition ? (
              <Notice className="mt-5" variant={submission.status === "rejected" ? "warning" : "info"}>
                {submission.publicDisposition}
              </Notice>
            ) : null}
          </Card>
        ))}
      </div>
    </main>
  );
}
