export const DEFAULT_HISTORY_COUNT = 12
export const MIN_HISTORY_COUNT = 1
export const MAX_HISTORY_COUNT = 40
export const MAX_VISIBLE_TEXT_CHARS = 4000
export const MAX_ITEM_TEXT_CHARS = 900

const SUPERVISOR_LOOP_SOURCE = "supervisor-loop"
const INTERNAL_VISIBILITY = "internal"
const SUPERVISOR_CONTROL_KINDS = new Set(["relay-report", "primary-instruction", "primary-user-awareness"])

export function normalizeName(value) {
  if (typeof value !== "string") return ""
  return value.trim()
}

export function collapseWhitespace(value) {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim()
}

export function clampHistoryCount(value) {
  if (!Number.isFinite(value)) return DEFAULT_HISTORY_COUNT
  const n = Math.floor(Number(value))
  return Math.max(MIN_HISTORY_COUNT, Math.min(MAX_HISTORY_COUNT, n))
}

export function parseMode(value) {
  const v = normalizeName(value).toLowerCase()
  if (v === "act") return "act"
  return "nudge"
}

export function makeLinkID(primarySessionID, supervisorSessionID) {
  const primary = normalizeName(primarySessionID)
  const supervisor = normalizeName(supervisorSessionID)
  return `${primary}@${supervisor}`
}

function isSupervisorControlPart(part) {
  if (part?.metadata?.source !== SUPERVISOR_LOOP_SOURCE) return false
  if (part?.metadata?.visibility === INTERNAL_VISIBILITY) return true
  return SUPERVISOR_CONTROL_KINDS.has(normalizeName(part?.metadata?.kind))
}

function looksLikeLegacySupervisorControl(text) {
  const value = collapseWhitespace(text)
  if (!value) return false
  if (value.startsWith("SUPERVISOR_PING:")) return true
  if (value.startsWith("<supervisor-report ") && value.includes('source="supervisor-loop"')) return true
  return false
}

function isSupervisorControlMessage(message) {
  if (normalizeName(message?.info?.role) !== "user") return false
  if (Array.isArray(message?.parts) && message.parts.some(isSupervisorControlPart)) return true
  return looksLikeLegacySupervisorControl(extractText(message?.parts, { includeInternal: true }))
}

export function extractText(parts, options = {}) {
  const includeInternal = options?.includeInternal === true
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part) => {
      if (part?.type !== "text") return ""
      if (typeof part?.text !== "string") return ""
      if (part?.ignored === true) return ""
      if (!includeInternal && isSupervisorControlPart(part)) return ""
      return part.text
    })
    .join("")
}

function looksLikeUserQuestion(text) {
  const value = collapseWhitespace(text)
  if (!value) return false
  if (value.endsWith("?")) return true
  return /\b(can you|could you|would you|do you want|which option|what should|should i|shall i)\b/i.test(value)
}

function looksLikeProgressUpdate(text) {
  const value = collapseWhitespace(text)
  if (!value) return true
  return /^(i('| a)?m\b|i have\b|i've\b|rerunning\b|checking\b|investigating\b|debugging\b|patching\b|fixing\b|working on\b|focusing\b|one more\b|next\b|now that\b|found it\b|good\b)/i.test(
    value
  )
}

export function classifyPrimaryStatus(input) {
  const assistantText = normalizeName(input?.assistantText)
  const assistantFinish = normalizeName(input?.assistantFinish).toLowerCase()

  if (!assistantText) return "working"
  if (looksLikeUserQuestion(assistantText)) return "needs_user"
  if (assistantFinish !== "stop") return "working"
  if (looksLikeProgressUpdate(assistantText)) return "working"
  return "done"
}

export function findLastAssistantMessage(messages) {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (normalizeName(message?.info?.role) !== "assistant") continue
    if (message?.info?.summary === true) continue

    const id = normalizeName(message?.info?.id)
    if (!id) continue

    return {
      id,
      sessionID: normalizeName(message?.info?.sessionID),
      finish: normalizeName(message?.info?.finish),
      text: extractText(message?.parts),
      createdAt: normalizeName(message?.info?.time?.created || message?.info?.createdAt),
    }
  }
  return null
}

export function findLastUserMessage(messages) {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (normalizeName(message?.info?.role) !== "user") continue
    if (message?.info?.summary === true) continue
    if (isSupervisorControlMessage(message)) continue

    const id = normalizeName(message?.info?.id)
    if (!id) continue

    const text = extractText(message?.parts)
    if (!collapseWhitespace(text)) continue

    return {
      id,
      sessionID: normalizeName(message?.info?.sessionID),
      text,
      createdAt: normalizeName(message?.info?.time?.created || message?.info?.createdAt),
    }
  }
  return null
}

