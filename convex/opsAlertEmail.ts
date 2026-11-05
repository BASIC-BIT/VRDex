"use node";
import type { SendEmailCommandInput, SESClient } from "@aws-sdk/client-ses";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

type OpsAlertMessage = { to: string; subject: string; body: string };

export const opsAlertEmailInput = (message: OpsAlertMessage, from: string): SendEmailCommandInput => ({
  Source: from,
  Destination: { ToAddresses: [message.to] },
  Message: { Subject: { Data: message.subject, Charset: "UTF-8" }, Body: { Text: { Data: message.body, Charset: "UTF-8" } } },
});

// The SDK loads lazily: the backend test runner (tsx with --conditions=import) cannot load @aws-sdk/client-ses.
export async function deliverOpsAlert(message: OpsAlertMessage, client: Pick<SESClient, "send">, from: string): Promise<void> {
  const { SendEmailCommand } = await import("@aws-sdk/client-ses");
  await client.send(new SendEmailCommand(opsAlertEmailInput(message, from)));
}

// Throws on missing SES settings so a lost alert shows in the Convex logs.
export const send = internalAction({
  args: { to: v.string(), subject: v.string(), body: v.string() },
  returns: v.null(),
  handler: async (_ctx, message): Promise<null> => {
    const region = process.env.AWS_SES_REGION;
    const from = process.env.AWS_SES_FROM_EMAIL;
    if (!region || !from) throw new Error("Ops alert email needs AWS_SES_REGION and AWS_SES_FROM_EMAIL.");
    const { SESClient } = await import("@aws-sdk/client-ses");
    await deliverOpsAlert(message, new SESClient({ region, maxAttempts: 1 }), from);
    return null;
  },
});
