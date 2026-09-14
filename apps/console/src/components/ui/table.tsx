import type { ReactElement, ReactNode, ThHTMLAttributes } from 'react';

/**
 * A data table (`.table`): the sheet's header and row rules, headers at the start of the line
 * as Arabic reads, and a scrolling container so a wide table never widens the page.
 *
 * Rows and cells are plain `tr` and `td`; the header cell is a component only so that it is
 * always scoped to its column.
 */
export function Table({
  label,
  caption,
  children,
}: {
  /** What the table lists, for screen readers when no visible heading names it. */
  label?: string | undefined;
  caption?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="table-scroll">
      <table className="table" aria-label={label}>
        {caption === undefined || caption === null ? null : (
          <caption className="visually-hidden">{caption}</caption>
        )}
        {children}
      </table>
    </div>
  );
}

export function Th({
  scope = 'col',
  children,
  ...rest
}: Omit<ThHTMLAttributes<HTMLTableCellElement>, 'className' | 'style'>): ReactElement {
  return (
    <th {...rest} scope={scope}>
      {children}
    </th>
  );
}
