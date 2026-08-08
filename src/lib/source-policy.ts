const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function utcDateToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Overrides expire at the beginning of reviewAfter in UTC. */
export function sourceOverrideExpired(reviewAfter: string, today = utcDateToday()): boolean {
  if (!ISO_DATE.test(reviewAfter) || !ISO_DATE.test(today)) {
    throw new Error('source override dates must use YYYY-MM-DD');
  }
  const parsed = new Date(`${reviewAfter}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== reviewAfter) {
    throw new Error('source override reviewAfter is not a real calendar date');
  }
  return reviewAfter <= today;
}
