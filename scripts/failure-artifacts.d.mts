export declare function redactLine(value: unknown): string;
export declare function createRunDir(prefix: string): Promise<string>;
export interface PageCapture {
  errors: string[];
  save(dir: string, name: string): Promise<{ screenshot: string; consoleLog: string; trace: string | undefined }>;
  discard(): Promise<void>;
}
export declare function capturePage(page: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, listener: (...args: any[]) => void): unknown;
  screenshot(options: { path: string }): Promise<unknown>;
  context(): { tracing: { start(options?: unknown): Promise<unknown>; stop(options?: unknown): Promise<unknown> } };
}): Promise<PageCapture>;
