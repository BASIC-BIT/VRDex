import { reportEventRequest } from "@/lib/server/event-intake-api";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  return reportEventRequest(request, (await context.params).slug);
}
