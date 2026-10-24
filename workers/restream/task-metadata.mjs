import {
  validateAllocationSnapshot,
  validateTaskMetadata,
} from "./worker-allocation.mjs";
/** Only the ECS agent's link-local v4 endpoint, never an event/client URL. */
export async function readTaskMetadata({
  uri = process.env.ECS_CONTAINER_METADATA_URI_V4,
  fetchImpl = fetch,
} = {}) {
  const url = new URL(uri);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "169.254.170.2" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/v4\/[a-zA-Z0-9-]+$/.test(url.pathname)
  )
    throw Error("Invalid ECS metadata endpoint");
  async function get(suffix) {
    const response = await fetchImpl(`${url.href}${suffix}`, {
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });
    if (!response.ok) throw Error("ECS metadata unavailable");
    const reader = response.body.getReader();
    let size = 0,
      text = "";
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw Error("ECS metadata too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  }
  const [task, container] = await Promise.all([get("/task"), get("")]);
  return { task, container };
}
export function createManagedAllocationValidator({ expected, metadata }) {
  const frozen = validateAllocationSnapshot(expected);
  validateTaskMetadata(frozen, metadata);
  return (configuration) => {
    const actual = validateAllocationSnapshot(configuration);
    if (JSON.stringify(actual) !== JSON.stringify(frozen))
      throw Error("Immutable worker allocation/settings changed");
    return actual.allocation;
  };
}
