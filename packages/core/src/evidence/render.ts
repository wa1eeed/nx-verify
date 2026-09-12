import {
  decisionLabel,
  statusLabel,
  verificationQrSvg,
  type EvidenceDocument,
} from './document.js';

/**
 * Rendering the evidence document.
 *
 * The same interface rules the console follows, because this page is the customer's own
 * document with our seal on it: right to left throughout, identifiers and dates in an
 * explicit left to right run so a number cannot be read back wrong, solid borders and no
 * shadows, and the four brand colours.
 *
 * Nothing here prints a field without its authority and its date, because the document
 * model has already dropped any field that lacks them.
 */

export interface RenderOptions {
  /** Emitted as a print stylesheet page size. */
  pageSize?: 'A4' | 'Letter';
}

export async function renderEvidenceHtml(
  document: EvidenceDocument,
  options: RenderOptions = {},
): Promise<string> {
  const qr = await verificationQrSvg(document.verifyUrl);
  const decision = decisionLabel(document.header.decision);

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>ملف الدليل ${escape(document.header.verificationId)}</title>
<style>
  @page { size: ${options.pageSize ?? 'A4'}; margin: 18mm; }
  :root {
    --navy: #0a1628;
    --teal-d: #00a886;
    --gold: #f5b942;
    --line: #d7dde8;
    --ink-soft: #44506a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif;
    color: var(--navy);
    font-size: 13px;
    line-height: 1.7;
  }
  .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
  /*
   * A sandbox document announces itself at the top and in the margin of every printed
   * page. Someone handed this on paper has no other way to know, and a test document that
   * reads as a real one is the single worst thing this platform could produce.
   */
  .sandbox {
    border: 2px solid #8a1c1c;
    background: #fdecec;
    color: #8a1c1c;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 16px;
    font-weight: 600;
  }
  header { border-bottom: 2px solid var(--navy); padding-bottom: 12px; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: var(--ink-soft); font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border-bottom: 1px solid var(--line); padding: 7px 9px; text-align: start; }
  th { font-weight: 600; }
  .seal {
    margin-top: 22px;
    border: 1px solid var(--line);
    padding: 14px;
    display: flex;
    gap: 18px;
    align-items: flex-start;
  }
  .seal .qr { flex: 0 0 132px; }
  .decision { border-inline-start: 4px solid var(--teal-d); padding-inline-start: 10px; }
  .decision[data-outcome="FAIL"] { border-color: #d95757; }
  .decision[data-outcome="REVIEW"] { border-color: var(--gold); }
  footer { margin-top: 20px; border-top: 1px solid var(--line); padding-top: 10px; }
</style>
</head>
<body>
${
  document.header.sandbox
    ? `<div class="sandbox" data-role="sandbox-notice">مستند تجريبي من بيئة الاختبار. لا يثبت شيئاً عن أي جهة ولا يصلح للاعتماد عليه.</div>`
    : ''
}
<header>
  <h1>ملف الدليل</h1>
  <div class="muted">${escape(document.header.tenantName)}</div>
</header>

<section data-role="summary">
  <table>
    <tbody>
      <tr>
        <th>رقم العملية</th>
        <td><bdi dir="ltr" class="mono">${escape(document.header.verificationId)}</bdi></td>
      </tr>
      <tr><th>نوع التحقق</th><td>${escape(document.header.productNameAr)}</td></tr>
      <tr><th>الكيان</th><td>${escape(document.header.entityName ?? 'غير مسمّى')}</td></tr>
      <tr><th>حالة التحقق</th><td>${escape(statusLabel(document.header.status))}</td></tr>
    </tbody>
  </table>
</section>

${
  decision === null
    ? ''
    : `<section class="decision" data-role="decision" data-outcome="${escape(
        document.header.decision ?? '',
      )}">
  <strong>القرار: ${escape(decision)}</strong>
  ${
    document.header.decisionReasons.length === 0
      ? ''
      : `<ul>${document.header.decisionReasons
          .map((reason) => `<li>${escape(reason.messageAr)}</li>`)
          .join('')}</ul>`
  }
</section>`
}

<section data-role="fields">
  <h2 style="font-size:15px;margin:18px 0 0">ما تم التحقق منه</h2>
  <table>
    <thead>
      <tr><th>المعلومة</th><th>الجهة الرسمية</th><th>تاريخ الرصد</th></tr>
    </thead>
    <tbody>
      ${document.fields
        .map(
          (field) => `<tr>
        <td>${escape(field.labelAr)}</td>
        <td>${escape(field.authority)}</td>
        <td><bdi dir="ltr" class="mono">${escape(field.observedAt)}</bdi></td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>
  ${
    document.fields.length === 0
      ? '<p class="muted">لا معلومات مثبتة في هذي العملية.</p>'
      : ''
  }
</section>

<section class="seal" data-role="seal">
  <div class="qr">${qr}</div>
  <div>
    <strong>التحقق من هذا المستند</strong>
    <p class="muted" style="margin:6px 0">
      امسح الرمز أو افتح الرابط. الصفحة تعرض بصمة المستند ووقت ختمه فقط، ولا تعرض أي
      بيانات شخصية.
    </p>
    <div>
      البصمة:
      <bdi dir="ltr" class="mono" data-role="hash">${escape(document.contentHash)}</bdi>
    </div>
    <div>
      وقت الختم:
      <bdi dir="ltr" class="mono" data-role="sealed-at">${escape(document.sealedAt)}</bdi>
    </div>
    <div class="muted">
      <bdi dir="ltr" class="mono">${escape(document.verifyUrl)}</bdi>
    </div>
  </div>
</section>

<footer class="muted">
  هذا المستند يثبت ما تم التحقق منه ومن أي جهة رسمية ومتى. أي تعديل عليه يغيّر بصمته،
  فلا تطابق البصمة المنشورة على صفحة التحقق.
</footer>
</body>
</html>`;
}

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
