"use node";

import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import {
  type DigestRequest,
  formatDigestBody,
  supportDigestConfig,
  supportDigestSubject,
} from "./_supportDigest";

/**
 * Spelled out rather than inferred. This action calls two functions that live in
 * the same `internal` graph it is itself a member of, so letting TypeScript
 * infer the handler's return type makes the graph reference itself and every
 * local binding in here collapses to `any`.
 */
type SupportDigestResult = {
  sent: number;
  marked?: number;
  configured: boolean;
};

/**
 * Mail the requests no digest has covered yet.
 *
 * A digest rather than one message per submission, because `/support` takes
 * anonymous requests and per-submission delivery would make it a spam amplifier
 * pointed at whoever reads this mailbox. Hourly caps that at one email no matter
 * what arrives, and an unread hour costs a request nothing.
 *
 * Sends before stamping. A failure between the two resends the same requests an
 * hour later, which costs a duplicate email; stamping first would lose a dispute
 * with nothing left to notice it happened.
 *
 * Everything here except the send itself lives in `_supportDigest.ts`, because
 * this module is `"use node"` and importing it drags the whole AWS SDK along.
 */
export const sendSupportDigest = internalAction({
  args: {},
  handler: async (ctx): Promise<SupportDigestResult> => {
    const config = supportDigestConfig(process.env);
    const requests: DigestRequest[] = await ctx.runQuery(
      internal.supportRequests.pendingDigestRequests,
      {},
    );

    if (config === null) {
      // Loud, and only when it matters. An unconfigured digest on a deployment
      // with nothing waiting is the ordinary state and says nothing. One with
      // requests waiting is the failure this whole feature exists to prevent,
      // happening quietly, once an hour, forever -- so it goes in the logs
      // where an operator checking why nobody has answered will find it.
      if (requests.length > 0) {
        console.warn(
          `${requests.length} support request(s) are waiting and VRDEX_SUPPORT_DIGEST_TO is not set, so none of them have reached anyone.`,
        );
      }

      return { sent: 0, configured: false };
    }

    if (requests.length === 0) {
      return { sent: 0, configured: true };
    }

    await new SESClient({ region: config.region }).send(
      new SendEmailCommand({
        Source: config.sender,
        Destination: { ToAddresses: [config.recipient] },
        Message: {
          Subject: { Data: supportDigestSubject(requests.length), Charset: "UTF-8" },
          Body: {
            Text: { Data: formatDigestBody(requests, config.siteUrl), Charset: "UTF-8" },
          },
        },
        // The sender, not the requester. Anything a stranger typed reaches this
        // mailbox, so a stray reply must land back on VRDex rather than on
        // whatever address an anonymous submission claimed to be.
        ReplyToAddresses: [config.sender],
      }),
    );

    const { marked }: { marked: number } = await ctx.runMutation(
      internal.supportRequests.markDigestSent,
      {
        supportRequestIds: requests
          .filter((request) => request.table === "supportRequests")
          .map((request) => request.id as Id<"supportRequests">),
        suppressionRequestIds: requests
          .filter((request) => request.table === "profileSuppressionRequests")
          .map((request) => request.id as Id<"profileSuppressionRequests">),
      },
    );

    return { sent: requests.length, marked, configured: true };
  },
});
