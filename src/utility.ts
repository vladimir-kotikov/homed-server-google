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

  return str && str.length <= maxLength ? str : str.slice(0, maxLength) + "...";
};
