import { tool, type Plugin } from "@opencode-ai/plugin"
import { exec, execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import {
  buildPrimaryUserAwarenessEnvelope,
  buildSupervisorEnvelope,
  clampHistoryCount,
  collectVisibleSince,
  findLastAssistantMessage,
  findLastUserMessage,
  makeLinkID,
  normalizeName,
  parseMode,
} from "./supervisor-loop-core.mjs"

const STATE_VERSION = 1
const POLL_TICK_MS = 30000
const EVENT_POLL_THROTTLE_MS = 1500
const SUPERVISOR_LOOP_SOURCE = "supervisor-loop"
const INTERNAL_VISIBILITY = "internal"
const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

type RelayMode = "nudge" | "act"

type Link = {
  id: string
  primarySessionID: string
  supervisorSessionID: string
  mode: RelayMode
  enabled: boolean
  historyCount: number
  lastRelayedPrimaryMessageID?: string
  lastObservedPrimaryUserMessageID?: string
  lastObservedPrimaryUserText?: string
  lastAwarePrimaryUserMessageID?: string
  createdAt: string
  updatedAt: string
  lastRelayedAt?: string
}

type LoopState = {
  version: number
  links: Link[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function getStatePath(projectDir: string): string {
  return path.join(projectDir, ".opencode", "state", "supervisor-loop.json")
}

function getInboxPath(projectDir: string): string {
  return path.join(projectDir, ".opencode", "state", "supervisor-loop-inbox.md")
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

async function readState(projectDir: string): Promise<LoopState> {
  const filePath = getStatePath(projectDir)
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed = JSON.parse(raw)
    if (!isObject(parsed)) return { version: STATE_VERSION, links: [] }

    const linksRaw = Array.isArray(parsed.links) ? parsed.links : []
    const links: Link[] = []

    for (const row of linksRaw) {
      if (!isObject(row)) continue
      const primarySessionID = normalizeName(row.primarySessionID)
      const supervisorSessionID = normalizeName(row.supervisorSessionID)
      if (!primarySessionID || !supervisorSessionID) continue
      if (primarySessionID === supervisorSessionID) continue

      links.push({
        id: makeLinkID(primarySessionID, supervisorSessionID),
        primarySessionID,
        supervisorSessionID,
        mode: parseMode(row.mode),
        enabled: row.enabled !== false,
        historyCount: clampHistoryCount(Number(row.historyCount)),
        lastRelayedPrimaryMessageID: normalizeName(row.lastRelayedPrimaryMessageID) || undefined,
        lastObservedPrimaryUserMessageID: normalizeName(row.lastObservedPrimaryUserMessageID) || undefined,
        lastObservedPrimaryUserText: normalizeName(row.lastObservedPrimaryUserText) || undefined,
        lastAwarePrimaryUserMessageID: normalizeName(row.lastAwarePrimaryUserMessageID) || undefined,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : nowIso(),
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : nowIso(),
        lastRelayedAt: typeof row.lastRelayedAt === "string" ? row.lastRelayedAt : undefined,
      })
    }

    return {
      version: STATE_VERSION,
      links,
    }
  } catch {
    return { version: STATE_VERSION, links: [] }
  }
}

async function writeState(projectDir: string, state: LoopState): Promise<void> {
  const filePath = getStatePath(projectDir)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf8")
}

async function appendInbox(projectDir: string, header: string, body: string): Promise<void> {
  const filePath = getInboxPath(projectDir)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const text = `\n\n## ${nowIso()} ${header}\n\n${String(body || "").trim()}\n\n---\n`
  await fs.appendFile(filePath, text, "utf8")
}

async function readTail(filePath: string, maxBytes: number): Promise<string> {
  try {
    const buf = await fs.readFile(filePath)
    const tail = buf.length <= maxBytes ? buf : buf.subarray(buf.length - maxBytes)
    return tail.toString("utf8")
  } catch {
    return ""
  }
}

async function safeToast(
  client: any,
  message: string,
  variant: "info" | "success" | "warning" | "error"
): Promise<void> {
  try {
    await client.tui.publish({
      body: {
        type: "tui.toast.show",
        properties: {
          message,
          variant,
          duration: 2600,
        },
      },
    })
  } catch {
    // ignore
  }
}

async function appLog(
  client: any,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    await client.app.log({
      body: {
        service: "supervisor-loop",
        level,
        message,
        extra,
      },
    })
  } catch {
    // ignore
  }
}

async function sessionPromptCompat(
  client: any,
  serverUrl: URL,
  directory: string,
  sessionID: string,
  body: { parts: any[]; noReply?: boolean }
): Promise<any> {
  try {
    const response = await client.session.prompt({ path: { id: sessionID }, query: { directory }, body })
    const summary = summarizePromptAck(response)
    if (summary.infoID || summary.partsCount) return { ...(isObject(response) ? response : {}), __via: "sdk:path:id" }
  } catch {
    // continue
  }

  try {
    const response = await client.session.prompt({ path: { sessionID }, query: { directory }, body })
    const summary = summarizePromptAck(response)
    if (summary.infoID || summary.partsCount)
      return { ...(isObject(response) ? response : {}), __via: "sdk:path:sessionID" }
  } catch {
    // continue
  }

  try {
    const response = await client.session.prompt({ sessionID, directory, ...body })
    const summary = summarizePromptAck(response)
    if (summary.infoID || summary.partsCount) return { ...(isObject(response) ? response : {}), __via: "sdk:flat" }
  } catch {
    // continue
  }

  const url = new URL(`/session/${encodeURIComponent(sessionID)}/message`, serverUrl)
  url.searchParams.set("directory", directory)

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.OPENCODE_SERVER_USERNAME && process.env.OPENCODE_SERVER_PASSWORD
        ? {
            Authorization: `Basic ${Buffer.from(
              `${process.env.OPENCODE_SERVER_USERNAME}:${process.env.OPENCODE_SERVER_PASSWORD}`
            ).toString("base64")}`,
          }
        : process.env.OPENCODE_SERVER_PASSWORD
          ? { Authorization: `Bearer ${process.env.OPENCODE_SERVER_PASSWORD}` }
          : {}),
      "x-opencode-directory": encodeURIComponent(directory),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`direct session message POST failed: ${response.status} ${text.slice(0, 300)}`)
  }

  const text = await response.text().catch(() => "")
  let parsed: any = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { __rawText: text.slice(0, 500) }
  }

  if (isObject(parsed)) {
    parsed.__via = "direct:http"
    parsed.__httpStatus = response.status
  }

  return parsed
}

