/**
 * Stands in for zod's `v4/core/to-json-schema.js` in the browser build (D-188).
 *
 * zod attaches JSON Schema output to every schema it builds, so the bundler cannot leave the
 * emitter out by itself. Only the desktop agent turns schemas into JSON Schema, for its tool
 * definitions. Reading a schema's `~standard` still calls the two factories, so they hand back a
 * method; the method, like every other export here, refuses if anything calls it.
 */
export const JSON_SCHEMA_DESKTOP_ONLY =
  "JSON Schema output and zod's check getters are left out of the browser build (D-188).";

export function refuseJsonSchema(): never {
  throw new Error(JSON_SCHEMA_DESKTOP_ONLY);
}

export const createToJSONSchemaMethod = () => refuseJsonSchema;
export const createStandardJSONSchemaMethod = () => refuseJsonSchema;
export const initializeContext = refuseJsonSchema;
export const handleUnrepresentable = refuseJsonSchema;
export const processSchema = refuseJsonSchema;
export const extractDefs = refuseJsonSchema;
export const finalize = refuseJsonSchema;
export { processSchema as process };
