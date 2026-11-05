import { createRelayRegistry, type RegistryOptions } from "./registry";
/** Bootable composition boundary. Deployment supplies authenticated control, object storage,
 * and native-demand adapters; default packager and cgroup sampler are real implementations. */
export function startRelayWorker(options: RegistryOptions) {
  const registry = createRelayRegistry(options);
  const onStop = () => {
    void stop();
  };
  process.once("SIGTERM", onStop);
  process.once("SIGINT", onStop);
  let stopping: Promise<void> | undefined;
  function stop() {
    if (stopping) return stopping;
    process.removeListener("SIGTERM", onStop);
    process.removeListener("SIGINT", onStop);
    stopping = registry.stop();
    return stopping;
  }
  registry.reconcile();
  return { reconcile: registry.reconcile, drain: registry.drain, stop };
}
