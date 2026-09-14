'use client';

import { useEffect, type ReactElement } from 'react';
import { useFormStatus } from 'react-dom';
import { holdActivity } from '../../lib/navigation-activity';
import { Button, type ButtonProps } from './button';

/**
 * The submit button of a form bound to a server action.
 *
 * It reads its own form's status, so while the action runs it is disabled and marked busy
 * without the screen holding any state, and a second press sends nothing. While it runs it
 * also holds the console busy, so the bar along the top of the window moves until the action
 * and whatever it refreshes are done, and the sidebar reads its facts again afterwards.
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

  useEffect(() => (pending ? holdActivity('action') : undefined), [pending]);

  return (
    <Button {...rest} type="submit" pending={pending}>
      {pending && pendingLabel !== undefined ? pendingLabel : children}
    </Button>
  );
}
