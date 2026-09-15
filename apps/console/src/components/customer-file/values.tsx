import type { ReactElement, ReactNode } from 'react';
import type { FieldFormat, FileField, ListColumn } from '@nx-verify/core';
import { count } from '../format';
import { Ltr } from '../ui/ltr';
import { Table, Th } from '../ui/table';
import { Tag } from '../ui/tag';

/**
 * How a fact reads inside a section.
 *
 * The authority's own words for a coded value when there are any; figures, codes and Latin
 * text left to right; a date with its Hijri day under it; riyals, percentages and terms in the
 * words Arabic uses for them; a web address, an email and a phone number as links; coordinates
 * as a place on a map; a list as tags; a list of records as a small table; the articles of
 * association grouped by their part. The order of facts is the catalogue's, decided in the
 * domain, so the file, the document and the shared profile list them alike.
 */

const GREGORIAN_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

const HIJRI_MONTHS = [
  'محرم',
  'صفر',
  'ربيع الأول',
  'ربيع الآخر',
  'جمادى الأولى',
  'جمادى الآخرة',
  'رجب',
  'شعبان',
  'رمضان',
  'شوال',
  'ذو القعدة',
  'ذو الحجة',
] as const;

/** «سنة واحدة», «سنتان», «3 سنوات», «11 سنة». */
export function yearsAr(n: number): string {
  if (n === 1) {
    return 'سنة واحدة';
  }
  if (n === 2) {
    return 'سنتان';
  }
  return n >= 3 && n <= 10 ? `${n} سنوات` : `${n} سنة`;
}

/** «مادة واحدة», «مادتان», «3 مواد», «11 مادة». */
export function articlesCountAr(n: number): string {
  if (n === 1) {
    return 'مادة واحدة';
  }
  if (n === 2) {
    return 'مادتان';
  }
  return n >= 3 && n <= 10 ? `${n} مواد` : `${n} مادة`;
}

/** An address as a link that opens it, never a script: anything not http(s) gets https. */
export function safeUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
}

