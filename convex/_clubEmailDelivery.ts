/** Every message is claimed immediately before its single transport attempt. */
export async function drainClubEmail<Message>({
  claim,
  send,
  finish,
}: {
  claim: () => Promise<Message | null>;
  send: (message: Message) => Promise<unknown>;
  finish: (message: Message, sent: boolean) => Promise<unknown>;
}): Promise<number> {
  let sentCount = 0;
  for (let index = 0; index < 20; index++) {
    const message = await claim();
    if (!message) break;
    let sent = false;
    try {
      await send(message);
      sent = true;
      sentCount++;
    } catch {
      // Transport uncertainty remains terminal; do not replay this message.
    }
    try {
      await finish(message, sent);
    } catch {
      // The durable submitted claim excludes replay and expires to indeterminate.
      // Continue with other messages even when this acknowledgement is unavailable.
    }
  }
  return sentCount;
}
