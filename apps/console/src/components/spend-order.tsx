import type { ReactElement } from 'react';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';

/**
 * Where a verification is paid from, and in what order (ADR-161).
 *
 * The platform sells four things that all look like «credit»: a plan with transactions
 * included, prepaid bundles of operations, a wallet of riyals, and a price per check. Each
 * screen showed one of them, none said how they relate, and the result was a subscriber who
 * could not answer the only question they actually have: **if I run this check now, what does
 * it come out of, and what happens when that runs out.**
 *
 * The answer is an order, and the order is the whole model:
 *
 *   1. free      a check the platform is not charging for at all
 *   2. plan      while the plan's included transactions last
 *   3. bundle    an operation from a prepaid bundle, oldest expiring first
 *   4. wallet    riyals, at the listed price of that check
 *
 * So this is not a summary of four cards. It is one sentence with four steps, each showing
 * what is left in it, and it says which step the next verification will come out of. A
 * subscriber who reads it once never has to ask again.
 *
 * It also settles the confusion that made somebody think they had nothing: a workspace with an
 * empty wallet and a thousand bundle operations is not out of credit, it is on step three.
 */

export interface SpendStep {
  key: 'plan' | 'bundle' | 'wallet';
  titleAr: string;
  /** What is left in this step, already worded: «٤٠ من ١٠٠ عملية», «١٢٠٠٫٥٠ ر.س». */
  remainingAr: string;
  detailAr: string;
  /** True when this step has anything left in it. */
  available: boolean;
  /** True for the step the next verification comes out of. */
  next: boolean;
}

export function spendSteps(input: {
  includedTransactions: number | null;
  transactionsUsed: number;
  bundleOperations: number;
  availableHalalas: number;
}): SpendStep[] {
  const planLeft =
    input.includedTransactions === null
      ? null
      : Math.max(0, input.includedTransactions - input.transactionsUsed);
  const planHas = planLeft !== null && planLeft > 0;
  const bundleHas = input.bundleOperations > 0;
  const walletHas = input.availableHalalas > 0;

  return [
    {
      key: 'plan',
      titleAr: 'باقتك',
      remainingAr:
        planLeft === null
          ? 'لا باقة مفعّلة'
          : `${planLeft} من ${input.includedTransactions} عملية`,
      detailAr:
        planLeft === null
          ? 'الباقة اشتراك بعدد عمليات مشمولة في المدة. لا باقة لديك الآن.'
          : 'العمليات المشمولة في اشتراكك. تتجدد مع المدة، ولا يُخصم منها شيء آخر.',
      available: planHas,
      next: planHas,
    },
    {
      key: 'bundle',
      titleAr: 'حزم الرصيد',
      remainingAr: `${input.bundleOperations} عملية`,
      detailAr:
        'عمليات تشتريها مقدماً وتُصرف على أي تحقق مهما كان سعره. تنتهي بتاريخ، والأقرب انتهاءً يُصرف أولاً.',
      available: bundleHas,
      next: !planHas && bundleHas,
    },
    {
      key: 'wallet',
      titleAr: 'الرصيد بالريال',
      remainingAr: `${(input.availableHalalas / 100).toFixed(2)} ر.س`,
      detailAr: 'يُخصم منه سعر كل تحقق كما هو معروض في «أسعار المنتجات». لا ينتهي بتاريخ.',
      available: walletHas,
      next: !planHas && !bundleHas && walletHas,
    },
  ];
}

export function SpendOrder({ steps }: { steps: readonly SpendStep[] }): ReactElement {
  const nothing = steps.every((step) => !step.available);

  return (
    <Card role="spend-order" labelledBy="spend-order-title">
      <h2 className="card-title" id="spend-order-title">
        من أين تُخصم عمليات التحقق
      </h2>
      <p className="admin-card-note">
        {/*
          The order, said once, in the order it happens. Four screens each showing one of
          these taught nobody how they relate (ADR-161).
        */}
        بهذا الترتيب: ما تشمله باقتك أولاً، فإن نفد فمن حزم الرصيد، فإن نفدت فمن رصيدك بالريال
        بسعر كل تحقق.
      </p>

      <ol className="spend-order" data-role="spend-steps">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className="spend-step"
            data-step={step.key}
            data-available={step.available ? 'true' : 'false'}
            data-next={step.next ? 'true' : 'false'}
          >
            <span className="spend-step-rank" aria-hidden="true">
              {index + 1}
            </span>
            <span className="stack" style={{ gap: 0, flex: 1 }}>
              <span className="row" style={{ gap: 'var(--s-2)', alignItems: 'baseline' }}>
                <strong>{step.titleAr}</strong>
                {step.next ? (
                  <span className="badge" data-tone="accent" data-role="next-step">
                    التحقق القادم من هنا
                  </span>
                ) : null}
              </span>
              <span className="faint">{step.detailAr}</span>
            </span>
            <span className="spend-step-left mono" dir="ltr">
              <Ltr>{step.remainingAr}</Ltr>
            </span>
          </li>
        ))}
      </ol>

      {nothing ? (
        <p className="stat-hint" style={{ margin: 0 }} data-role="spend-nothing">
          لا شيء في أي من الثلاثة، فلا تعمل أي عملية تحقق حتى تشحن رصيدك.
        </p>
      ) : null}
    </Card>
  );
}
