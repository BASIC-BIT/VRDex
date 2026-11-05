import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import type { Id } from "../../convex/_generated/dataModel";
import { newClerkUserId } from "./_clerkTestIdentity";
import { AUTHOR_A, AUTHOR_B, M1, M2, message, record, seedDiscordIntake } from "./helpers/discord-intake";

type T = Awaited<ReturnType<typeof seedDiscordIntake>>["t"];

beforeEach(test => test.mock.timers.enable({ apis: ["setTimeout"] }));
const runs = (t: T) => t.run(ctx => ctx.db.query("discordIntakeRuns").collect());
const jobs = (t: T) => t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
const finishRuns = (t: T) => t.run(async ctx => {
  for (const run of await ctx.db.query("discordIntakeRuns").collect()) await ctx.db.patch(run._id, { state: "done", finishedAt: Date.now() });
});
const flyer = (url = "https://cdn.discordapp.com/attachments/1/2/flyer.png?ex=1&is=2&hm=3") => ({ url, contentType: "image/png", byteLength: 1_000 });

it("debounces one author's posts into one pending run and reschedules the quiet window", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  await record(t, "create", message(M2));
  const [run] = await runs(t);
  assert.equal((await runs(t)).length, 1);
  const scheduled = await jobs(t);
  assert.deepEqual(scheduled.map(job => job.state.kind).sort(), ["canceled", "pending"]);
  const pending = scheduled.find(job => job.state.kind === "pending")!;
  assert.equal(pending._id, run.scheduledFunctionId);
  assert.ok(Math.abs(pending.scheduledTime - (Date.now() + 120_000)) < 5_000);
});

it("clamps the quiet window to 30..600 seconds", async () => {
  for (const [configured, expected] of [[5, 30_000], [900, 600_000]] as const) {
    const { t } = await seedDiscordIntake({ quietWindowSeconds: configured });
    await record(t, "create", message(M1));
    const [job] = await jobs(t);
    assert.ok(Math.abs(job.scheduledTime - (Date.now() + expected)) < 5_000);
  }
});

it("accumulates creates, edits and deletes into one trigger set without duplicates", async () => {
  const { t } = await seedDiscordIntake();
  const createdAt = Date.now();
  await record(t, "create", message(M1, { createdAt }));
  await record(t, "update", message(M1, { createdAt, content: "edited", editedAt: createdAt + 1_000 }));
  await record(t, "create", message(M2));
  await record(t, "create", message(M1, { createdAt, content: "edited", editedAt: createdAt + 1_000 }));
  await record(t, "delete", { messageId: M2 });
  const [run] = await runs(t);
  assert.deepEqual(run.triggerMessageIds, [M1, M2]);
  const rows = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.messageId === M1)!.content, "edited");
  assert.ok(rows.find(row => row.messageId === M2)!.deletedAt);
});

it("links the author to a VRDex user only when exactly one user verified that Discord ID", async () => {
  const { t, authorityUserId } = await seedDiscordIntake();
  const watermark = (userId: Id<"users">) => t.run(ctx => ctx.db.insert("discordVerificationWatermarks", { userId, discordUserId: AUTHOR_A, issuedGeneration: 1, appliedGeneration: 1, appliedAt: Date.now(), issuedAt: Date.now(), updatedAt: Date.now() }));
  await watermark(authorityUserId);
  await record(t, "create", message(M1));
  const other = await t.run(ctx => ctx.db.insert("users", { clerkUserId: newClerkUserId() }));
  await watermark(other);
  await record(t, "create", message(M2));
  const rows = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  assert.equal(rows.find(row => row.messageId === M1)!.authorUserId, authorityUserId);
  assert.equal(rows.find(row => row.messageId === M2)!.authorUserId, undefined);
});

it("keys pending runs by author", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1, { authorId: AUTHOR_A }));
  await record(t, "create", message(M2, { authorId: AUTHOR_B }));
  assert.deepEqual((await runs(t)).map(run => run.authorId).sort(), [AUTHOR_A, AUTHOR_B]);
});

it("ignores edits and deletes of messages posted before the connector existed", async () => {
  const { t, connectorId } = await seedDiscordIntake();
  const connector = await t.run(ctx => ctx.db.get(connectorId));
  await record(t, "update", message(M1, { createdAt: connector!.createdAt - 1, editedAt: Date.now() }));
  await record(t, "delete", { messageId: M2 });
  assert.equal((await t.run(ctx => ctx.db.query("discordIntakeMessages").collect())).length, 0);
  assert.equal((await runs(t)).length, 0);
});

