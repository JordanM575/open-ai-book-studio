export interface CheckInput {
  record: unknown;
  artifactName: string;
  artifactSha256: string;
  artifactBytes: number;
  about?: { version?: string; commit?: string; signingStatus?: string };
}
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}
export declare function checkRelease(input: CheckInput): CheckResult[];
