import * as Sentry from "@sentry/node";
import zod from "zod";

export class Ok<T> {
  readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  map = <U>(fn: (value: T) => U): Ok<U> => new Ok(fn(this.value));
  flatMap = <U>(fn: (value: T) => Result<U>): Result<U> => fn(this.value);
  catch = <U>(_: (error: never) => U): Ok<T> => this;
  toPromise = (): Promise<T> => Promise.resolve(this.value);
}

export class Err {
  private readonly error: Error;

  constructor(error: Error | string) {
    this.error = typeof error === "string" ? new Error(error) : error;
  }

  map = <U>(_: (value: never) => U): Err => this;
  flatMap: <U>(_: (value: never) => Result<U>) => Result<U> = () => this;
  catch: <U>(fn: (error: Error) => U) => Ok<U> = fn => new Ok(fn(this.error));
  toPromise = (): Promise<never> => Promise.reject(this.error);
}

export type Result<T> = Ok<T> | Err;

export const safeParse = <T extends zod.ZodType>(
  value: unknown,
  schema: T
): Result<zod.infer<T>> => {
  const { data, success, error } = schema.safeParse(value);
  if (success) {
    return new Ok(data);
  }

  Sentry.captureException(error);
  return new Err(error);
};

/**
 * Fast deep equality check for comparing objects
 * Optimized for nested objects with primitives, arrays, and objects
 *
 * Performance: ~3-10x faster than JSON.stringify for typical objects
 * Handles: primitives, objects, arrays, null/undefined
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns true if values are deeply equal, false otherwise
 *
 * @example
 * deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }) // true
 * deepEqual([1, 2, 3], [1, 2, 3]) // true
 * deepEqual({ a: 1 }, { a: 2 }) // false
 */
export function fastDeepEqual<T = unknown>(a: T, b: T): boolean {
  // Same reference = equal
  if (a === b) return true;

  // Fast path: check if both are primitives or one is null/undefined
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return a === b;
  }

  // Array comparison
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!fastDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // One is array, other is object = not equal
  if (Array.isArray(a) || Array.isArray(b)) {
    return false;
  }

  // Object comparison
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);

  // Different number of properties = different objects
  if (keysA.length !== keysB.length) {
    return false;
  }

  // Check each property
  for (const key of keysA) {
    const valA = (a as Record<string, unknown>)[key];
    const valB = (b as Record<string, unknown>)[key];

    if (!fastDeepEqual(valA, valB)) {
      return false;
    }
  }

  return true;
}

export const filterDict = <K extends PropertyKey, V>(
  obj: Record<K, V>,
  fn: (key: K, value: V) => boolean
): Record<K, V> =>
  Object.fromEntries(
    Object.entries(obj).filter(([key, value]) => fn(key as K, value as V))
  ) as Record<K, V>;

export const mapDict = <K extends PropertyKey, V, U>(
  obj: Record<K, V>,
  fn: (key: K, value: V) => [K, U]
): Record<K, U> =>
  Object.fromEntries(
    Object.entries(obj).map(([key, value]) => fn(key as K, value as V))
  ) as Record<K, U>;

export const cloak = (str: string, unmaskedChars = 4): string => {
  if (str.length <= unmaskedChars) {
    return "*".repeat(str.length);
  }
  const maskedPart = "*".repeat(str.length - unmaskedChars);
  const unmaskedPart = str.slice(-unmaskedChars);
  return maskedPart + unmaskedPart;
};

// Merges multiple objects into one, can be passed to reduce directly
export const mergeDicts = <T extends object, U>(
  target: T,
  source: U | undefined
): T & U => Object.assign(target, source);

export const truncate = (value: unknown, maxLength: number): string => {
  let str: string;
  try {
    str = JSON.stringify(value);
  } catch {
    str = String(value);
  }

  return str && str.length <= maxLength ? str : str.slice(0, maxLength) + "...";
};
