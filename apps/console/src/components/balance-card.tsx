import type { ReactElement } from 'react';
import { ButtonLink } from './ui/button';
import { Ltr } from './ui/ltr';
import { ProgressBar } from './ui/progress-bar';

/**
 * What is left to spend, at the foot of the sidebar on every screen (README, screen 01).
 *
 * A package counts operations, so the card counts operations and draws how much of the
 * package is left. A subscriber without one pays from the wallet, and then the card shows
 * riyals before VAT, because an operation count would be a number they never bought.
 */

export type BalanceView =
  | { kind: 'operations'; remaining: number; included: number }
  | { kind: 'wallet'; availableHalalas: number };

const COUNT = new Intl.NumberFormat('en-US');
const RIYALS = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function BalanceCard({ balance }: { balance: BalanceView }): ReactElement {
  return (
    <section className="balance-card" aria-labelledby="balance-title" data-role="balance-card">
      <h2 className="balance-label" id="balance-title">
        الرصيد المتبقي
      </h2>
      {balance.kind === 'operations' ? (
        <>
          <p className="balance-value">
            <Ltr>{COUNT.format(balance.remaining)}</Ltr>
          </p>
          <p className="balance-unit">عملية تحقق</p>
          <ProgressBar
            value={balance.remaining}
            max={balance.included}
            label="المتبقي من عمليات الباقة"
          />
        </>
      ) : (
        <>
          <p className="balance-value">
            <Ltr>{RIYALS.format(balance.availableHalalas / 100)}</Ltr>
          </p>
          <p className="balance-unit">ريال قبل الضريبة</p>
        </>
      )}
      <ButtonLink href="/billing" block>
        شراء رصيد
      </ButtonLink>
    </section>
  );
}
