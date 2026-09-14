import type { ReactElement } from 'react';

/**
 * The data loader (unit C4, ADR-120): a small live chart and the name of what is on its way.
 *
 * Drawn as a pill like every control here, with four bars rising and falling out of step in
 * the two colours of the system, sage and terracotta, as a market chart moves while it fills.
 * It names the screen being fetched rather than saying «loading», because «قائمة العملاء»
 * tells a person the click was understood and where it is taking them.
 *
 * It appears a moment after it is mounted, so a screen that arrives at once never flashes it,
 * and a person who asked their system for less motion gets the same chart standing still.
 * The words are a polite status, read once by a screen reader; the chart is decoration.
 */
export function DataLoader({
  title,
  detail,
}: {
  /** What is being fetched, such as «قائمة العملاء». */
  title: string;
  /** How it is going, such as «نجلب أحدث البيانات». */
  detail: string;
}): ReactElement {
  return (
    <div className="data-loader" role="status" aria-live="polite" data-role="data-loader">
      <span className="data-loader-chart" aria-hidden="true">
        <span className="data-loader-bar" />
        <span className="data-loader-bar" />
        <span className="data-loader-bar" />
        <span className="data-loader-bar" />
      </span>
      <span className="data-loader-text">
        <span className="data-loader-title">{title}</span>
        <span className="data-loader-detail">{detail}</span>
      </span>
    </div>
  );
}

/** What the loader says, written once. */
export const LOADER_WORDS = {
  fetching: 'نجلب أحدث البيانات',
  refreshing: 'نحدّث النتائج',
  slow: 'يستغرق أطول من المعتاد، البيانات في الطريق',
} as const;

/** After this long, the loader says so rather than repeating itself. */
export const SLOW_AFTER_MS = 6_000;