function makeTextPart(
  text: string,
  kind: string,
  options?: { internal?: boolean; synthetic?: boolean }
): Record<string, unknown> {
  const internal = options?.internal !== false
  const synthetic = options?.synthetic !== false
  return {
    type: "text",
    text,
    synthetic,
    metadata: {
      source: SUPERVISOR_LOOP_SOURCE,
      ...(internal ? { visibility: INTERNAL_VISIBILITY } : {}),
      kind,
    },
  }
}

function makeInternalTextPart(text: string, kind: string): Record<string, unknown> {
  return makeTextPart(text, kind, { internal: true, synthetic: true })
}

function makeVisiblePrimaryInstructionPart(text: string): Record<string, unknown> {
  const value = normalizeName(text)
  const visibleText = value.startsWith("[Supervisor]") ? value : `[Supervisor] ${value}`
  return makeTextPart(visibleText, "primary-instruction", { internal: false, synthetic: false })
}

function summarizePromptAck(response: any): Record<string, unknown> {
  const data = response?.data ?? response?.fields ?? response
  return {
    via: normalizeName(data?.__via),
    httpStatus: data?.__httpStatus,
    infoSessionID: normalizeName(data?.info?.sessionID),
    infoID: normalizeName(data?.info?.id),
    infoRole: normalizeName(data?.info?.role),
    partsCount: Array.isArray(data?.parts) ? data.parts.length : 0,
    topLevelKeys: isObject(data) ? Object.keys(data).slice(0, 12) : [],
  }
}

