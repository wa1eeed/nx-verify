'use client';

import { useState, type ReactElement } from 'react';

/**
 * The checks a person ticks, and what ticking them will cost, as they tick.
 *
 * Plain checkboxes inside the form, so the form works and submits the same without
 * script; the running total is what script adds. A check that cannot run is shown and
 * disabled with its reason, never hidden: "not in your package" is a sentence somebody can
 * act on, and a missing row is not.
 */

export interface CheckOption {
  productCode: string;
  nameAr: string;
  sectionAr: string;
  /** Excluding VAT. Null when the check comes out of the package or has no price. */
  unitPriceHalalas: number | null;
  checked: boolean;
  disabledReasonAr: string | null;
  /** A line under the name, such as "one call per manager". */
  noteAr?: string | null;
}

const RIYALS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CheckList({
  options,
  fromPackage,
  capacityRemaining,
}: {
  options: CheckOption[];
  /** True when the subscriber's package still has operations left this term. */
  fromPackage: boolean;
  capacityRemaining: number | null;
}): ReactElement {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(options.filter((option) => option.checked && option.disabledReasonAr === null).map((option) => option.productCode)),
  );

  const toggle = (code: string, on: boolean): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) {
        next.add(code);
      } else {
        next.delete(code);
      }
      return next;
    });
  };

  const chosen = options.filter((option) => selected.has(option.productCode));
  const total = chosen.reduce((sum, option) => sum + (option.unitPriceHalalas ?? 0), 0);

  return (
    <div className="stack" style={{ gap: 'var(--s-3)' }} data-role="check-list">
      <ul className="check-list">
        {options.map((option) => {
          const disabled = option.disabledReasonAr !== null;
          return (
            <li key={option.productCode}>
              <label className="check-item" data-disabled={disabled ? 'yes' : 'no'} data-check={option.productCode}>
                <input
                  type="checkbox"
                  name="checks"
                  value={option.productCode}
                  defaultChecked={option.checked && !disabled}
                  disabled={disabled}
                  onChange={(event) => toggle(option.productCode, event.target.checked)}
                />
                <span className="stack" style={{ gap: 2 }}>
                  <strong style={{ color: 'var(--ink)', fontSize: 14 }}>{option.nameAr}</strong>
                  <span className="faint">
                    {[option.sectionAr, option.noteAr, disabled ? option.disabledReasonAr : null].filter((part) => part).join(' · ')}
                  </span>
                </span>
                <span className="muted">
                  {fromPackage ? (
                    'من الباقة'
                  ) : option.unitPriceHalalas === null ? (
                    ''
                  ) : (
                    <>
                      <bdi dir="ltr" className="mono">
                        {RIYALS.format(option.unitPriceHalalas / 100)}
                      </bdi>{' '}
                      ريال
                    </>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="check-total" data-role="check-total" aria-live="polite">
        <span>
          <strong>
            <bdi dir="ltr" className="mono">
              {chosen.length}
            </bdi>{' '}
            {chosen.length === 1 ? 'عملية تحقق' : 'عمليات تحقق'}
          </strong>
          <span className="faint"> · عملية المدير تتكرر لكل مدير</span>
        </span>
        <span className="muted">
          {fromPackage ? (
            <>
              تُحتسب من باقتك
              {capacityRemaining !== null ? (
                <>
                  {' '}
                  (المتبقي{' '}
                  <bdi dir="ltr" className="mono">
                    {capacityRemaining}
                  </bdi>
                  )
                </>
              ) : null}
            </>
          ) : (
            <>
              التكلفة التقديرية{' '}
              <bdi dir="ltr" className="mono">
                {RIYALS.format(total / 100)}
              </bdi>{' '}
              ريال قبل الضريبة
            </>
          )}
        </span>
      </div>
    </div>
  );
}
