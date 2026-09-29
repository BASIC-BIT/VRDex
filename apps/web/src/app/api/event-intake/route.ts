import { createWebsiteEventIntakeHandler } from "@/lib/server/event-intake-session";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = createWebsiteEventIntakeHandler();
