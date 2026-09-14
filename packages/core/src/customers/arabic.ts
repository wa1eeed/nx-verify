/**
 * Counting in Arabic.
 *
 * A number beside a noun changes the noun: one, two, three to ten, and eleven and above
 * each take a different form, and a sentence that ignores that reads like a machine wrote
 * it. These are the few counted nouns a customer file speaks in.
 */

function counted(
  n: number,
  forms: { one: string; two: string; few: (n: number) => string; many: (n: number) => string },
): string {
  if (n === 1) {
    return forms.one;
  }
  if (n === 2) {
    return forms.two;
  }
  return n >= 3 && n <= 10 ? forms.few(n) : forms.many(n);
}

/** "another establishment", "two other establishments", "3 other establishments". */
export function otherBusinesses(n: number): string {
  return counted(n, {
    one: 'منشأة أخرى',
    two: 'منشأتين أخريين',
    few: (count) => `${count} منشآت أخرى`,
    many: (count) => `${count} منشأة أخرى`,
  });
}

/** "one establishment", "two establishments", "3 establishments". */
export function businesses(n: number): string {
  return counted(n, {
    one: 'منشأة واحدة',
    two: 'منشأتين',
    few: (count) => `${count} منشآت`,
    many: (count) => `${count} منشأة`,
  });
}

/** "another customer", "two other customers", "3 other customers". */
export function otherCustomers(n: number): string {
  return counted(n, {
    one: 'عميل آخر',
    two: 'عميلين آخرين',
    few: (count) => `${count} عملاء آخرين`,
    many: (count) => `${count} عميلاً آخر`,
  });
}

/** "a detected change", "two detected changes", "3 detected changes". */
export function detectedChanges(n: number): string {
  return counted(n, {
    one: 'تغيّر مرصود',
    two: 'تغيّران مرصودان',
    few: (count) => `${count} تغيّرات مرصودة`,
    many: (count) => `${count} تغيّراً مرصوداً`,
  });
}

/** "a day", "two days", "3 days", "11 days". */
export function daysCount(n: number): string {
  return counted(n, {
    one: 'يوم واحد',
    two: 'يومين',
    few: (count) => `${count} أيام`,
    many: (count) => `${count} يوماً`,
  });
}
