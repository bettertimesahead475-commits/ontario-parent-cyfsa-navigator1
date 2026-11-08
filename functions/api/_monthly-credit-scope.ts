export function monthlyCreditScope(issuedAt: string, now: Date): string {
  const issued = new Date(issuedAt);
  if (!Number.isFinite(issued.getTime()) || !Number.isFinite(now.getTime()) || issued > now) {
    throw new Error('Invalid billing cycle');
  }
  const anchor = (k: number): number => {
    const y = issued.getUTCFullYear();
    const m = issued.getUTCMonth() + k;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(issued.getUTCDate(), lastDay),
      issued.getUTCHours(), issued.getUTCMinutes(), issued.getUTCSeconds(), issued.getUTCMilliseconds());
  };
  let k = Math.max(0, (now.getUTCFullYear() - issued.getUTCFullYear()) * 12 + now.getUTCMonth() - issued.getUTCMonth());
  while (k > 0 && anchor(k) > now.getTime()) k--;
  while (anchor(k + 1) <= now.getTime()) k++;
  return 'period:' + new Date(anchor(k)).toISOString().slice(0, 10);
}
