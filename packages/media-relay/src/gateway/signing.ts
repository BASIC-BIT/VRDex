import { createPrivateKey, sign } from "node:crypto";
import { RELAY_POLICY } from "../policy";

export type SignSegment = (args: {
  objectKey: string;
  expiresAt: number;
}) => string;
/** CloudFront canned policy. No grant/viewer token participates in the immutable resource URL. */
export function createSegmentSigner(options: {
  origin: string;
  keyPairId: string;
  privateKey: string;
  clock: () => number;
}): SignSegment {
  const origin = new URL(options.origin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !/^[A-Za-z0-9]+$/.test(options.keyPairId)
  )
    throw Error("Invalid signing configuration");
  const key = createPrivateKey(options.privateKey);
  if (
    key.asymmetricKeyType !== "rsa" ||
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw Error("Invalid signing key");
  return ({ objectKey, expiresAt }) => {
    if (
      !/^vrcdn\/[A-Za-z0-9_-]{2,128}\/1\/epochs\/[1-9][0-9]*\/attempt-[0-9]+-[A-Za-z0-9_-]+\/(video|audio)-[0-9]+\.ts$/.test(
        objectKey,
      ) ||
      !Number.isFinite(expiresAt) ||
      expiresAt - options.clock() < RELAY_POLICY.segmentUrlValidityMs
    )
      throw Error("Invalid segment signing request");
    const resource = new URL(objectKey, origin).href,
      expires = Math.ceil(expiresAt / 1000);
    const policy = JSON.stringify({
      Statement: [
        {
          Resource: resource,
          Condition: { DateLessThan: { "AWS:EpochTime": expires } },
        },
      ],
    });
    const signature = sign("RSA-SHA1", Buffer.from(policy), key)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/=/g, "_")
      .replace(/\//g, "~");
    return `${resource}?Expires=${expires}&Signature=${signature}&Key-Pair-Id=${options.keyPairId}`;
  };
}