function unwrapResponse<T>(response: any): T {
  const unwrapped = response?.data ?? response?.fields ?? response
  return (unwrapped?.messages ?? unwrapped) as T
}

function extractJsonObject(text: string): any {
  if (typeof text !== "string") return null
  const start = text.indexOf("{")
  if (start < 0) return null
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return null
  }
}

async function sessionMessagesExportFallback(directory: string, sessionID: string): Promise<any[]> {
  try {
    const stdout =
      process.platform === "win32"
        ? (
            await execAsync(`opencode export ${sessionID}`, {
              cwd: directory,
              encoding: "utf8",
              windowsHide: true,
              maxBuffer: 128 * 1024 * 1024,
            })
          ).stdout
        : (
            await execFileAsync("opencode", ["export", sessionID], {
              cwd: directory,
              encoding: "utf8",
              windowsHide: true,
              maxBuffer: 128 * 1024 * 1024,
            })
          ).stdout

    const parsed = extractJsonObject(stdout)
    const messages = parsed?.messages
    const out = Array.isArray(messages) ? messages : []
    try {
      await appendInbox(
        directory,
        `debug export-fallback ${sessionID}`,
        JSON.stringify(
          {
            ok: true,
            count: out.length,
          },
          null,
          2
        )
      )
    } catch {
      // ignore
    }
    return out
  } catch (error) {
    try {
      await appendInbox(
        directory,
        `debug export-fallback ${sessionID}`,
        JSON.stringify(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2
        )
      )
    } catch {
      // ignore
    }
    return []
  }
}

function summarizeRecentMessages(messages: any[]): Array<{ id: string; role: string; parts: number }> {
  if (!Array.isArray(messages)) return []
  return messages.slice(-5).map((message) => ({
    id: normalizeName(message?.info?.id),
    role: normalizeName(message?.info?.role),
    parts: Array.isArray(message?.parts) ? message.parts.length : 0,
  }))
}

async function sessionMessagesCompat(client: any, directory: string, sessionID: string, limit = 300): Promise<any[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID }, query: { directory, limit } })
    const data = unwrapResponse<any[]>(response)
    if (Array.isArray(data)) return data
  } catch {
    // continue
  }

  try {
    const response = await client.session.messages({ path: { sessionID }, query: { directory, limit } })
    const data = unwrapResponse<any[]>(response)
    if (Array.isArray(data)) return data
  } catch {
    // continue
  }

  try {
    const response = await client.session.messages({ sessionID, directory, limit })
    const data = unwrapResponse<any[]>(response)
    if (Array.isArray(data)) return data
  } catch {
    // continue
  }

  const exported = await sessionMessagesExportFallback(directory, sessionID)
  if (exported.length <= limit) return exported
  return exported.slice(-limit)
}

function resolveLinkTarget(
  args: any,
  contextSessionID: string
): { primarySessionID: string; supervisorSessionID: string; ok: true } | { ok: false; error: string } {
  const providedPrimary = normalizeName(args.primarySessionID)
  const providedSupervisor = normalizeName(args.supervisorSessionID)

  if (!providedPrimary && !providedSupervisor) {
    return {
      ok: false,
      error: "provide at least one of primarySessionID or supervisorSessionID (the other defaults to current session)",
    }
  }

  const primarySessionID = providedPrimary || contextSessionID
  const supervisorSessionID = providedSupervisor || contextSessionID

  if (!primarySessionID || !supervisorSessionID) {
    return { ok: false, error: "primarySessionID and supervisorSessionID are required" }
  }

  if (primarySessionID === supervisorSessionID) {
    return {
      ok: false,
      error: "primarySessionID and supervisorSessionID must be different sessions",
    }
  }

  return {
    ok: true,
    primarySessionID,
    supervisorSessionID,
  }
}

