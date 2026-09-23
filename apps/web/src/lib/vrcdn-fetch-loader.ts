import type Mpegts from "mpegts.js";

class FetchFailure extends Error {
  constructor(readonly kind: "HttpStatusCodeInvalid" | "EarlyEof", readonly code: number, message: string) { super(message); }
}

/** The supported mpegts custom-loader boundary owns every fetch/read/cancel promise. */
export class VrcdnFetchLoader implements Mpegts.BaseLoader {
  _status = 0;
  _needStash = true;
  readonly type = "vrdex-fetch-stream-loader";
  get status() { return this._status; }
  get needStashBuffer() { return this._needStash; }
  onContentLengthKnown: Mpegts.BaseLoader["onContentLengthKnown"] = () => {};
  onURLRedirect: Mpegts.BaseLoader["onURLRedirect"] = () => {};
  onDataArrival: Mpegts.BaseLoader["onDataArrival"] = () => {};
  onError: Mpegts.BaseLoader["onError"] = () => {};
  onComplete: Mpegts.BaseLoader["onComplete"] = () => {};
  private generation = 0;
  private controller?: AbortController;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  constructor(private seek: Mpegts.SeekHandler, private config: Mpegts.Config) {}
  isWorking() { return this._status === 1 || this._status === 2; }
  abort() {
    this.generation++;
    this.controller?.abort();
    // A canceled/errored reader may reject cancel. It is an owned cleanup promise.
    void this.reader?.cancel().catch(() => {});
    this._status = 0;
  }
  destroy() {
    this.abort();
    this.onContentLengthKnown = () => {};
    this.onURLRedirect = () => {};
    this.onDataArrival = () => {};
    this.onError = () => {};
    this.onComplete = () => {};
  }
  open(source: Mpegts.MediaSegment, range: Mpegts.Range) {
    this.abort();
    const generation = this.generation;
    const controller = this.controller = new AbortController();
    this._status = 1;
    void this.read(source, range, generation, controller).catch(error => {
      if (generation !== this.generation || controller.signal.aborted) return;
      this._status = 3;
      const kind = error instanceof FetchFailure ? error.kind : "Exception";
      const code = error instanceof FetchFailure ? error.code : -1;
      // mpegts 1.8.1 types this argument as the constants object, but emits strings.
      this.onError(kind as unknown as Mpegts.LoaderErrors, { code, msg: error instanceof Error ? error.message : String(error) });
    });
  }
  private async read(source: Mpegts.MediaSegment, range: Mpegts.Range, generation: number, controller: AbortController) {
    const active = () => generation === this.generation && !controller.signal.aborted;
    const data = source as Mpegts.MediaSegment & Partial<Mpegts.MediaDataSource> & { redirectedURL?: string; referrerPolicy?: ReferrerPolicy };
    const url = this.config.reuseRedirectedURL && data.redirectedURL ? data.redirectedURL : data.url;
    const request = this.seek.getConfig(url, range);
    const headers = request.headers instanceof Headers ? new Headers(request.headers)
      : new Headers(Object.fromEntries(Object.entries(request.headers ?? {}).map(([key, value]) => [key, String(value)])));
    for (const [key, value] of Object.entries(this.config.headers ?? {})) headers.append(key, value);
    const response = await fetch(request.url, { headers, signal: controller.signal,
      mode: data.cors === false ? "same-origin" : "cors", cache: "default",
      credentials: data.withCredentials ? "include" : "same-origin",
      referrerPolicy: data.referrerPolicy ?? "no-referrer-when-downgrade" });
    if (!active()) {
      // Abort can race with fulfillment. Cancellation must remain in this chain.
      await response.body?.cancel().catch(() => {});
      return;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new FetchFailure("HttpStatusCodeInvalid", response.status, response.statusText);
    }
    const reader = response.body.getReader();
    this.reader = reader;
    let complete = false;
    try {
      if (response.url !== request.url) this.onURLRedirect(this.seek.removeURLParameters(response.url));
      const lengthHeader = response.headers.get("Content-Length");
      const length = lengthHeader === null ? undefined : Number(lengthHeader);
      if (length !== undefined && length > 0) this.onContentLengthKnown(length);
      let received = 0;
      while (active()) {
        const { done, value } = await reader.read();
        if (!active()) return;
        if (done) {
          complete = true;
          if (length !== undefined && received < length) throw new FetchFailure("EarlyEof", -1, "Fetch stream meet Early-EOF");
          this._status = 4;
          this.onComplete(range.from, range.from + received - 1);
          return;
        }
        this._status = 2;
        const start = range.from + received;
        received += value.byteLength;
        this.onDataArrival(value.slice().buffer, start, received);
      }
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
      reader.releaseLock();
      if (this.reader === reader) this.reader = undefined;
    }
  }
}
