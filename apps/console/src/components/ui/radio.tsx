import type { ComponentProps, ReactElement, ReactNode } from 'react';

/**
 * One option of a choice (`.radio` with its `.dot`).
 *
 * A native radio hidden inside its label: it submits with its form and moves with the arrow
 * keys. The dot fills with the accent when chosen, and keyboard focus is the sheet's
 * `:focus-visible` ring around it.
 */
export type RadioProps = Omit<
  ComponentProps<'input'>,
  'type' | 'className' | 'style' | 'children'
> & {
  children: ReactNode;
};

export function Radio({ children, ...rest }: RadioProps): ReactElement {
  return (
    <label className="radio">
      <input {...rest} type="radio" />
      <span className="dot" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}
