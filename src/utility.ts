import zod from "zod";

export const safeParse = <T extends zod.ZodType>(
  value: unknown,
  schema: T
): Promise<zod.infer<T>> =>
  new Promise((resolve, reject) => {
    const { data, success, error } = schema.safeParse(value);
    return success ? resolve(data) : reject(error);
  });
