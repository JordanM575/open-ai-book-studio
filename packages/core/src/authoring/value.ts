/** Internal value validation, not a file parser or a wire serializer. */
export class AuthoringError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AuthoringError';
  }
}

export function requireValue(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AuthoringError(code);
}

export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) &&
    !Object.is(value, -0) && value >= min && value <= max, 'invalid-integer');
  return value;
}

export function add(a: number, b: number): number {
  return integer(integer(a) + integer(b));
}

export function text(value: unknown, maxUnits = 20_000, maxBytes = 65_536): asserts value is string {
  requireValue(typeof value === 'string' && value.length <= maxUnits, 'invalid-text');
  // TextEncoder would silently replace lone surrogates. Refuse instead.
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i);
      requireValue(low >= 0xdc00 && low <= 0xdfff, 'invalid-unicode');
    } else requireValue(unit < 0xdc00 || unit > 0xdfff, 'invalid-unicode');
  }
  requireValue(new TextEncoder().encode(value).length <= maxBytes, 'text-overflow');
}

export function id(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value), 'invalid-id');
}

export function digest(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'invalid-digest');
}

export type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

/** Copies only ordinary lossless data; never evaluates getters/toJSON or freezes caller objects.
 * Byte accounting includes JSON escaping, but the resulting string is never a persisted format.
 * Raw duplicate keys/numeric lexemes/UTF-8 must be checked by the future wire reader (T018).
 */
export function copyValue<T>(input: T, maxBytes = 2_500_000): T {
  return copyData(input, maxBytes, 64);
}

/** Internal factory snapshots only, never external record admission or rehydration.
 * A validated record may sit under three aggregate wrappers (reservations[].request).
 * Graph/policy/command/receipt/clock admission retains its independent depth-64 limit.
 */
export function copySnapshot<T>(input: T): T {
  return copyData(input, Number.MAX_SAFE_INTEGER, 64 + 3);
}

function copyData<T>(input: T, maxBytes: number, maxDepth: number): T {
  let bytes = 0;
  const active = new Set<object>();
  const charge = (count: number) => {
    bytes += count;
    requireValue(bytes <= maxBytes, 'value-overflow');
  };
  const visit = (value: unknown, depth: number): unknown => {
    requireValue(depth <= maxDepth, 'value-depth');
    if (value === null || typeof value === 'boolean') {
      charge(value === null || value === true ? 4 : 5);
      return value;
    }
    if (typeof value === 'number') {
      requireValue(Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER &&
        !Object.is(value, -0), 'lossy-number');
      charge(String(value).length);
      return value;
    }
    if (typeof value === 'string') {
      text(value, maxBytes, maxBytes);
      charge(new TextEncoder().encode(JSON.stringify(value)).length);
      return value;
    }
    requireValue(typeof value === 'object' && value !== null, 'non-data-value');
    const array = Array.isArray(value);
    requireValue(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype) ||
      (!array && Object.getPrototypeOf(value) === null), 'non-plain-value');
    requireValue(!active.has(value), 'cyclic-value');
    active.add(value);
    const keys = Reflect.ownKeys(value);
    if (array) {
      requireValue(keys.length === value.length + 1, 'sparse-or-extended-array');
      charge(2 + Math.max(0, value.length - 1));
      const result: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const property = Object.getOwnPropertyDescriptor(value, String(i));
        requireValue(property && 'value' in property && property.enumerable, 'non-data-property');
        result.push(visit(property.value, depth + 1));
      }
      active.delete(value);
      return result;
    }
    charge(2 + Math.max(0, keys.length - 1));
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      requireValue(typeof key === 'string', 'symbol-property');
      text(key, maxBytes, maxBytes);
      charge(new TextEncoder().encode(JSON.stringify(key)).length + 1);
      const property = Object.getOwnPropertyDescriptor(value, key);
      requireValue(property && 'value' in property && property.enumerable, 'non-data-property');
      Object.defineProperty(result, key, {
        value: visit(property.value, depth + 1), enumerable: true, writable: true, configurable: true,
      });
    }
    active.delete(value);
    return result;
  };
  return visit(input, 0) as T;
}

export function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** Exact structural comparison, with order-insensitive object keys. Not a cryptographic digest. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] &&
    sameValue(Reflect.get(a, key), Reflect.get(b, key)));
}
