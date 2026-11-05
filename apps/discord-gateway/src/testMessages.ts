import type { RelayableMessage } from "./relay";

export const flyer = { url: "https://cdn.discordapp.com/attachments/1/2/flyer.png", contentType: "image/png", size: 1234 };
export const notes = { url: "https://cdn.discordapp.com/attachments/1/2/notes.txt", contentType: "text/plain", size: 10 };

export const message = (over: Partial<RelayableMessage> = {}): RelayableMessage => ({
  id: "300000000000000001", system: false, content: "Friday 9pm", createdTimestamp: 1_700_000_000_000, editedTimestamp: null,
  author: { id: "200000000000000001", bot: false, username: "ari", globalName: "Ari" }, member: { displayName: "Ari B" },
  attachments: new Map([["1", flyer], ["2", notes]]), ...over,
});
