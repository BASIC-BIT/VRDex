import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

test("same editor submission publishes, discovers, renders and serializes the authored event", async ({ page }, info) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const child = spawn(process.execPath, ["--conditions=import", "--import", "tsx", "tests/backend/helpers/event-lineup-browser-bridge.ts"], { cwd: path.resolve("../.."), env: { ...process.env, FORCE_COLOR: undefined }, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", data => { stderr += String(data); });
  const messages: Array<Record<string, unknown>> = [];
  lines.on("line", line => messages.push(JSON.parse(line)));
  try {
    await expect.poll(() => messages.length, { message: "backend editable bootstrap" }).toBe(1);
    const editable = messages[0].editable;
    await page.addInitScript(value => { localStorage.setItem("event-lineup-fixture-v1", JSON.stringify(value)); }, editable);
    await page.goto("/playwright/event-lineup?editor");
    await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("Controlled lineup");
    await page.getByLabel("Event title", { exact: true }).fill("Edited controlled lineup");
    await page.getByLabel("Stream", { exact: true }).first().selectOption("controlled-next");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).not.toBeNull();
    const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
    expect(payload.slotLinks[0].selectedStreamId).toBe("controlled-next");
    child.stdin.write(JSON.stringify(payload) + "\n");
    await expect.poll(() => ({ count: messages.length, error: stderr }), { timeout: 20000 }).toEqual({ count: 2, error: "" });
    const result = messages[1];
    expect(result.serialized).toBe(true);
    await info.attach("authored-public-projection", { body: JSON.stringify(result.event), contentType: "application/json" });
    await page.addInitScript(value => { localStorage.setItem("event-lineup-fixture-public", JSON.stringify(value)); }, result.event);
    const streams: string[] = [];
    await page.route("https://stream.vrcdn.live/**", async route => { streams.push(route.request().url()); await route.fulfill({ status: 503, body: "Controlled transport boundary" }); });
    await page.goto("/playwright/event-lineup");
    await expect(page.getByRole("heading", { name: "Edited controlled lineup", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Controlled set", exact: true })).toHaveAttribute("href", "/controlled-performer");
    await expect(page.getByText("rtspt://stream.vrcdn.live/live/controlled-next", { exact: true }).first()).toBeVisible();
    expect(streams).toEqual([]);
    await page.getByRole("button", { name: "Play Edited controlled lineup", exact: true }).click();
    await expect.poll(() => streams.some(url => url.includes("/controlled-next.live.ts"))).toBe(true);
    expect(streams.every(url => url.includes("/controlled-next.live.ts"))).toBe(true);
    await page.goto("about:blank");
  } finally {
    lines.close();
    if (child.exitCode === null) {
      const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
      child.kill();
      await closed;
    }
  }
});
