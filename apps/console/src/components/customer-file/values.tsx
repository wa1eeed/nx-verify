import type { ReactNode } from 'react';
import type { FileField, ProfileSection } from '@nx-verify/core';
import { count } from '../format';
import { Ltr } from '../ui/ltr';
import { Tag } from '../ui/tag';

/**
 * How a fact reads inside a section, and in which order the facts come.
 *
 * The authority's own words for a coded value when there are any, figures and Latin text
 * left to right, lists as tags. The order leads with what screen 03 lists for each section
 * and keeps everything else the authority returned after it, in the order it came.
 */

export function renderValue(field: FileField): ReactNode {
  if (field.valueLabelAr) {
    return field.valueLabelAr;
  }
  const value = field.value;
  if (typeof value === 'boolean') {
    return value ? 'نعم' : 'لا';
  }
  if (typeof value === 'number') {
    return <Ltr>{count(value)}</Ltr>;
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string')) {
      return (
        <span className="file-tags">
          {(value as string[]).map((entry) => (
            <Tag key={entry}>{entry}</Tag>
          ))}
        </span>
      );
    }
    return (
      <ul className="file-list">
        {value.map((entry, index) => {
          const record = (entry ?? {}) as Record<string, unknown>;
          const name = typeof record['name'] === 'string' ? record['name'] : JSON.stringify(entry);
          const pct = record['approve_percentage'];
          return (
            <li key={index}>
              {name}
              {typeof pct === 'number' ? (
                <>
                  {' '}
                  <Ltr>{pct}%</Ltr>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }
  if (typeof value === 'string' && !/[؀-ۿ]/.test(value)) {
    // Latin text inside a right to left page keeps its own order: a masked holder name,
    // a web address, a SWIFT code.
    return <Ltr>{value}</Ltr>;
  }
  if (typeof value === 'string') {
    return value;
  }
  return value === null || value === undefined ? 'غير متوفر' : JSON.stringify(value);
}

/** What each section lists first (README, screen 03, the table of sections). */
const LEADING: Readonly<Partial<Record<ProfileSection, readonly string[]>>> = {
  REGISTRY: [
    'person.name',
    'person.nationality',
    'person.gender',
    'person.national_id_expiry',
    'cr.core.name',
    'cr.activities',
    'cr.status',
    'cr.issue_date',
    'cr.confirmation_date',
    'cr.core.capital',
    'cr.headquarters_city',
    'cr.legal_form',
    'cr.entity_type',
  ],
  CONTRACT: [
    'contract.copy_number',
    'contract.date',
    'contract.capital',
    'contract.partners_total',
    'contract.managers_total',
  ],
  ADDRESS: [
    'address.national.city',
    'address.national.district',
    'address.national.street',
    'address.national.building_number',
    'address.national.postal_code',
    'address.national.additional_number',
  ],
  BANKING: ['bank.name', 'bank.account_status', 'bank.holder_name', 'bank.iban_ownership'],
  FREELANCE: [
    'freelance.document',
    'freelance.category',
    'freelance.speciality',
    'freelance.issue_date',
    'freelance.expiry_date',
    'freelance.certificate_status',
    'freelance.ownership',
  ],
};

/** Shown as the name match the screen computes, not as the raw score beside it. */
export const MATCH_SCORE_FIELDS = new Set(['bank.match_score', 'account.match_score']);

export function orderedFields(section: ProfileSection, fields: readonly FileField[]): FileField[] {
  const leading = LEADING[section] ?? [];
  const rank = (field: FileField): number => {
    const index = leading.indexOf(field.fieldPath);
    return index === -1 ? leading.length : index;
  };
  return fields
    .map((field, index) => ({ field, index }))
    .sort((left, right) => rank(left.field) - rank(right.field) || left.index - right.index)
    .map((entry) => entry.field);
}

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