function toVisibleEntry(message) {
  const role = normalizeName(message?.info?.role)
  if (role !== "user" && role !== "assistant") return null
  if (message?.info?.summary === true) return null
  if (isSupervisorControlMessage(message)) return null

  const id = normalizeName(message?.info?.id)
  if (!id) return null

  const text = collapseWhitespace(extractText(message?.parts))
  if (!text) return null

  return {
    id,
    role,
    text: text.slice(0, MAX_ITEM_TEXT_CHARS),
  }
}

export function collectVisibleSince(messages, lastRelayedMessageID, historyCount) {
  if (!Array.isArray(messages)) return []

  const count = clampHistoryCount(historyCount)
  const entries = messages.map(toVisibleEntry).filter(Boolean)
  if (entries.length === 0) return []

  const marker = normalizeName(lastRelayedMessageID)
  if (!marker) return entries.slice(-count)

  const index = entries.findIndex((e) => e.id === marker)
  const after = index >= 0 ? entries.slice(index + 1) : entries
  if (after.length <= count) return after
  return after.slice(-count)
}

function formatVisibleEntries(entries) {
  const lines = []
  let size = 0
  for (const entry of entries) {
    const line = `- [${entry.role}] (${entry.id}) ${entry.text}`
    size += line.length + 1
    if (size > MAX_VISIBLE_TEXT_CHARS) break
    lines.push(line)
  }
  return lines.join("\n")
}

export function buildSupervisorEnvelope(input) {
  const primarySessionID = normalizeName(input?.primarySessionID)
  const supervisorSessionID = normalizeName(input?.supervisorSessionID)
  const relayMode = parseMode(input?.mode)
  const assistantMessageID = normalizeName(input?.assistantMessageID)
  const assistantFinish = normalizeName(input?.assistantFinish)
  const assistantText = normalizeName(input?.assistantText)
  const lastRelayed = normalizeName(input?.lastRelayedMessageID)
  const historyCount = clampHistoryCount(input?.historyCount)
  const visibleEntries = Array.isArray(input?.visibleEntries) ? input.visibleEntries : []
  const lastUserMessageID = normalizeName(input?.lastUserMessageID)
  const lastUserMessageText = normalizeName(input?.lastUserMessageText)
  const primaryStatus = classifyPrimaryStatus({ assistantText, assistantFinish })

  const transcriptBlock = formatVisibleEntries(visibleEntries)

  return [
    `<supervisor-report source="supervisor-loop" mode="${relayMode}">`,
    `<primary-session id="${primarySessionID}"/>`,
    `<supervisor-session id="${supervisorSessionID}"/>`,
    `<assistant-message id="${assistantMessageID}" finish="${assistantFinish || "unknown"}"/>`,
    `<primary-status state="${primaryStatus}"/>`,
    `<last-user-message id="${lastUserMessageID || ""}"/>`,
    `<checkpoint lastRelayedMessageID="${lastRelayed || ""}" historyCount="${historyCount}"/>`,
    "",
    "Primary last user message:",
    lastUserMessageText || "(no tracked user message)",
    "",
    "Primary assistant output (latest):",
    assistantText || "(no text)",
    "",
    "Visible transcript since checkpoint:",
    transcriptBlock || "(no visible transcript entries)",
    "",
    `Primary status guess: ${primaryStatus}`,
    "",
    "Supervisor policy:",
    "- Decide what the human should see next and what primary should do next.",
    "- If primary-status is needs_user, ask the human the question here.",
    "- If primary-status is done, present the result here instead of nudging primary.",
    "- If primary-status is working, stay quiet unless a concrete correction is needed.",
    "- If primary should continue, call supervisor_send_to_primary with a short internal instruction.",
    "- If feedback is complete and no action is needed, explicitly state done.",
    "</supervisor-report>",
  ].join("\n")
}

export function buildPrimaryUserAwarenessEnvelope(input) {
  const primarySessionID = normalizeName(input?.primarySessionID)
  const supervisorSessionID = normalizeName(input?.supervisorSessionID)
  const userMessageID = normalizeName(input?.userMessageID)
  const userMessageText = normalizeName(input?.userMessageText)

  return [
    `<supervisor-awareness source="supervisor-loop" kind="primary-user-awareness">`,
    `<primary-session id="${primarySessionID}"/>`,
    `<supervisor-session id="${supervisorSessionID}"/>`,
    `<user-message id="${userMessageID || ""}"/>`,
    "",
    "Primary last user message:",
    userMessageText || "(no tracked user message)",
    "</supervisor-awareness>",
  ].join("\n")
}
