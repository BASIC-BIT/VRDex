import type { ReactNode } from "react";
import { ClubWorkspace } from "../club-workspace";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ClubWorkspace communitySlug={slug}>{children}</ClubWorkspace>;
}
