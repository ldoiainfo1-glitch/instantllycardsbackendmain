export function normalizePhone(raw: string): string {
  const phone = raw.trim();
  if (phone.startsWith('+91')) return phone.slice(3);
  if (phone.startsWith('+')) return phone.slice(1);
  if (phone.startsWith('91') && phone.length > 10) return phone.slice(2);
  return phone;
}

export function phoneVariants(raw: string): string[] {
  const bare = normalizePhone(raw.trim());
  return [bare, `+91${bare}`, `91${bare}`];
}
