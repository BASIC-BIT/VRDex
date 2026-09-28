"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export default function EventReportsPage() {
  const allowed = useQuery(api.eventCorrections.getEventReportAccess, {});
  const [cursor, setCursor] = useState<string | null>(null);
  const reports = useQuery(api.eventCorrections.listEventReports, allowed ? { cursor, limit: 25 } : "skip");
  return <PageShell className="py-10"><PageContainer max="3xl"><PageNav><BrandLink /></PageNav><h1 className="text-3xl font-semibold">Event reports</h1>
    {allowed === false ? <Notice>Staff only</Notice> : reports === undefined ? <p aria-busy="true">Loading…</p> : <div className="grid gap-4">{reports.page.map(report => <article className="rounded-control border border-border p-4" key={report._id}>{report.eventPath ? <Link className="font-semibold underline" href={report.eventPath}>{report.eventTitle}</Link> : <span>{report.eventTitle ?? "Event unavailable"}</span>}<p className="mt-2 whitespace-pre-wrap">{report.reason}</p><p className="mt-2 text-xs text-muted">{new Date(report.createdAt).toLocaleString()}</p></article>)}{reports.page.length === 0 ? <p>No reports</p> : null}<div className="flex gap-2">{cursor ? <Button variant="secondary" onClick={() => setCursor(null)}>Latest</Button> : null}{!reports.isDone ? <Button variant="secondary" onClick={() => setCursor(reports.continueCursor)}>Next</Button> : null}</div></div>}
  </PageContainer></PageShell>;
}
