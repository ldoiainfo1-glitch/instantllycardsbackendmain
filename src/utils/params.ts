/** Safely convert Express route param (string | string[]) to number */
export function paramInt(val: string | string[] | undefined): number {
  return parseInt(Array.isArray(val) ? val[0] : val ?? '0', 10);
}

/** Safely convert Express query param to string */
export function queryStr(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}

/** Safely convert Express query param to int */
export function queryInt(val: unknown, def: number): number {
  const s = queryStr(val);
  if (!s) return def;
  const n = parseInt(s, 10);
  return isNaN(n) ? def : n;
}

/** Safely convert Express query param to float */
export function queryFloat(val: unknown, def: number): number {
  const s = queryStr(val);
  if (!s) return def;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : def;
}

