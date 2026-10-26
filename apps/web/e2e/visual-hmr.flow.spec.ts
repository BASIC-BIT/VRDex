import { expect, test } from "@playwright/test";

import { prepareVisualPage } from "./public-routes";

test("visual preparation isolates local Next HMR while preserving application sockets @flow @fixture", async ({ page }) => {
  const forwarded: string[] = [];
  // Stand in for remote servers at the transport boundary. Routes registered
  // by prepareVisualPage take precedence over this earlier catch-all.
  await page.routeWebSocket(/.*/, (socket) => {
    forwarded.push(socket.url());
    socket.onMessage((message) => socket.send(message));
  });
  await prepareVisualPage(page);
  await page.route("http://127.0.0.1:3002/visual-transport-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Transport fixture</title>" }));
  await page.goto("http://127.0.0.1:3002/visual-transport-fixture");

  const hmrUrls = [
    "ws://127.0.0.1:3002/_next/webpack-hmr?id=one",
    "ws://localhost:3002/_next/webpack-hmr",
    "ws://[::1]:3002/_next/webpack-hmr?id=two",
  ];
  const applicationUrls = [
    "ws://127.0.0.1:3210/api/sync",
    "ws://localhost:3002/_next/webpack-hmr-other",
    "wss://vrdex.example/_next/webpack-hmr",
  ];
  await page.evaluate(async (urls) => {
    await Promise.all(urls.map((url) => new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.onopen = () => { socket.send("probe"); resolve(); };
      socket.onerror = () => reject(new Error(`Could not open ${url}`));
    })));
  }, hmrUrls);
  const echoes = await page.evaluate(async (urls) => {
    return Promise.all(urls.map((url) => new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.onopen = () => socket.send("application message");
      socket.onmessage = (event) => { socket.close(); resolve(String(event.data)); };
      socket.onerror = () => reject(new Error(`Could not open ${url}`));
    })));
  }, applicationUrls);

  expect(echoes).toEqual(applicationUrls.map(() => "application message"));
  expect(forwarded.sort()).toEqual([...applicationUrls].sort());
});