export const SupervisorLoop: Plugin = async ({ client, directory, serverUrl }) => {
  let pollInFlight = false
  let pollInFlightDone: Promise<void> | null = null
  const eventPolls = ((globalThis as any).__supervisorLoopEventPolls ??= new Map<string, number>()) as Map<
    string,
    number
  >
  const backgroundSends = ((globalThis as any).__supervisorLoopBackgroundSends ??= new Map<
    string,
    Promise<void>
  >()) as Map<string, Promise<void>>

  function shouldThrottleEventPoll(kind: string, sessionID?: string): boolean {
    const key = `${directory}:${kind}:${normalizeName(sessionID) || "*"}`
    const now = Date.now()
    const last = eventPolls.get(key) ?? 0
    if (now - last < EVENT_POLL_THROTTLE_MS) return true
    eventPolls.set(key, now)
    return false
  }

  function trackBackgroundSend(key: string, work: Promise<void>): void {
    backgroundSends.set(key, work)
    void work.finally(() => {
      if (backgroundSends.get(key) === work) backgroundSends.delete(key)
    })
  }

  function updateTrackedPrimaryUser(link: Link, message: { id: string; text: string } | null): boolean {
    if (!message?.id) return false
    const nextText = normalizeName(message.text)
    if (
      link.lastObservedPrimaryUserMessageID === message.id &&
      normalizeName(link.lastObservedPrimaryUserText) === nextText
    ) {
      return false
    }
    link.lastObservedPrimaryUserMessageID = message.id
    link.lastObservedPrimaryUserText = nextText || undefined
    link.updatedAt = nowIso()
    return true
  }

  async function relayPrimaryUserAwareness(
    link: Link,
    projectDir: string,
    userMessage: { id: string; text: string } | null
  ): Promise<boolean> {
    if (!userMessage?.id) return false
    if (link.lastAwarePrimaryUserMessageID === userMessage.id) return false

    const awareness = buildPrimaryUserAwarenessEnvelope({
      primarySessionID: link.primarySessionID,
      supervisorSessionID: link.supervisorSessionID,
      userMessageID: userMessage.id,
      userMessageText: userMessage.text,
    })

    const ack = await sessionPromptCompat(client, serverUrl, projectDir, link.supervisorSessionID, {
      noReply: true,
      parts: [makeInternalTextPart(awareness, "primary-user-awareness")],
    })

    link.lastAwarePrimaryUserMessageID = userMessage.id
    link.updatedAt = nowIso()
    await appendInbox(
      projectDir,
      `debug prompt-ack ${link.supervisorSessionID}`,
      JSON.stringify(summarizePromptAck(ack), null, 2)
    )
    return true
  }

  async function refreshPrimaryUserState(
    link: Link,
    projectDir: string,
    messages?: any[]
  ): Promise<{ changed: boolean; userMessage: { id: string; text: string } | null }> {
    const sourceMessages = Array.isArray(messages)
      ? messages
      : await sessionMessagesCompat(client, projectDir, link.primarySessionID, 320)
    const userMessage = findLastUserMessage(sourceMessages)
    let changed = updateTrackedPrimaryUser(link, userMessage)
    if (await relayPrimaryUserAwareness(link, projectDir, userMessage)) changed = true
    return {
      changed,
      userMessage: userMessage ? { id: userMessage.id, text: userMessage.text } : null,
    }
  }

  async function refreshPrimaryUserStateForSession(projectDir: string, primarySessionID: string): Promise<void> {
    const state = await readState(projectDir)
    const links = state.links.filter((link) => link.enabled && link.primarySessionID === primarySessionID)
    if (links.length === 0) return

    const messages = await sessionMessagesCompat(client, projectDir, primarySessionID, 320)
    let changed = false
    for (const link of links) {
      const result = await refreshPrimaryUserState(link, projectDir, messages)
      if (result.changed) changed = true
    }
    if (changed) await writeState(projectDir, state)
  }

  async function processLink(link: Link, projectDir: string): Promise<{ relayed: boolean; changed: boolean }> {
    let messages = await sessionMessagesCompat(client, projectDir, link.primarySessionID, 320)
    let assistant = findLastAssistantMessage(messages)

    // Idle events can race slightly ahead of persisted assistant messages.
    if (!assistant?.id) {
      await new Promise((resolve) => setTimeout(resolve, 450))
      messages = await sessionMessagesCompat(client, projectDir, link.primarySessionID, 320)
      assistant = findLastAssistantMessage(messages)
      if (!assistant?.id) {
        await appendInbox(
          projectDir,
          `debug no-assistant ${link.primarySessionID}`,
          JSON.stringify(
            {
              stage: "no-assistant",
              primarySessionID: link.primarySessionID,
              supervisorSessionID: link.supervisorSessionID,
              messageCount: Array.isArray(messages) ? messages.length : 0,
              recent: summarizeRecentMessages(messages),
            },
            null,
            2
          )
        )
        return { relayed: false, changed: false }
      }
    }
    if (assistant.id === link.lastRelayedPrimaryMessageID) return { relayed: false, changed: false }

    if (!normalizeName(assistant.text) && normalizeName(assistant.finish).toLowerCase() !== "stop") {
      return { relayed: false, changed: false }
    }

    const userState = await refreshPrimaryUserState(link, projectDir, messages)

    const visible = collectVisibleSince(messages, link.lastRelayedPrimaryMessageID || "", link.historyCount)
    const envelope = buildSupervisorEnvelope({
      primarySessionID: link.primarySessionID,
      supervisorSessionID: link.supervisorSessionID,
      mode: link.mode,
      assistantMessageID: assistant.id,
      assistantFinish: assistant.finish,
      assistantText: assistant.text,
      lastRelayedMessageID: link.lastRelayedPrimaryMessageID,
      historyCount: link.historyCount,
      lastUserMessageID: userState.userMessage?.id,
      lastUserMessageText: userState.userMessage?.text,
      visibleEntries: visible,
    })

    await appendInbox(projectDir, `${link.primarySessionID} -> ${link.supervisorSessionID}`, envelope)

    if (link.mode === "act") {
      const ack = await sessionPromptCompat(client, serverUrl, projectDir, link.supervisorSessionID, {
        parts: [makeInternalTextPart(envelope, "relay-report")],
      })
      await appendInbox(
        projectDir,
        `debug prompt-ack ${link.supervisorSessionID}`,
        JSON.stringify(summarizePromptAck(ack), null, 2)
      )
    } else {
      const ack = await sessionPromptCompat(client, serverUrl, projectDir, link.supervisorSessionID, {
        noReply: true,
        parts: [makeInternalTextPart(envelope, "relay-report")],
      })
      await appendInbox(
        projectDir,
        `debug prompt-ack ${link.supervisorSessionID}`,
        JSON.stringify(summarizePromptAck(ack), null, 2)
      )
    }

    link.lastRelayedPrimaryMessageID = assistant.id
    link.lastRelayedAt = nowIso()
    link.updatedAt = nowIso()

    await safeToast(client, `Supervisor relay from ${link.primarySessionID}`, "info")
    await appLog(client, "info", "Relayed primary output to supervisor", {
      linkID: link.id,
      primarySessionID: link.primarySessionID,
      supervisorSessionID: link.supervisorSessionID,
      mode: link.mode,
      assistantMessageID: assistant.id,
    })

    return { relayed: true, changed: true }
  }

  async function poll(
    reason: "event" | "manual" | "timer",
    targetPrimarySessionID?: string,
    projectDir: string = directory
  ): Promise<{ checked: number; relayed: number; failed: number; errors: Array<{ linkID: string; error: string }> }> {
    for (let i = 0; i < 5; i++) {
      if (!pollInFlight || !pollInFlightDone) break
      await pollInFlightDone
    }

    if (pollInFlight) return { checked: 0, relayed: 0, failed: 0, errors: [] }

    pollInFlight = true
    let doneResolve: () => void = () => {}
    pollInFlightDone = new Promise<void>((resolve) => {
      doneResolve = resolve
    })

    try {
      const state = await readState(projectDir)
      let changed = false
      let checked = 0
      let relayed = 0
      let failed = 0
      const errors: Array<{ linkID: string; error: string }> = []

      for (const link of state.links) {
        if (!link.enabled) continue
        if (targetPrimarySessionID && link.primarySessionID !== targetPrimarySessionID) continue
        checked += 1

        try {
          const result = await processLink(link, projectDir)
          if (result.relayed) relayed += 1
          if (result.changed) changed = true
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          failed += 1
          errors.push({ linkID: link.id, error: msg })
          await appLog(client, "warn", "Supervisor relay failed", {
            linkID: link.id,
            reason,
            error: msg,
          })
        }
      }

      if (changed) await writeState(projectDir, state)
      return { checked, relayed, failed, errors }
    } finally {
      pollInFlight = false
      doneResolve()
      pollInFlightDone = null
    }
  }

  const timers = ((globalThis as any).__supervisorLoopTimers ??= new Map<string, NodeJS.Timeout>()) as Map<
    string,
    NodeJS.Timeout
  >
  const existingTimer = timers.get(directory)
  if (existingTimer) clearInterval(existingTimer)
  const timer = setInterval(() => {
    void poll("timer", undefined, directory)
  }, POLL_TICK_MS)
  timers.set(directory, timer)

  return {
    tool: {
      supervisor_link_set: tool({
        description: "Link a primary session to a supervisor session",
        args: {
          primarySessionID: tool.schema
            .string()
            .optional()
            .describe("Primary session id (defaults to current session)"),
          supervisorSessionID: tool.schema
            .string()
            .optional()
            .describe("Supervisor session id (defaults to current session)"),
          mode: tool.schema
            .string()
            .optional()
            .describe("Relay mode: nudge (noReply) or act (trigger supervisor reply)"),
          enabled: tool.schema.boolean().optional().describe("Enable or disable the link"),
          historyCount: tool.schema
            .number()
            .optional()
            .describe("Visible transcript items to include from checkpoint (1-40, default 12)"),
        },
        async execute(args, context) {
          const resolved = resolveLinkTarget(args as any, context.sessionID)
          if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.error }, null, 2)

          const state = await readState(context.directory)
          const id = makeLinkID(resolved.primarySessionID, resolved.supervisorSessionID)
          const existing = state.links.find((l) => l.id === id)

          const hasMode = Object.prototype.hasOwnProperty.call(args as any, "mode")
          const hasEnabled = Object.prototype.hasOwnProperty.call(args as any, "enabled")
          const hasHistoryCount = Object.prototype.hasOwnProperty.call(args as any, "historyCount")

          if (existing) {
            if (hasMode) existing.mode = parseMode((args as any).mode)
            if (hasEnabled) existing.enabled = (args as any).enabled === true
            if (hasHistoryCount) existing.historyCount = clampHistoryCount(Number((args as any).historyCount))
            existing.updatedAt = nowIso()

            await writeState(context.directory, state)
            await poll("manual", existing.primarySessionID, context.directory)

            return JSON.stringify(
              {
                ok: true,
                updated: true,
                link: existing,
                statePath: getStatePath(context.directory),
              },
              null,
              2
            )
          }

          const link: Link = {
            id,
            primarySessionID: resolved.primarySessionID,
            supervisorSessionID: resolved.supervisorSessionID,
            mode: parseMode((args as any).mode),
            enabled: (args as any).enabled !== false,
            historyCount: clampHistoryCount(Number((args as any).historyCount)),
            createdAt: nowIso(),
            updatedAt: nowIso(),
          }

          state.links.push(link)
          await writeState(context.directory, state)
          await poll("manual", link.primarySessionID, context.directory)

          await safeToast(
            client,
            `Supervisor link set: ${link.primarySessionID} -> ${link.supervisorSessionID}`,
            "success"
          )

          return JSON.stringify(
            {
              ok: true,
              created: true,
              link,
              statePath: getStatePath(context.directory),
            },
            null,
            2
          )
        },
      }),
      supervisor_link_remove: tool({
        description: "Remove a primary/supervisor session link",
        args: {
          primarySessionID: tool.schema
            .string()
            .optional()
            .describe("Primary session id (defaults to current session)"),
          supervisorSessionID: tool.schema
            .string()
            .optional()
            .describe("Supervisor session id (defaults to current session)"),
        },
        async execute(args, context) {
          const resolved = resolveLinkTarget(args as any, context.sessionID)
          if (!resolved.ok) return JSON.stringify({ ok: false, error: resolved.error }, null, 2)

          const state = await readState(context.directory)
          const id = makeLinkID(resolved.primarySessionID, resolved.supervisorSessionID)
          const before = state.links.length
          state.links = state.links.filter((l) => l.id !== id)
          const removed = before - state.links.length
          if (removed > 0) await writeState(context.directory, state)

          return JSON.stringify(
            {
              ok: true,
              removed,
              linkID: id,
              statePath: getStatePath(context.directory),
            },
            null,
            2
          )
        },
      }),
      supervisor_link_list: tool({
        description: "List supervisor loop links",
        args: {
          primarySessionID: tool.schema.string().optional().describe("Filter by primary session id"),
          supervisorSessionID: tool.schema.string().optional().describe("Filter by supervisor session id"),
          includeDisabled: tool.schema.boolean().optional().describe("Include disabled links"),
        },
        async execute(args, context) {
          const primarySessionID = normalizeName((args as any).primarySessionID)
          const supervisorSessionID = normalizeName((args as any).supervisorSessionID)
          const includeDisabled = (args as any).includeDisabled === true

          const state = await readState(context.directory)
          const links = state.links.filter((l) => {
            if (!includeDisabled && !l.enabled) return false
            if (primarySessionID && l.primarySessionID !== primarySessionID) return false
            if (supervisorSessionID && l.supervisorSessionID !== supervisorSessionID) return false
            return true
          })

          return JSON.stringify(
            {
              ok: true,
              count: links.length,
              links,
              statePath: getStatePath(context.directory),
              inboxPath: getInboxPath(context.directory),
            },
            null,
            2
          )
        },
      }),
      supervisor_link_poll_now: tool({
        description: "Poll supervisor links immediately for new primary output",
        args: {
          primarySessionID: tool.schema.string().optional().describe("Only poll links for this primary session id"),
        },
        async execute(args, context) {
          const primarySessionID = normalizeName((args as any).primarySessionID) || undefined
          const result = await poll("manual", primarySessionID, context.directory)
          return JSON.stringify({ ok: true, ...result }, null, 2)
        },
      }),
      supervisor_send_to_primary: tool({
        description: "Send a supervisor instruction/message into a primary session",
        args: {
          primarySessionID: tool.schema.string().describe("Primary session id to receive the message"),
          text: tool.schema.string().describe("Instruction or message for the primary session"),
          noReply: tool.schema
            .boolean()
            .optional()
            .describe(
              "If true, inject context without forcing immediate reply (default false; false now queues asynchronously)"
            ),
        },
        async execute(args, context) {
          const primarySessionID = normalizeName((args as any).primarySessionID)
          const text = normalizeName((args as any).text)
          const noReply = (args as any).noReply === true

          if (!primarySessionID || !text) {
            return JSON.stringify(
              {
                ok: false,
                error: "primarySessionID and text are required",
              },
              null,
              2
            )
          }

          await appendInbox(context.directory, `supervisor->primary ${primarySessionID}`, text)
          await safeToast(client, `Supervisor sent message to primary ${primarySessionID}`, "info")

          const sendKey = `${context.directory}:${primarySessionID}`
          const sendWork = (async () => {
            const ack = await sessionPromptCompat(client, serverUrl, context.directory, primarySessionID, {
              noReply,
              parts: [makeVisiblePrimaryInstructionPart(text)],
            })
            await appendInbox(
              context.directory,
              `debug prompt-ack ${primarySessionID}`,
              JSON.stringify(summarizePromptAck(ack), null, 2)
            )
          })().catch(async (error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error)
            await appLog(client, "warn", "Supervisor send to primary failed", {
              primarySessionID,
              error: msg,
            })
            await appendInbox(
              context.directory,
              `debug prompt-ack ${primarySessionID}`,
              JSON.stringify({ error: msg }, null, 2)
            )
          })

          if (noReply) {
            await sendWork
          } else {
            trackBackgroundSend(sendKey, sendWork)
          }

          return JSON.stringify(
            {
              ok: true,
              primarySessionID,
              noReply,
              delivered: true,
              queuedAsync: !noReply,
            },
            null,
            2
          )
        },
      }),
      supervisor_inbox_read: tool({
        description: "Read supervisor-loop inbox entries",
        args: {
          maxBytes: tool.schema.number().optional().describe("Read this many bytes from inbox tail (default 64000)"),
        },
        async execute(args, context) {
          const maxBytesRaw = Number((args as any).maxBytes)
          const maxBytes = Number.isFinite(maxBytesRaw)
            ? Math.max(1024, Math.min(512000, Math.floor(maxBytesRaw)))
            : 64000
          const inboxPath = getInboxPath(context.directory)
          const text = await readTail(inboxPath, maxBytes)
          return JSON.stringify({ ok: true, inboxPath, maxBytes, text }, null, 2)
        },
      }),
    },
    event: async ({ event }: any) => {
      const eventType = normalizeName(event?.type)

      if (eventType.startsWith("message.")) {
        const role =
          normalizeName(event?.properties?.info?.role) ||
          normalizeName(event?.properties?.message?.info?.role) ||
          normalizeName(event?.properties?.role)
        const sessionID =
          normalizeName(event?.properties?.info?.sessionID) ||
          normalizeName(event?.properties?.message?.info?.sessionID) ||
          normalizeName(event?.properties?.sessionID) ||
          normalizeName(event?.properties?.sessionId)

        if (role === "user" && sessionID) {
          if (shouldThrottleEventPoll("user-awareness", sessionID || undefined)) return
          try {
            await refreshPrimaryUserStateForSession(directory, sessionID)
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            await appLog(client, "warn", "Supervisor user-awareness update failed", {
              eventType,
              sessionID,
              role,
              error: msg,
            })
          }
          return
        }

        if (!role && sessionID) {
          if (shouldThrottleEventPoll("ambiguous-awareness", sessionID || undefined)) return
          try {
            await refreshPrimaryUserStateForSession(directory, sessionID)
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            await appLog(client, "warn", "Supervisor ambiguous-message awareness update failed", {
              eventType,
              sessionID,
              error: msg,
            })
          }
          return
        }

        const shouldPoll = role === "assistant"

        if (shouldPoll) {
          if (shouldThrottleEventPoll("assistant-relay", sessionID || undefined)) return
          try {
            if (sessionID) {
              const first = await poll("event", sessionID)
              if (first.checked === 0) await poll("event")
            } else {
              await poll("event")
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            await appLog(client, "warn", "Supervisor message-event poll failed", {
              eventType,
              sessionID,
              role,
              error: msg,
            })
          }
        }
      }

      const isIdle =
        eventType === "session.idle" ||
        (eventType === "session.status" && normalizeName(event?.properties?.status?.type).toLowerCase() === "idle")

      if (!isIdle) return

      const sessionID =
        normalizeName(event?.properties?.sessionID) ||
        normalizeName(event?.properties?.sessionId) ||
        normalizeName(event?.properties?.id)

      try {
        const first = await poll("event", sessionID || undefined)
        if (sessionID && first.checked === 0) {
          await poll("event")
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        await appLog(client, "warn", "Supervisor event poll failed", { eventType, sessionID, error: msg })
      }
    },
  }
}