it("drops bot messages and attachments off the Discord CDN", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1, { isBot: true }));
  await record(t, "create", message(M2, { attachments: [
    { url: "https://evil.example/a.png", contentType: "image/png", byteLength: 10 },
    { url: "https://cdn.discordapp.com/attachments/1/2/a.png", contentType: "image/png", byteLength: 1_000 },
  ] }));
  const rows = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  assert.deepEqual(rows.map(row => row.messageId), [M2]);
  assert.deepEqual(rows[0].attachments.map(item => item.byteLength), [1_000]);
});

it("records messages but schedules nothing while the connector is paused", async () => {
  const { t } = await seedDiscordIntake({ state: "paused" });
  await record(t, "create", message(M1));
  assert.equal((await t.run(ctx => ctx.db.query("discordIntakeMessages").collect())).length, 1);
  assert.equal((await runs(t)).length, 0);
});

it("truncates stored content to 12,000 characters", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1, { content: "a".repeat(12_500) }));
  const [row] = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  assert.equal(row.content.length, 12_000);
});

it("starts no run for an identical update or redelivered create after a run finished", async () => {
  const { t } = await seedDiscordIntake();
  const post = message(M1, { attachments: [flyer()] });
  await record(t, "create", post);
  await finishRuns(t);
  const [row] = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  const scheduled = (await jobs(t)).length;
  await record(t, "update", post);
  await record(t, "create", post);
  assert.equal((await runs(t)).length, 1);
  assert.equal((await jobs(t)).length, scheduled);
  assert.deepEqual(await t.run(ctx => ctx.db.query("discordIntakeMessages").collect()), [row]);
});

it("does not extend a pending quiet window for an unfurl or a pin", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  const scheduled = await jobs(t);
  await record(t, "update", message(M1));
  assert.deepEqual(await jobs(t), scheduled);
});

it("compares what the row stored, not the raw payload", async () => {
  const { t } = await seedDiscordIntake();
  const offCdn = { url: "https://evil.example/a.png", contentType: "image/png", byteLength: 10 };
  const long = "x".repeat(12_000);
  await record(t, "create", message(M1, { content: long, attachments: [flyer()] }));
  await finishRuns(t);
  await record(t, "update", message(M1, { content: `${long}more`, attachments: [flyer(), offCdn] }));
  assert.equal((await runs(t)).length, 1);
});

it("treats a re-signed CDN link to the same attachment as unchanged", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1, { attachments: [flyer()] }));
  await finishRuns(t);
  await record(t, "update", message(M1, { attachments: [flyer("https://cdn.discordapp.com/attachments/1/2/flyer.png?ex=4&is=5&hm=6")] }));
  assert.equal((await runs(t)).length, 1);
});

it("starts a new run when content or attachments changed after a run finished", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1, { attachments: [flyer()] }));
  await finishRuns(t);
  await record(t, "update", message(M1, { content: "moved to 10pm", attachments: [flyer()] }));
  assert.equal((await runs(t)).length, 2);
  await finishRuns(t);
  await record(t, "update", message(M1, { content: "moved to 10pm", attachments: [flyer("https://cdn.discordapp.com/attachments/1/3/new.png")] }));
  assert.equal((await runs(t)).length, 3);
  await finishRuns(t);
  await record(t, "update", message(M1, { content: "moved to 10pm", attachments: [] }));
  assert.equal((await runs(t)).length, 4);
});

it("clears a deleted post's text and images, and a redelivered copy does not bring them back", async () => {
  const { t } = await seedDiscordIntake();
  const post = message(M1, { attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/f.png", contentType: "image/png", byteLength: 10 }] });
  await record(t, "create", post);
  await record(t, "delete", { messageId: M1 });
  assert.deepEqual(await record(t, "create", post), { recorded: 0 });
  const [row] = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  assert.deepEqual({ content: row.content, attachments: row.attachments, deleted: row.deletedAt !== undefined }, { content: "", attachments: [], deleted: true });
});

it("schedules nothing for a repeat delete", async () => {
  const { t } = await seedDiscordIntake();
  await record(t, "create", message(M1));
  await record(t, "delete", { messageId: M1 });
  await finishRuns(t);
  const scheduled = (await jobs(t)).length;
  const [row] = await t.run(ctx => ctx.db.query("discordIntakeMessages").collect());
  await record(t, "delete", { messageId: M1 });
  assert.equal((await runs(t)).length, 1);
  assert.equal((await jobs(t)).length, scheduled);
  assert.deepEqual(await t.run(ctx => ctx.db.query("discordIntakeMessages").collect()), [row]);
});
