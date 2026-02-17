import * as Sentry from "@sentry/node";
import zod from "zod";

export class Result<T> {
  private readonly isOkValue: boolean;
  private readonly value: T | Error;

  private constructor(isOkValue: boolean, value: T | Error) {
    this.isOkValue = isOkValue;
    this.value = value;
  }

  static ok = <T>(value: T): Result<T> => new Result<T>(true, value);

  static err = <T>(error: Error | string): Result<T> =>
    new Result<T>(false, error instanceof Error ? error : new Error(error));

  isOk = (): boolean => this.isOkValue;

  isErr = (): boolean => !this.isOkValue;

  map = <U>(fn: (value: T) => U | Result<U>): Result<U> => {
    if (!this.isOk()) {
      return this as unknown as Result<U>;
    }

    const result = fn(this.value as T);
    // Auto-flatten if function returns a Result (like Promise.then)
    return result instanceof Result ? result : Result.ok<U>(result as U);
  };

  getOrElse = (defaultValue: T): T =>
    this.isOk() ? (this.value as T) : defaultValue;

  expect = (message?: string): T => {
    if (this.isOk()) {
      return this.value as T;
    }
    throw message ? new Error(message) : this.value;
  };

  fold = <U>(onError: (error: Error) => U, onOk: (value: T) => U): U =>
    this.isOk() ? onOk(this.value as T) : onError(this.value as Error);

  toPromise = (): Promise<T> =>
    this.isOk()
      ? Promise.resolve(this.value as T)
      : Promise.reject(this.value as Error);
}

export const safeParse = <T extends zod.ZodType>(
  value: unknown,
  schema: T
): Result<zod.infer<T>> => {
  const { data, success, error } = schema.safeParse(value);
  if (success) {
    return Result.ok(data);
  }

  Sentry.captureException(error);
  return Result.err(error);
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

export const truncate = (value: unknown, maxLength: number): string => {
  let str: string;
  try {
    str = JSON.stringify(value);
  } catch {
    str = String(value);
  }

  return str.length <= maxLength ? str : str.slice(0, maxLength) + "...";
};
