import zod from "zod";

export const safeParse = <T extends zod.ZodType>(
  value: unknown,
  schema: T
): Promise<zod.infer<T>> =>
  new Promise((resolve, reject) => {
    const { data, success, error } = schema.safeParse(value);
    return success ? resolve(data) : reject(error);
  });

export const setNested = (
  [key, ...rest]: string[],
  object: Record<string, unknown>,
  value: unknown
): unknown => {
  if (rest.length === 0) {
    object[key] = value;
    return;
  }

  if (object[key] === undefined) {
    object[key] = {};
  }
  return setNested(rest, object[key] as Record<string, unknown>, value);
};
