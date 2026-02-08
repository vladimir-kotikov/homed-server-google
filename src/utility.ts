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
