import type { ReactElement, ReactNode } from 'react';

/**
 * A label, its control, and what somebody needs to know to fill it in (`.field`).
 *
 * The screen renders the control through a function that is handed the attributes tying it
 * to its label, hint and error. A hint that no screen reader announces is a hint for sighted
 * people only, and an error not linked to its field is a sentence floating on the page.
 */

export interface FieldControl {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Why the value was refused. Present means the control is marked invalid. */
  error?: ReactNode;
  children: (control: FieldControl) => ReactNode;
}): ReactElement {
  const hintId = hint === undefined || hint === null ? null : `${id}-hint`;
  const errorId = error === undefined || error === null ? null : `${id}-error`;

  const control: FieldControl = { id };
  const describedBy = [errorId, hintId].filter((part): part is string => part !== null);
  if (describedBy.length > 0) {
    control['aria-describedby'] = describedBy.join(' ');
  }
  if (errorId !== null) {
    control['aria-invalid'] = true;
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(control)}
      {hintId === null ? null : (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {errorId === null ? null : (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
