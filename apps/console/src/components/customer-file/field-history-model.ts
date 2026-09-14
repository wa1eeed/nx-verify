/**
 * A field's past told in stretches (field-history.tsx): each value once, newest first, with the
 * first and last time it was seen and how many verifications saw it.
 */

export interface HistoryStretch {
  valueAr: string;
  /** The oldest and newest time this value was seen in the stretch. */
  from: string;
  to: string;
  count: number;
  authority: string | null;
  current: boolean;
}

export interface HistoryPoint {
  value: unknown;
  valueAr: string;
  observedAt: string;
  authority: string | null;
}

/** `history` is the past without the current value, newest first, as the page reads it. */
export function historyStretches(
  current: HistoryPoint,
  history: readonly HistoryPoint[],
): HistoryStretch[] {
  const same = (left: unknown, right: unknown): boolean =>
    JSON.stringify(left) === JSON.stringify(right);
  const stretches: { value: unknown; stretch: HistoryStretch }[] = [
    {
      value: current.value,
      stretch: {
        valueAr: current.valueAr,
        from: current.observedAt,
        to: current.observedAt,
        count: 1,
        authority: current.authority,
        current: true,
      },
    },
  ];
  for (const entry of history) {
    const last = stretches[stretches.length - 1];
    if (last !== undefined && same(last.value, entry.value)) {
      last.stretch.from = entry.observedAt;
      last.stretch.count += 1;
    } else {
      stretches.push({
        value: entry.value,
        stretch: {
          valueAr: entry.valueAr,
          from: entry.observedAt,
          to: entry.observedAt,
          count: 1,
          authority: entry.authority,
          current: false,
        },
      });
    }
  }
  return stretches.map((entry) => entry.stretch);
}
