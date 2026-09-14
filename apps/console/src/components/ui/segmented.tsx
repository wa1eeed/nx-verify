import type { ReactElement, ReactNode } from 'react';

/**
 * One choice among a few, side by side (`.seg`), such as the entity type on screen 02.
 *
 * Radios underneath: a named group that submits with its form and works before any script
 * has loaded. A screen that reacts as the choice is made passes `value` and `onChange`; a
 * screen that only submits it passes `defaultValue`. The chosen segment is filled with the
 * accent, and hover, pressed and the `:focus-visible` ring come from the sheets.
 */

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean | undefined;
}

export function Segmented<T extends string>({
  name,
  label,
  options,
  value,
  defaultValue,
  onChange,
}: {
  name: string;
  /** What the group chooses, for screen readers. The visible label sits above it. */
  label: string;
  options: readonly SegmentOption<T>[];
  value?: T | undefined;
  defaultValue?: T | undefined;
  onChange?: ((value: T) => void) | undefined;
}): ReactElement {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className="seg-opt">
          <input
            type="radio"
            name={name}
            value={option.value}
            disabled={option.disabled === true}
            {...(value === undefined
              ? { defaultChecked: option.value === defaultValue }
              : { checked: option.value === value, onChange: () => onChange?.(option.value) })}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
