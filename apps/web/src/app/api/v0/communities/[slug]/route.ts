import { publicProfileReadResponse } from "@/lib/server/api-v0";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  return publicProfileReadResponse(request, { slug, profileType: "community" });
}
