import type { ComponentProps, ReactElement } from 'react';
import { Icon } from './icon';

/**
 * A choice from a list (`.input` with a chevron), a pill like every field in this frame.
 *
 * The native select, so the list opens the way the reader's device opens lists and a screen
 * reader announces it as one. The chevron is a drawing beside it and takes no pointer.
 */
export type SelectProps = Omit<ComponentProps<'select'>, 'className' | 'style'>;

export function Select({ children, ...rest }: SelectProps): ReactElement {
  return (
    <span className="select">
      <select {...rest} className="input">
        {children}
      </select>
      <span className="select-chevron" aria-hidden="true">
        <Icon name="chevron-down" size={14} />
      </span>
    </span>
  );
}
