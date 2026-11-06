import type { BuildMetadata } from "@ai-book-studio/core/build";
import type { Result, StudioError } from "@ai-book-studio/core/ipc";

/** A newer-schema refusal: the files are untouched and only the detected schema travels on. */
export interface SchemaRefusal {
  detectedSchema: number | null;
}

/**
 * Thrown by mustCompatible when the main process refused with "newer-schema".
 * Carries only the detected schema number — never the raw message, so absolute
 * library paths and file text cannot leak into the refusal journey (009 FR-048).
 */
export class SchemaRefusalError extends Error {
  readonly detectedSchema: number | null;

  constructor(detectedSchema: number | null, message: string) {
    super(message);
    this.name = "SchemaRefusalError";
    this.detectedSchema = detectedSchema;
  }
}

const SCHEMA_NUMBER_PATTERN = /\(schema (\d+)\)/;

/** Returns the refusal when the error is a newer-schema refusal, else null. */
export function asSchemaRefusal(error: StudioError): SchemaRefusal | null {
  if (error.code !== "newer-schema") return null;
  const match = SCHEMA_NUMBER_PATTERN.exec(error.message);
  return { detectedSchema: match?.[1] === undefined ? null : Number(match[1]) };
}

/**
 * Like must(), but a newer-schema failure throws SchemaRefusalError so the
 * caller can route the author to the refusal journey instead of a plain toast.
 */
export async function mustCompatible<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.data;
  const refusal = asSchemaRefusal(result.error);
  if (refusal) throw new SchemaRefusalError(refusal.detectedSchema, result.error.message);
  throw new Error(result.error.message);
}

/**
 * The user-reviewed local support summary (009 FR-048): build identity,
 * compatibility outcome and failure reason. Built only from build metadata and
 * schema numbers — no manuscript text, no credentials, no absolute paths, and
 * nothing is sent anywhere; the author copies it only if they choose to.
 */
export function buildSupportSummary(build: BuildMetadata, detectedSchema: number | null): string {
  return [
    "Open Book Studio support summary",
    "This summary stays on this device. Nothing is sent anywhere.",
    `App version: ${build.version} (commit ${build.commit})`,
    `Build: ${build.target}, ${build.platform}, ${build.arch}`,
    `Signing: ${build.signing.status === "signed" ? `Signed — ${build.signing.identity ?? "unknown identity"}` : "Unsigned"}`,
    `Library schema: this build supports ${build.schemaVersion}, these files use ${detectedSchema ?? "a newer version"}`,
    "Outcome: refused before any write (newer schema)"
  ].join("\n");
}
