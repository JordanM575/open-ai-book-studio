// Synthetic worker instrumentation only: run the real production handler and native NFC, without
// changing scanner scheduling or adding a cooperative boundary around normalization.
const scope = globalThis as unknown as { postMessage: (message: unknown) => void };
const normalize = String.prototype.normalize;
String.prototype.normalize = function (form?: string) {
  scope.postMessage({ kind: "test-native-enter", units: this.length });
  const result = normalize.call(this, form);
  scope.postMessage({ kind: "test-native-exit", units: this.length });
  return result;
};
// This worker is forbidden from reaching the network, even if a future analyzer import regresses.
globalThis.fetch = Object.assign(() => { throw new Error("No network in review"); }, globalThis.fetch);
await import("../../../../packages/app/src/lib/review-analysis.worker");
export {};
