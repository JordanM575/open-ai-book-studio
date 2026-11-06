export declare const RECORD_SCHEMA_VERSION: 1;
export declare const RECORD_JSON_SCHEMA: Record<string, unknown>;
export interface RecordArtifact {
  name: string;
  sha256: string;
  bytes: number;
}
export interface RecordSigning {
  status: "unsigned" | "signed";
  identity?: string;
  teamId?: string;
  notarization?: { status: "accepted"; staple: "valid" };
}
export interface RecordObject {
  schemaVersion: 1;
  version: string;
  commit: string;
  schema: number;
  platform: "mac" | "win" | "linux";
  arch: "arm64" | "x64";
  artifacts: RecordArtifact[];
  gates: string[];
  signing: RecordSigning;
  notarization?: { status: "accepted"; staple: "valid" };
  unsigned: boolean;
}
export declare function validateRecord(record: unknown): string[];
export declare function hashFile(path: string): Promise<{ sha256: string; bytes: number }>;
export declare function hashArtifacts(dir: string): Promise<RecordArtifact[]>;
export declare function checkFileSet(artifacts: RecordArtifact[], expected: string[] | undefined): void;
export declare function buildRecordObject(input: {
  version: string;
  commit: string;
  schema: number;
  platform: "mac" | "win" | "linux";
  arch: "arm64" | "x64";
  artifacts: RecordArtifact[];
  gates: string[];
  signing: RecordSigning;
}): RecordObject;
export declare function publishRecord(
  out: string,
  text: string,
  ops?: { link: (existing: string, next: string) => Promise<void> }
): Promise<void>;
