import type { ReactElement } from 'react';
import type { ReadinessCheck, ReadinessState } from '@nx-verify/core';

/**
 * The install guide, asked of the running deployment.
 *
 * Ordered worst first, because a screen that puts nine green rows above the one red one
 * is a screen where the red one is found last. And every row that is not green says the
 * exact thing to change: a warning without a remedy is a warning people learn to scroll
 * past.
 */

const STATE_LABELS: Record<ReadinessState, string> = {
  ok: 'جاهز',
  warn: 'ينقصه',
  blocked: 'يوقف الإطلاق',
};

const STATE_STYLE: Record<ReadinessState, { fg: string; bg: string; line: string }> = {
  ok: { fg: 'var(--fresh-fg)', bg: 'var(--fresh-bg)', line: 'var(--fresh-line)' },
  warn: { fg: 'var(--changed-fg)', bg: 'var(--changed-bg)', line: 'var(--changed-line)' },
  blocked: { fg: 'var(--critical-fg)', bg: 'var(--critical-bg)', line: 'var(--critical-line)' },
};

const ORDER: Record<ReadinessState, number> = { blocked: 0, warn: 1, ok: 2 };

export function OperatorReadiness({
  checks,
  canServeLive,
}: {
  checks: ReadinessCheck[];
  canServeLive: boolean;
}): ReactElement {
  const sorted = [...checks].sort((left, right) => ORDER[left.state] - ORDER[right.state]);
  const blocked = checks.filter((check) => check.state === 'blocked').length;
  const warned = checks.filter((check) => check.state === 'warn').length;

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <section
        className="card"
        data-role="readiness-verdict"
        data-ready={canServeLive ? 'yes' : 'no'}
        style={{
          borderColor: canServeLive ? 'var(--fresh-line)' : 'var(--critical-line)',
          background: canServeLive ? 'var(--fresh-bg)' : 'var(--critical-bg)',
        }}
      >
        <strong>
          {canServeLive
            ? 'لا شيء يمنع خدمة عملاء حقيقيين من هذا النشر.'
            : `${blocked} بند يمنع خدمة عملاء حقيقيين من هذا النشر.`}
        </strong>
        {warned > 0 ? (
          <p className="faint" style={{ margin: 0 }}>
            و{warned} بند ناقص لا يمنع التشغيل ويغيّر ما يصل العميل.
          </p>
        ) : null}
      </section>

      <div className="table-scroll">
        <table data-role="readiness">
          <thead>
            <tr>
              <th>البند</th>
              <th>الحالة</th>
              <th>ما وجدناه</th>
              <th>ما يُضبَط</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((check) => (
              <tr key={check.id} data-check={check.id} data-state={check.state}>
                <td>{check.titleAr}</td>
                <td>
                  <span
                    className="badge"
                    data-state={check.state}
                    style={{
                      color: STATE_STYLE[check.state].fg,
                      background: STATE_STYLE[check.state].bg,
                      borderColor: STATE_STYLE[check.state].line,
                    }}
                  >
                    {STATE_LABELS[check.state]}
                  </span>
                </td>
                <td>{check.detailAr}</td>
                <td>
                  {check.fixAr ? (
                    <bdi dir="ltr" className="mono">
                      {check.fixAr}
                    </bdi>
                  ) : (
                    <span className="faint">لا شيء</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
