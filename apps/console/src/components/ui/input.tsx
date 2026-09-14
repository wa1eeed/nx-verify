import type { ComponentProps, ReactElement } from 'react';

/**
 * A text field (`.input`), a pill in this frame.
 *
 * Numbers, identifiers and IBANs are typed left to right and sit where the Arabic around
 * them ends (README, direction). A field that holds one says `ltr` instead of restyling
 * itself. Hover darkens the border and keyboard focus is the sheet's `:focus-visible`
 * border in the accent.
 */
export type InputProps = Omit<ComponentProps<'input'>, 'className' | 'style'> & {
  ltr?: boolean | undefined;
  /** The value was refused. The words saying why belong to the Field around it. */
  invalid?: boolean | undefined;
};

export function Input({ ltr = false, invalid = false, ...rest }: InputProps): ReactElement {
  return (
    <input
      {...rest}
      className={ltr ? 'input input-ltr' : 'input'}
      dir={ltr ? 'ltr' : rest.dir}
      aria-invalid={invalid ? true : rest['aria-invalid']}
    />
  );
}
