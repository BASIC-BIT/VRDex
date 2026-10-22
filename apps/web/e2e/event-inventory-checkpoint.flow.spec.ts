import { expect, test, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { manualPerformer } from "./event-performer-helpers";

const nav = (page: Page, step: string) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step, exact: true }).click();
test.use({ timezoneId: "UTC" });
for (const theme of ["light", "dark"] as const) test(`organizer real command checkpoint ${theme} @fixture`, async ({ page }, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15000);
  const child = spawn(process.execPath, ["--conditions=import", "--import", "tsx", "tests/backend/helpers/event-inventory-browser-bridge.ts"], { cwd: path.resolve("../.."), env: { ...process.env, FORCE_COLOR: undefined }, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  let stderr = "", sequence = 0;
  type Reply = { id?: number; ready?: boolean; ok: boolean; result: Record<string, unknown>; error?: { message: string } };
  const messages: Reply[] = [];
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  const pending = new Map<number, (reply: Reply) => void>();
  child.stderr.on("data", data => { stderr += String(data); });
  lines.on("line", line => { const reply = JSON.parse(line) as Reply; messages.push(reply); if (reply.id) pending.get(reply.id)?.(reply); });
  const rpc = (request: { type: string; name?: string; args?: Record<string, unknown> }) => new Promise<Reply>((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Backend timeout: ${JSON.stringify(request)} ${stderr}`)); }, 15000);
    pending.set(id, reply => { clearTimeout(timeout); pending.delete(id); resolve(reply); });
    child.stdin.write(JSON.stringify({ ...request, v: 1, id }) + "\n");
  });
  const snapshot = async () => { const reply = await rpc({ type: "snapshot" }); expect(reply.ok, JSON.stringify(reply.error)).toBe(true); return reply.result; };
  const open = (view = "inventory") => page.goto(`/playwright/event-workspace?view=${view}`);
  const capture = async (name: string) => {
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const directory = path.resolve("../../docs/testing/assets/organizer-workspace-2026-10-22");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${info.project.name}-${theme}-${name}.png`), fullPage: true, style: "nextjs-portal { display: none !important; }" });
  };
  try {
    await expect.poll(() => ({ ready: messages.some(message => message.ready), stderr }), { timeout: 15000 }).toEqual({ ready: true, stderr: "" });
    await page.exposeBinding("organizerCheckpoint", (_source, request) => rpc(request));
    await page.addInitScript(value => localStorage.setItem("vrdex-theme", value), theme);
    await page.emulateMedia({ colorScheme: theme });
    await open();
    await expect(page.getByRole("heading", { name: "My events", exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Load more", exact: true }).click();
    await expect(page.getByText("Checkpoint staff", { exact: true })).toBeVisible();
    await expect(page.getByText("Checkpoint intake", { exact: true })).toBeVisible();
    await expect(page.getByText("Other private draft", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Expired draft", { exact: true })).toHaveCount(0);
    await capture("inventory");
    const before = await snapshot();
    for (const kind of ["staff", "intake"] as const) {
      if (kind === "intake") await open();
      const href = kind === "staff" ? `${before.staffPath}/edit` : `/events/new?draft=${before.draftId}`;
      const continuation = page.locator(`a[href="${href}"]`);
      await expect(continuation).toHaveText("Continue");
      await continuation.click();
      await expect(page).toHaveURL(url => url.pathname === "/sign-in" && url.searchParams.get("returnTo") === href);
      // The child records live in convex-test, not the native Next service.
      // Assert real navigation above, then mount the real saved projection.
      await open(kind);
      await expect(page.getByLabel("Event title", { exact: true })).toHaveValue(`Checkpoint ${kind}`);
      await expect(page.getByRole("link", { name: "Account", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "My events", exact: true })).toHaveCount(1);
      await expect(page.getByLabel("Discord-ready event post")).toHaveCount(0);
      await nav(page, "Lineup");
      await manualPerformer(page.locator("[data-performer-field]").first(), `Saved ${kind} guest`);
      await page.locator("[data-lineup-row]").first().locator("summary").filter({ hasText: "Details" }).click();
      await page.getByLabel(kind === "staff" ? "Slot offset minutes" : "Slot 1 start", { exact: true }).fill(kind === "staff" ? "15" : "2027-10-25T20:15");
      await capture(`${kind}-continuation`);
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      await expect(page.locator("form[data-event-dirty]")).toHaveAttribute("data-event-dirty", "false");
      await open(kind);
      await nav(page, "Lineup");
      await expect(page.getByRole("textbox", { name: "Performer", exact: true }).first()).toHaveValue(`Saved ${kind} guest`);
      await page.locator("[data-lineup-row]").first().locator("summary").filter({ hasText: "Details" }).click();
      await expect(page.getByLabel(kind === "staff" ? "Slot offset minutes" : "Slot 1 start", { exact: true })).toHaveValue(kind === "staff" ? "15" : "2027-10-25T20:15");
      await nav(page, "Review");
      await page.getByRole("button", { name: kind === "staff" ? "Save and publish" : "Publish event", exact: true }).click();
      await expect(page).toHaveURL(/\/checkpoint-club\/events\//, { timeout: 15000 });
      const saved = await snapshot();
      const event = saved[kind === "staff" ? "staffPublic" : "intakePublic"] as { title: string; slug: string };
      expect(event.title).toBe(`Checkpoint ${kind}`);
      expect(new URL(page.url()).pathname).toBe(`/checkpoint-club/events/${event.slug}`);
      await open(`${kind}-public`);
      await expect(page.getByRole("heading", { name: event.title, exact: true })).toBeVisible();
      await expect(page.getByText(`Saved ${kind} guest`, { exact: true }).first()).toBeVisible();
      await capture(`${kind}-public`);
    }
    await open("staff");
    await nav(page, "Lineup");
    await manualPerformer(page.locator("[data-performer-field]").first(), "Revised staff guest");
    await nav(page, "Review");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page).toHaveURL(/\/checkpoint-club\/events\//, { timeout: 15000 });
    await open("staff");
    await expect(page.getByLabel("Discord-ready event post")).toContainText("Revised staff guest");
    await expect(page.getByLabel("Discord-ready event post")).toContainText(`<t:${Date.UTC(2027, 9, 24, 20, 15) / 1000}:t>`);
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await capture("published-revision");
    const finished = await rpc({ type: "finish" });
    expect(finished.ok, JSON.stringify(finished.error)).toBe(true);
    expect(finished.result.negatives).toHaveLength(4);
    expect(browserErrors).toEqual([]);
    await info.attach("real-backend-transcript", { body: JSON.stringify(messages, null, 2), contentType: "application/json" });
  } finally {
    await info.attach("checkpoint-debug", { body: JSON.stringify({ messages, browserErrors }, null, 2), contentType: "application/json" });
    await info.attach("backend-stderr", { body: stderr, contentType: "text/plain" });
    lines.close(); child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
});
