import type { ReactElement } from 'react';

/**
 * Numbers, identifiers and IBANs.
 *
 * The page is right to left, and these are not. Rendering a commercial registration
 * number inside an RTL run reorders its digits on screen for some values, which is how a
 * compliance officer reads back the wrong number over the phone. So every one of them is
 * wrapped in an explicit dir="ltr" element in a monospace face, exactly as CLAUDE.md
 * requires.
 */
export function Identifier({ value, label }: { value: string; label?: string }): ReactElement {
  return (
    <span className="row">
      {label ? <span className="muted">{label}</span> : null}
      <bdi dir="ltr" className="mono">
        {value}
      </bdi>
    </span>
  );
}

/** Currency, always in riyals and always left to right. */
export function Money({ amount }: { amount: number }): ReactElement {
  return (
    <span className="row">
      <bdi dir="ltr" className="mono">
        {amount.toFixed(2)}
      </bdi>
      <span>ريال</span>
    </span>
  );
}
