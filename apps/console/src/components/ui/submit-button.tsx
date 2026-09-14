'use client';

import type { ReactElement } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from './button';

/**
 * The submit button of a form bound to a server action.
 *
 * It reads its own form's status, so while the action runs it is disabled and marked busy
 * without the screen holding any state, and a second press sends nothing.
 */
export function SubmitButton({
  pendingLabel,
  children,
  ...rest
}: Omit<ButtonProps, 'type' | 'pending'> & {
  /** What the button says while the action runs, such as «جارٍ التحقق». */
  pendingLabel?: string | undefined;
}): ReactElement {
  const { pending } = useFormStatus();
  return (
    <Button {...rest} type="submit" pending={pending}>
      {pending && pendingLabel !== undefined ? pendingLabel : children}
    </Button>
  );
}
