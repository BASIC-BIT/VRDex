"use node";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { drainClubEmail } from "./_clubEmailDelivery";
export const deliver = internalAction({
  args: {},
  returns: v.object({ configured: v.boolean(), sent: v.number() }),
  handler: async (ctx): Promise<{ configured: boolean; sent: number }> => {
    if (process.env.VRDEX_CLUB_OPERATION_EMAIL_ENABLED !== "true")
      return { configured: false, sent: 0 };
    const sender = process.env.AWS_SES_FROM_EMAIL;
    const region = process.env.AWS_SES_REGION;
    const origin = process.env.VRDEX_SITE_URL;
    if (!sender || !region || !origin)
      throw new Error("Club operation email configuration is incomplete.");
    const url = new URL("/account", origin);
    if (url.protocol !== "https:")
      throw new Error("Club operation email requires an HTTPS site URL.");
    type Message = {
      id: Id<"clubOperationNotifications">;
      email: string;
      communitySlug: string;
    };
    const client = new SESClient({ region, maxAttempts: 1 });
    const sent = await drainClubEmail<Message>({
      claim: () => ctx.runMutation(internal.clubNotifications.claimEmail, {}),
      send: async (message) => {
        url.pathname = `/account/communities/${encodeURIComponent(message.communitySlug)}/scheduled`;
        await client.send(
          new SendEmailCommand({
            Source: sender,
            Destination: { ToAddresses: [message.email] },
            Message: {
              Subject: {
                Data: "VRDex action needs attention",
                Charset: "UTF-8",
              },
              Body: {
                Text: {
                  Data: `An action needs your attention. Sign in to review it: ${url.href}`,
                  Charset: "UTF-8",
                },
              },
            },
          }),
        );
      },
      finish: (message, sent) =>
        ctx.runMutation(internal.clubNotifications.finishEmail, {
          id: message.id,
          sent,
        }),
    });
    return { configured: true, sent };
  },
});
