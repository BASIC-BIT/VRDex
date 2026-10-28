import { OwnershipLeaseSchema, type OwnershipLease } from "../contracts";
import { RELAY_POLICY } from "../policy";
/** One watchdog per source epoch. fence must synchronously disable output before cleanup. */
export function createLeaseWatchdog({ clock, fence }: {
    clock: () => number;
    fence: () => void;
}) {
    let identity: OwnershipLease | undefined;
    let authorityUntil = 0;
    let lastSentAt = -Infinity;
    let lastNow = clock();
    let stopped = false;
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        clearInterval(timer);
        fence();
    };
    const check = () => {
        const now = clock();
        if (!Number.isFinite(now) || now < lastNow || (identity && now >= authorityUntil))
            stop();
        lastNow = now;
        return !stopped && identity !== undefined;
    };
    const timer = setInterval(check, RELAY_POLICY.localWatchdogIntervalMs);
    timer.unref?.();
    return {
        accept(input: OwnershipLease, sentAt: number): boolean {
            check();
            if (stopped)
                return false;
            const parsed = OwnershipLeaseSchema.safeParse(input);
            if (!parsed.success || !Number.isFinite(sentAt) || sentAt > lastNow) {
                stop();
                return false;
            }
            const lease = parsed.data;
            if (identity && (identity.streamKey !== lease.streamKey || identity.workerId !== lease.workerId || identity.epoch !== lease.epoch))
                return false;
            if (sentAt <= lastSentAt)
                return false;
            // Reserve one watchdog tick; never add network latency to local authority.
            const deadline = sentAt + Math.min(RELAY_POLICY.leaseDurationMs, lease.expiresAt - lease.serverNow) - RELAY_POLICY.localWatchdogIntervalMs;
            if (deadline <= lastNow) {
                stop();
                return false;
            }
            identity = lease;
            lastSentAt = sentAt;
            authorityUntil = deadline;
            return true;
        },
        check,
        stop,
    };
}
