import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { Icon } from './icon';

/**
 * The checkbox of screen 02: an 18px box, filled with the accent and a check when on.
 *
 * A native input, hidden inside its label, so it submits with its form, answers the space
 * bar and is read as a checkbox; the box is only a drawing of it. Hover, pressed and the
 * `:focus-visible` ring around the box come from the product sheet. A checkbox with no words
 * beside it, such as the one leading a product row, is given an aria-label by its screen.
 */
export type CheckboxProps = Omit<
  ComponentProps<'input'>,
  'type' | 'className' | 'style' | 'children'
> & {
  children?: ReactNode;
};

export function Checkbox({ children, ...rest }: CheckboxProps): ReactElement {
  return (
    <label className="check">
      <input {...rest} type="checkbox" />
      <span className="box" aria-hidden="true">
        <Icon name="check" size={13} />
      </span>
      {children === undefined ? null : <span>{children}</span>}
    </label>
  );
}