function External({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    <a className="file-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** A value with no words of its own, read by its format. */
function formatted(value: unknown, format: FieldFormat | null | undefined): ReactNode {
  if (value === null || value === undefined || value === '') {
    return 'غير متوفر';
  }
  if (typeof value === 'boolean') {
    return value ? 'نعم' : 'لا';
  }
  switch (format) {
    case 'money':
      return typeof value === 'number' ? (
        <>
          <Ltr>{count(value)}</Ltr> ريال
        </>
      ) : (
        String(value)
      );
    case 'percent':
      return <Ltr>{`${String(value)}%`}</Ltr>;
    case 'years':
      return typeof value === 'number' ? yearsAr(value) : String(value);
    case 'hijri':
      return (
        <>
          <Ltr>{String(value)}</Ltr> هـ
        </>
      );
    case 'datetime':
      return <Ltr>{String(value).slice(0, 10)}</Ltr>;
    case 'url':
      return typeof value === 'string' ? (
        <External href={safeUrl(value)}>
          <Ltr>{value}</Ltr>
        </External>
      ) : (
        String(value)
      );
    case 'email':
      return typeof value === 'string' ? (
        <a className="file-link" href={`mailto:${value.trim()}`}>
          <Ltr>{value}</Ltr>
        </a>
      ) : (
        String(value)
      );
    case 'phone':
      return typeof value === 'string' ? (
        <a className="file-link" href={`tel:${value.replace(/[^0-9+]/g, '')}`}>
          <Ltr>{value}</Ltr>
        </a>
      ) : (
        String(value)
      );
    case 'date':
    case 'code':
      return <Ltr>{String(value)}</Ltr>;
    default:
      break;
  }
  if (typeof value === 'number') {
    return <Ltr>{count(value)}</Ltr>;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === 'string' || typeof entry === 'number')
      ? value.join('، ')
      : JSON.stringify(value);
  }
  if (typeof value === 'string') {
    // Latin text inside a right to left page keeps its own order: a masked holder name,
    // a web address, a SWIFT code.
    return /[؀-ۿ]/.test(value) ? value : <Ltr>{value}</Ltr>;
  }
  return JSON.stringify(value);
}

function companionOf(field: FileField, suffix: string): FileField | undefined {
  return field.companions?.find((companion) => companion.fieldPath.endsWith(suffix));
}

/** «30 ديسمبر», in the calendar the fiscal year is kept in. */
function monthDay(value: unknown, calendar: unknown): ReactNode {
  const match = typeof value === 'string' ? /^(\d{1,2})-(\d{1,2})$/.exec(value) : null;
  if (match === null) {
    return formatted(value, 'code');
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const hijri = typeof calendar === 'string' && calendar.includes('هجري');
  const name = (hijri ? HIJRI_MONTHS : GREGORIAN_MONTHS)[month - 1];
  return name === undefined ? (
    <Ltr>{value as string}</Ltr>
  ) : (
    <>
      <Ltr>{day}</Ltr> {name}
    </>
  );
}

function Records({ field }: { field: FileField }): ReactElement {
  const rows = (Array.isArray(field.value) ? field.value : []).map(
    (entry) => (entry ?? {}) as Record<string, unknown>,
  );
  const declared: readonly ListColumn[] =
    field.columns ??
    [...new Set(rows.flatMap((row) => Object.keys(row)))].map((key) => ({ key, labelAr: key }));
  // A column no record fills says nothing.
  const columns = declared.filter((column) =>
    rows.some((row) => row[column.key] !== undefined && row[column.key] !== null),
  );
  const cellOf = (row: Record<string, unknown>, column: ListColumn): ReactNode => {
    const cell = row[column.key];
    if (cell === undefined || cell === null) {
      return '·';
    }
    return column.values?.[String(cell)] ?? formatted(cell, column.format ?? null);
  };
  // More than four columns do not fit a section's width as a table: each record reads as a
  // small card of its own facts instead, an address or a certificate at a time.
  if (columns.length > 4) {
    return (
      <div className="file-records file-record-cards" data-role="records">
        {rows.map((row, index) => (
          <dl key={index} className="file-fields file-record-card">
            {columns
              .filter((column) => row[column.key] !== undefined && row[column.key] !== null)
              .map((column) => (
                <div key={column.key} className="file-field">
                  <dt>{column.labelAr}</dt>
                  <dd>{cellOf(row, column)}</dd>
                </div>
              ))}
          </dl>
        ))}
      </div>
    );
  }
  return (
    <div className="file-records" data-role="records">
      <Table label={field.labelAr}>
        <thead>
          <tr>
            {columns.map((column) => (
              <Th key={column.key}>{column.labelAr}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.key}>{cellOf(row, column)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function Articles({ field }: { field: FileField }): ReactElement {
  const articles = (Array.isArray(field.value) ? field.value : []).map(
    (entry) => (entry ?? {}) as Record<string, unknown>,
  );
  const parts: { name: string; articles: Record<string, unknown>[] }[] = [];
  for (const article of articles) {
    const name = typeof article['part'] === 'string' ? article['part'] : 'مواد العقد';
    const part = parts.find((entry) => entry.name === name);
    if (part) {
      part.articles.push(article);
    } else {
      parts.push({ name, articles: [article] });
    }
  }
  return (
    <div className="file-articles" data-role="articles">
      {parts.map((part) => (
        <details key={part.name} className="file-articles-part">
          <summary>
            {part.name} · {articlesCountAr(part.articles.length)}
          </summary>
          <ol className="file-articles-list">
            {part.articles.map((article, index) => (
              <li key={index}>
                {typeof article['title'] === 'string' ? (
                  <strong className="file-articles-title">{article['title']}</strong>
                ) : null}
                <span>{String(article['text'] ?? '')}</span>
              </li>
            ))}
          </ol>
        </details>
      ))}
    </div>
  );
}

/** The companions a format did not already read, each as a quiet line under the value. */
function asides(field: FileField, consumed: ReadonlySet<string>): ReactNode {
  const rest = (field.companions ?? []).filter((companion) => !consumed.has(companion.fieldPath));
  if (rest.length === 0) {
    return null;
  }
  return rest.map((companion) => (
    <span
      key={companion.fieldPath}
      className="file-field-aside"
      data-companion={companion.fieldPath}
    >
      {companion.format === 'hijri' ? (
        <>
          الموافق <Ltr>{String(companion.value)}</Ltr> هـ
        </>
      ) : companion.fieldPath.endsWith('_en') ? (
        <Ltr>{String(companion.value)}</Ltr>
      ) : (
        <>
          {companion.labelAr}:{' '}
          {companion.valueLabelAr ?? formatted(companion.value, companion.format)}
        </>
      )}
    </span>
  ));
}

export function renderValue(field: FileField): ReactNode {
  const consumed = new Set<string>();
  let main: ReactNode;

  if (field.valueLabelAr) {
    main = field.valueLabelAr;
  } else if (field.format === 'records') {
    main = <Records field={field} />;
  } else if (field.format === 'articles') {
    main = <Articles field={field} />;
  } else if (field.format === 'month_day') {
    const calendar = companionOf(field, 'fiscal_year.calendar');
    main = monthDay(field.value, calendar?.value);
    if (calendar !== undefined) {
      consumed.add(calendar.fieldPath);
      main = (
        <>
          {main} · {String(calendar.value)}
        </>
      );
    }
  } else if (field.format === 'coordinates') {
    const longitude = companionOf(field, 'longitude');
    if (longitude !== undefined) {
      consumed.add(longitude.fieldPath);
      const place = `${String(field.value)},${String(longitude.value)}`;
      main = (
        <>
          <Ltr>{`${String(field.value)}, ${String(longitude.value)}`}</Ltr>{' '}
          <External href={`https://www.google.com/maps?q=${encodeURIComponent(place)}`}>
            فتح في الخرائط
          </External>
        </>
      );
    } else {
      main = <Ltr>{String(field.value)}</Ltr>;
    }
  } else if (
    Array.isArray(field.value) &&
    field.value.every((entry) => typeof entry === 'string')
  ) {
    const codes = companionOf(field, 'activity_codes');
    const codeList = Array.isArray(codes?.value) ? (codes?.value as unknown[]) : [];
    if (codes !== undefined) {
      consumed.add(codes.fieldPath);
    }
    main = (
      <span className="file-tags">
        {(field.value as string[]).map((entry, index) => {
          const code = codeList[index];
          return (
            <Tag key={`${entry}-${index}`}>
              {entry}
              {typeof code === 'string' && code !== '' ? (
                <>
                  {' · '}
                  <Ltr>{code}</Ltr>
                </>
              ) : null}
            </Tag>
          );
        })}
      </span>
    );
  } else {
    main = formatted(field.value, field.format);
  }

  const extra = asides(field, consumed);
  return extra === null ? (
    main
  ) : (
    <>
      {main}
      {extra}
    </>
  );
}

/** Whether a fact needs the whole width of its section: a list, a table, a long text. */
export function isWide(field: FileField): boolean {
  if (field.format === 'records' || field.format === 'articles') {
    return true;
  }
  if (Array.isArray(field.value)) {
    return true;
  }
  return typeof field.value === 'string' && field.value.length > 90;
}

/** Shown as the name match the screen computes, not as the raw score beside it. */
export const MATCH_SCORE_FIELDS = new Set(['bank.match_score', 'account.match_score']);

/** «صلاحية واحدة», «صلاحيتان», «3 صلاحيات», «11 صلاحية». */
export function permissionsCountAr(n: number): string {
  if (n === 1) {
    return 'صلاحية واحدة';
  }
  if (n === 2) {
    return 'صلاحيتان';
  }
  return n >= 3 && n <= 10 ? `${n} صلاحيات` : `${n} صلاحية`;
}

/** «سبب واحد», «سببان», «3 أسباب», «11 سبباً». */
export function reasonsCountAr(n: number): string {
  if (n === 0) {
    return 'لا أسباب ترفع الدرجة';
  }
  if (n === 1) {
    return 'سبب واحد';
  }
  if (n === 2) {
    return 'سببان';
  }
  return n >= 3 && n <= 10 ? `${n} أسباب` : `${n} سبباً`;
}
