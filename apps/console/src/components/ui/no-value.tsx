import type { ReactElement, ReactNode } from 'react';

/**
 * A cell with nothing in it, saying so in words.
 *
 * Never a blank and never a zero. «لا نداءات» is not «0 مللي ثانية», «لا إيراد» is not «0%»,
 * and «بلا حد» is not an empty box: a figure printed where there is no figure is read as a
 * measurement, and somebody will go on to average it.
 */
export function NoValue({ children }: { children: ReactNode }): ReactElement {
  return <span className="muted">{children}</span>;
}
