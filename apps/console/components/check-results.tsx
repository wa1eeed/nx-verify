import type { ReactElement } from 'react';

/**
 * What a verification just did, check by check.
 *
 * Shown once, straight after the button was pressed. Every check that ran carries its
 * reference, and every check that did not says why, so nothing a person paid for or
 * expected is left to be discovered in the statement.
 */

export interface CheckResultView {
  productCode: string;
  nameAr: string;
  status: 'OK' | 'PARTIAL' | 'NOT_FOUND' | 'ERROR' | 'AWAITING' | 'SKIPPED' | 'REFUSED';
  noteAr: string | null;
  reference: string | null;
}

const STATUS: Readonly<Record<CheckResultView['status'], { label: string; tone: string }>> = {
  OK: { label: 'تمت', tone: 'fresh' },
  PARTIAL: { label: 'تمت جزئياً', tone: 'neutral' },
  NOT_FOUND: { label: 'لا توجد بيانات', tone: 'neutral' },
  ERROR: { label: 'تعذّرت', tone: 'critical' },
  AWAITING: { label: 'بانتظار الرد', tone: 'neutral' },
  SKIPPED: { label: 'لم تُنفَّذ', tone: 'neutral' },
  REFUSED: { label: 'رُفضت', tone: 'critical' },
};

export function CheckResults({ results }: { results: CheckResultView[] }): ReactElement {
  const done = results.filter((result) => result.status === 'OK' || result.status === 'PARTIAL').length;
  return (
    <section className="result-banner" data-role="check-results" role="status">
      <strong>
        اكتملت{' '}
        <bdi dir="ltr" className="mono">
          {done}
        </bdi>{' '}
        من{' '}
        <bdi dir="ltr" className="mono">
          {results.length}
        </bdi>{' '}
        عمليات التحقق
      </strong>
      <ul>
        {results.map((result, index) => (
          <li key={`${result.productCode}-${index}`} className="row" data-status={result.status} style={{ gap: 'var(--s-2)' }}>
            <span className="badge" data-tone={STATUS[result.status].tone}>
              {STATUS[result.status].label}
            </span>
            <span>{result.nameAr}</span>
            {result.reference ? (
              <bdi dir="ltr" className="mono faint">
                {result.reference}
              </bdi>
            ) : null}
            {result.noteAr ? <span className="muted">{result.noteAr}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
