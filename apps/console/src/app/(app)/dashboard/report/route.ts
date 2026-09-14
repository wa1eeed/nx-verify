import { listRecentRuns, riyadhMonthStart } from '@nx-verify/core';
import { query } from '../../../../lib/context';

/**
 * «تصدير التقرير»: this month's operations, as a spreadsheet (handoff screen 01).
 *
 * The rows the home table starts, all of them: when, the reference, the customer, the check,
 * how it ended, what it cost before VAT and what paid for it. No identifier is in it, only
 * names and references (rule 4), and nothing names the data source (rule 5).
 */

export const dynamic = 'force-dynamic';

const STATUS_AR: Readonly<Record<string, string>> = {
  OK: 'مُتحقق',
  PARTIAL: 'مُتحقق جزئياً',
  NOT_FOUND: 'غير موجود',
  ERROR: 'فشل',
  PENDING: 'قيد المعالجة',
  AWAITING: 'بانتظار الجهة الرسمية',
};

const SOURCE_AR: Readonly<Record<string, string>> = {
  PACKAGE: 'من الباقة',
  BUNDLE: 'من الحزمة',
  WALLET: 'من الرصيد',
  FREE: 'دون رسوم',
};

/** One spreadsheet cell: quoted when it must be, and never read as a formula. */
function cell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export async function GET(): Promise<Response> {
  const now = new Date();
  const since = riyadhMonthStart(now);
  const runs = await query((tx) => listRecentRuns(tx, { since, limit: 5_000 }));

  const lines = [
    ['التاريخ', 'المرجع', 'العميل', 'المنتج', 'الحالة', 'التكلفة قبل الضريبة (ر.س)', 'مصدر الخصم'],
    ...runs.map((run) => [
      run.createdAt.toISOString().replace('T', ' ').slice(0, 16),
      run.reference ?? '',
      run.entityName ?? '',
      run.productNameAr,
      STATUS_AR[run.status] ?? run.status,
      run.status === 'ERROR' || run.billedHalalas === null
        ? '0.00'
        : (run.billedHalalas / 100).toFixed(2),
      run.status === 'ERROR' ? '' : (SOURCE_AR[run.chargeSource] ?? ''),
    ]),
  ].map((row) => row.map(cell).join(','));

  const month = new Date(since.getTime() + 3 * 3_600_000).toISOString().slice(0, 7);
  // The byte order mark tells a spreadsheet the Arabic is UTF-8.
  return new Response(`\uFEFF${lines.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="nx-trust-report-${month}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
