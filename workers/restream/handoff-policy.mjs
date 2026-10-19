/**
 * All observation times use the same monotonic clock. Schedule times use epoch ms.
 * Reset accumulated evidence whenever a source recovers, reconnects, or changes.
 * The supervisor owns continuous failure/silence measurement; cached provider
 * status is never decoded-media evidence.
 * @typedef {{slotKey:string, sourceId:string, startAt:number, endAt?:number, available:boolean}} Slot
 * @typedef {{silence?:{thresholdDb:number,durationMs:number},maxOverrunMs?:number}} Policy
 * @typedef {{slotKey:string,sourceId:string,observedAt:number,progressing:boolean,analysisActive:boolean,failureSince?:number,silenceSince?:number,audioLevelDb?:number}} Evidence
 * @typedef {{slotKey:string,sourceId:string,observedAt:number,ready:boolean}} Readiness
 * @typedef {{scheduleNow:number,observationNow:number,sessionDeadline:number,mode:'automatic'|'manual'|'hold',current?:Slot,next?:Slot,evidence?:Evidence,nextReadiness?:Readiness,policy:Policy}} HandoffInput
 * @typedef {'media-failure'|'source-unavailable'|'maximum-overrun'|'silence'} SwitchReason
 * @typedef {{kind:'stay'}|{kind:'prepare',slotKey:string}|{kind:'switch',slotKey:string,reason:SwitchReason}|{kind:'hold',reason:SwitchReason|'manual-hold'|'no-current-source'|'invalid-clock',prepare?:{slotKey:string}}|{kind:'stop',reason:'session-deadline'}} HandoffDecision
 */
export const FAILURE_CONFIRMATION_MS = 1_000;
export const OBSERVATION_FRESHNESS_MS = 2_000;
export const PREPARE_MS = 120_000;

/** @param {number} now @param {number} observedAt */
function fresh(now, observedAt) {
  return Number.isFinite(observedAt) && observedAt <= now && now - observedAt <= OBSERVATION_FRESHNESS_MS;
}
/** @param {number} observedAt @param {number|undefined} since @param {number} duration */
function sustained(observedAt, since, duration) {
  return since !== undefined && Number.isFinite(since) && since >= 0 && observedAt - since >= duration;
}

/** Pure reducer. Caller validates policy once at the configuration boundary.
 * @param {HandoffInput} input
 * @returns {HandoffDecision}
 */
export function decideHandoff(input) {
  const { scheduleNow, observationNow, sessionDeadline, mode, current, next, evidence, nextReadiness, policy } = input;
  if (![scheduleNow, observationNow, sessionDeadline].every(Number.isFinite) || observationNow < 0) return { kind: 'hold', reason: 'invalid-clock' };
  if (scheduleNow >= sessionDeadline) return { kind: 'stop', reason: 'session-deadline' };
  if (mode === 'hold') return { kind: 'hold', reason: 'manual-hold' };
  const boundary = current?.endAt ?? next?.startAt;
  const eligibleAt = next && Math.max(next.startAt, boundary ?? next.startAt);
  const distinctNext = next && next.slotKey !== current?.slotKey;
  const eligible = mode === 'automatic' && distinctNext && next.available && eligibleAt !== undefined && scheduleNow >= eligibleAt;
  const decodedReady = next && nextReadiness?.ready && nextReadiness.slotKey === next.slotKey && nextReadiness.sourceId === next.sourceId && fresh(observationNow, nextReadiness.observedAt);
  const ready = eligible && decodedReady;
  const prepare = mode === 'automatic' && distinctNext && next.available && eligibleAt !== undefined && scheduleNow >= eligibleAt - PREPARE_MS && !decodedReady ? { slotKey: next.slotKey } : undefined;
  const preparation = prepare ? { prepare } : {};
  const observed = current && evidence && evidence.slotKey === current.slotKey && evidence.sourceId === current.sourceId && fresh(observationNow, evidence.observedAt);
  /** @type {SwitchReason|undefined} */
  let reason;
  if (current && !current.available) reason = 'source-unavailable';
  else if (mode === 'automatic' && current && current.endAt !== undefined && policy.maxOverrunMs !== undefined && scheduleNow >= current.endAt + policy.maxOverrunMs) reason = 'maximum-overrun';
  else if (observed && !evidence.progressing && sustained(evidence.observedAt, evidence.failureSince, FAILURE_CONFIRMATION_MS)) reason = 'media-failure';
  else if (mode === 'automatic' && observed && policy.silence && evidence.progressing && evidence.analysisActive && Number.isFinite(evidence.audioLevelDb) && evidence.audioLevelDb <= policy.silence.thresholdDb && sustained(evidence.observedAt, evidence.silenceSince, policy.silence.durationMs)) reason = 'silence';
  if (reason === 'silence' && !ready) reason = undefined;
  if (reason) return ready ? { kind: 'switch', slotKey: next.slotKey, reason } : { kind: 'hold', reason, ...preparation };
  if (!current) return ready ? { kind: 'switch', slotKey: next.slotKey, reason: 'source-unavailable' } : { kind: 'hold', reason: 'no-current-source', ...preparation };
  if (prepare) return { kind: 'prepare', slotKey: prepare.slotKey };
  return { kind: 'stay' };
}
