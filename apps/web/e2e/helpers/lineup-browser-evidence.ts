import type { Browser, Page, TestInfo } from "@playwright/test";

const recordings = new WeakMap<Browser, { page: Page; events: unknown[]; ownsTrace: boolean }>();

// These suites launch their own engine, so the runner's default-page trace does
// not contain their media requests or DOM. Capture the actual playback context.
export async function lineupEvidencePage(browser: Browser, info: TestInfo) {
  const configuredTrace = info.project.use.trace;
  const traceMode = typeof configuredTrace === "object" ? configuredTrace.mode : configuredTrace;
  const runnerTracing = traceMode === "on" || traceMode === "retain-on-failure" ||
    (traceMode === "on-first-retry" && info.retry === 1) ||
    (traceMode === "on-all-retries" && info.retry > 0) ||
    (traceMode === "retain-on-first-failure" && info.retry === 0);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // Playwright also instruments manually created contexts on configured attempts.
  // Borrow a chunk there; only stop the session when this helper started it.
  if (runnerTracing) await page.context().tracing.startChunk({ title: "Actual lineup playback" });
  else await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  await page.addInitScript(() => {
    const contexts: AudioContext[] = [];
    const events: unknown[] = [];
    const record = (event: unknown) => { events.push({ at: performance.now(), detail: event }); if (events.length > 100) events.shift(); };
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      if (!contexts.includes(this)) {
        contexts.push(this);
        this.addEventListener("statechange", () => record({ type: "statechange", state: this.state, time: this.currentTime }));
      }
      record({ type: "resume", state: this.state, time: this.currentTime, active: navigator.userActivation.isActive, activated: navigator.userActivation.hasBeenActive });
      const result = resume.call(this);
      void result.then(() => record({ type: "resumed", state: this.state, time: this.currentTime }), error => record({ type: "resume-error", message: String(error) }));
      return result;
    };
    document.addEventListener("click", event => record({ type: "click", trusted: event.isTrusted, active: navigator.userActivation.isActive }), true);
    Object.assign(window, { lineupContextEvidence: { contexts, events } });
  });
  const events: unknown[] = [];
  const record = (entry: unknown) => {
    events.push(entry);
    if (events.length > 200) events.shift();
  };
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) record({ type: "console", text: message.text() });
  });
  page.on("pageerror", error => record({ type: "pageerror", message: error.message }));
  page.on("requestfailed", request => record({ type: "requestfailed", url: request.url(), error: request.failure()?.errorText }));
  page.on("response", response => {
    if (response.url().includes(".live.ts")) record({ type: "media-response", url: response.url(), status: response.status() });
  });
  recordings.set(browser, { page, events, ownsTrace: !runnerTracing });
  return page;
}

export async function attachLineupEvidence(browser: Browser | undefined, info: TestInfo) {
  if (!browser) return;
  const recording = recordings.get(browser);
  if (!recording) return;
  const { page, events, ownsTrace } = recording;
  try {
    const state = await page.evaluate(() => ({
      url: location.href,
      visibility: document.visibilityState,
      capabilities: {
        mseH264Aac: typeof MediaSource !== "undefined" && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"'),
        nativeHls: document.createElement("video").canPlayType("application/vnd.apple.mpegurl"),
        audioContext: typeof AudioContext,
      },
      lineup: Array.from(document.querySelectorAll("[data-current]")).map(node => ({ current: node.getAttribute("data-current"), following: node.getAttribute("data-following"), text: node.textContent })),
      media: Array.from(document.querySelectorAll("video,audio")).map(node => {
        const media = node as HTMLMediaElement;
        return { src: media.currentSrc, assignedSrc: media.getAttribute("src"), time: media.currentTime, paused: media.paused, readyState: media.readyState, networkState: media.networkState, hidden: media.hidden, error: media.error && { code: media.error.code, message: media.error.message } };
      }),
      contextEvidence: (() => {
        const evidence = (window as unknown as { lineupContextEvidence?: { contexts: AudioContext[]; events: unknown[] } }).lineupContextEvidence;
        return evidence && { events: evidence.events, contexts: evidence.contexts.map(context => ({ state: context.state, time: context.currentTime, sampleRate: context.sampleRate, baseLatency: context.baseLatency, maxChannelCount: context.destination.maxChannelCount })) };
      })(),
      observedContexts: (window as unknown as { lineupAudio?: { contexts: AudioContext[] } }).lineupAudio?.contexts.map(context => ({ state: context.state, time: context.currentTime, sampleRate: context.sampleRate })),
    }));
    await info.attach("actual-lineup-browser-state", { body: JSON.stringify({ browser: browser.version(), state, events }), contentType: "application/json" });
    if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") {
      await info.attach("actual-lineup-browser", { body: await page.screenshot(), contentType: "image/png" });
    }
  } finally {
    const trace = info.outputPath("actual-lineup-browser-trace.zip");
    if (ownsTrace) await page.context().tracing.stop({ path: trace });
    else await page.context().tracing.stopChunk({ path: trace });
    await info.attach("actual-lineup-browser-trace", { path: trace, contentType: "application/zip" });
  }
}
