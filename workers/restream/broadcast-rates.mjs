/** Server-owned AWS Fargate Linux/x86 On-Demand reference, checked 2026-10-22.
 * Source: https://aws.amazon.com/fargate/pricing/
 * Allocation pricing only: excludes transfer, IPv4, logs, extra storage,
 * provider subscriptions, taxes and discounts. No account/billing data or IO.
 */
export const COMPUTE_RATE_SOURCE = "https://aws.amazon.com/fargate/pricing/";
/** @param {{region?:string,os?:string,architecture?:string,purchaseModel?:string,allocation?:{cpuUnits:number,memoryMiB:number}}} input
 * @returns {{usdPerHour:number,rateDate:string,currency:'USD',scope:'cpu_memory'}|undefined}
 */
export function estimateComputeRate({
  region,
  os,
  architecture,
  purchaseModel,
  allocation,
}) {
  if (
    region !== "us-east-1" ||
    os !== "linux" ||
    architecture !== "x86_64" ||
    purchaseModel !== "on_demand" ||
    !allocation
  )
    return undefined;
  const { cpuUnits, memoryMiB } = allocation;
  if (
    !Number.isSafeInteger(cpuUnits) ||
    cpuUnits <= 0 ||
    !Number.isSafeInteger(memoryMiB) ||
    memoryMiB <= 0
  )
    return undefined;
  return {
    usdPerHour: (cpuUnits / 1024) * 0.04048 + (memoryMiB / 1024) * 0.004445,
    rateDate: "2026-10-22",
    currency: "USD",
    scope: "cpu_memory",
  };
}
