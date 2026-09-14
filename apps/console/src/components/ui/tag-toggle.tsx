'use client';

import { useState, type ReactElement } from 'react';
import type { TagTone } from './tag';

/**
 * A tag that is also a switch: «مفعّل» and «موقوف» on a product row, a section required or
 * optional for a kind of file (handoff screen 05).
 *
 * A native checkbox, hidden inside the tag, so it submits with its form, answers the space bar
 * and is read as a switch; the tag is only a drawing of it. The words and the tone change with
 * the state, so the state is never carried by colour alone. Hover, pressed and the
 * `:focus-visible` ring come from the product sheet.
 */
export function TagToggle({
  name,
  value,
  form,
  defaultChecked,
  on,
  off,
  onTone = 'accent-2',
  offTone = 'neutral',
  label,
  role,
}: {
  name: string;
  value: string;
  /** The form it submits with, when the tag sits outside it. */
  form?: string | undefined;
  defaultChecked: boolean;
  on: string;
  off: string;
  onTone?: TagTone | undefined;
  offTone?: TagTone | undefined;
  /** What the switch decides, for screen readers: the tag's words say only its state. */
  label: string;
  role?: string | undefined;
}): ReactElement {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <label className={`tag tag-${checked ? onTone : offTone} tag-toggle`} data-role={role}>
      <input
        type="checkbox"
        role="switch"
        name={name}
        value={value}
        form={form}
        checked={checked}
        aria-label={label}
        onChange={(event) => setChecked(event.target.checked)}
      />
      {checked ? on : off}
    </label>
  );
}
