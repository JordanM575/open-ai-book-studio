/**
 * Stands in for zod's `v4/core/json-schema-processors.js` in the browser build (D-188); see
 * `zod-to-json-schema.ts`. zod assigns these processors when it builds a schema and calls them
 * only to emit JSON Schema. `aggregateChecks` also backs getters such as `minLength` and `format`,
 * which the studio does not read. Each export refuses if anything calls it.
 */
import { refuseJsonSchema as refuse } from "./zod-to-json-schema";

export const aggregateChecks = refuse;
export const allProcessors: Record<string, never> = new Proxy({}, { get: refuse });
export const toJSONSchema = refuse;
export const anyProcessor = refuse;
export const arrayProcessor = refuse;
export const bigintProcessor = refuse;
export const booleanProcessor = refuse;
export const catchProcessor = refuse;
export const customProcessor = refuse;
export const dateProcessor = refuse;
export const defaultProcessor = refuse;
export const enumProcessor = refuse;
export const fileProcessor = refuse;
export const functionProcessor = refuse;
export const intersectionProcessor = refuse;
export const lazyProcessor = refuse;
export const literalProcessor = refuse;
export const mapProcessor = refuse;
export const nanProcessor = refuse;
export const neverProcessor = refuse;
export const nonoptionalProcessor = refuse;
export const nullProcessor = refuse;
export const nullableProcessor = refuse;
export const numberProcessor = refuse;
export const objectProcessor = refuse;
export const optionalProcessor = refuse;
export const pipeProcessor = refuse;
export const prefaultProcessor = refuse;
export const promiseProcessor = refuse;
export const readonlyProcessor = refuse;
export const recordProcessor = refuse;
export const setProcessor = refuse;
export const stringProcessor = refuse;
export const successProcessor = refuse;
export const symbolProcessor = refuse;
export const templateLiteralProcessor = refuse;
export const transformProcessor = refuse;
export const tupleProcessor = refuse;
export const undefinedProcessor = refuse;
export const unionProcessor = refuse;
export const unknownProcessor = refuse;
export const voidProcessor = refuse;
