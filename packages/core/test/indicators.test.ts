import { describe, expect, it } from 'vitest';
import {
  assessCustomer,
  riskLevelFor,
  type AssessmentInput,
  type FactView,
} from '../src/customers/indicators.js';
import { DEFAULT_RISK_POLICY } from '../src/customers/risk-policy.js';

/**
 * The assessment, and the one list it answers with.
 *
 * An assessment used to carry two lists of the same sentences: `signals`, ordered by the
 * platform's opinion of severity, and `riskReasons`, ordered by the weight that makes the
 * score. No screen ever drew the first, so a reader could only ever see the second, and the
 * two could drift apart without anything failing. There is one list now, and what these tests
 * hold it to is that it is the whole of the score: every signal that fired is in it, nothing
 * is in it that the score did not count, and the two add up.
 *
 * Pure on purpose. There is no database here because there is no database in the answer: the
 * model arrives as a policy (ADR-138) and the assessment is arithmetic over facts.
 */

const observed = new Date('2026-09-01T00:00:00Z');
const now = new Date('2026-09-16T00:00:00Z');
const fact = (value: unknown): FactView => ({ value, freshness: 'fresh', observedAt: observed });

function company(over: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    kind: 'COMPANY',
    isFreelancer: false,
    facts: new Map([
      ['cr.status_code', fact(1)],
      ['cr.status', fact('نشط')],
    ]),
    managers: [],
    accountsSharedWith: 0,
    addressSharedWith: 0,
    openChanges: 0,
    now,
    ...over,
  };
}

/** The sum of a reason list, which is what the score has to be. */
const summed = (weights: readonly number[]): number =>
  weights.reduce((total, weight) => total + weight, 0);

describe('what a customer file is rated on', () => {
  it('rates nothing until the anchor fact has been read', () => {
    // An unverified company is not a low risk company, it is a company nobody has looked at.
    const unread = assessCustomer(company({ facts: new Map() }));
    expect(unread.riskScore).toBeNull();
    expect(unread.riskLevel).toBe('INCOMPLETE');
    expect(unread.riskLabelAr).toBe('غير مكتملة');
    expect(unread.riskReasons).toEqual([]);
  });

  it('puts every signal that fired in the reasons, with what each one cost', () => {
    const assessment = assessCustomer(
      company({
        facts: new Map([
          ['cr.status_code', fact(2)],
          ['cr.status', fact('موقوف')],
          ['cr.in_liquidation', fact(true)],
          ['bank.iban_ownership', fact('NO_MATCH')],
        ]),
        accountsSharedWith: 2,
      }),
    );
    const keys = assessment.riskReasons.map((reason) => reason.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'registry_inactive',
        'liquidation',
        'iban_mismatch',
        'shared_account',
      ]),
    );
    // Heaviest first, so the sentence a person reads first is the one that cost the most.
    const weights = assessment.riskReasons.map((reason) => reason.weight);
    expect([...weights].sort((left, right) => right - left)).toEqual(weights);
    for (const reason of assessment.riskReasons) {
      expect(reason.weight).toBeGreaterThan(0);
      expect(reason.textAr).not.toBe('');
    }
  });

  it('scores exactly the reasons it shows, and stops at one hundred', () => {
    const light = assessCustomer(company({ addressSharedWith: 1, openChanges: 1 }));
    expect(light.riskScore).toBe(summed(light.riskReasons.map((reason) => reason.weight)));

    // Four serious signals at once are worth more than a hundred and are reported as a
    // hundred: the scale is the scale, and a reader is still shown every line that made it.
    const heavy = assessCustomer(
      company({
        facts: new Map([
          ['cr.status_code', fact(2)],
          ['cr.status', fact('ملغى')],
          ['cr.in_liquidation', fact(true)],
          ['bank.iban_ownership', fact('NO_MATCH')],
        ]),
        accountsSharedWith: 3,
      }),
    );
    expect(summed(heavy.riskReasons.map((reason) => reason.weight))).toBeGreaterThan(100);
    expect(heavy.riskScore).toBe(100);
    expect(heavy.riskLevel).toBe('HIGH');
  });

  it('counts an unfinished file as its own reason, once per section and no further than the cap', () => {
    const sections = ['العنوان الوطني', 'المعلومات المصرفية', 'المدراء المفوضون', 'عقد التأسيس'];
    const assessment = assessCustomer(company({ incompleteSections: sections }));
    const incomplete = assessment.riskReasons.filter(
      (reason) => reason.key === 'incomplete_section',
    );
    expect(incomplete).toHaveLength(DEFAULT_RISK_POLICY.signals.incomplete_section?.threshold ?? 3);
    // Each names the section it is about, so «قسم لم يكتمل» is never four identical lines.
    expect(new Set(incomplete.map((reason) => reason.textAr)).size).toBe(incomplete.length);
    expect(assessment.riskScore).toBe(summed(incomplete.map((reason) => reason.weight)));
  });

  it('carries the bands it was read under, so a screen never draws its own line', () => {
    const assessment = assessCustomer(company());
    expect(assessment.bands).toEqual({
      highFrom: DEFAULT_RISK_POLICY.highFrom,
      mediumFrom: DEFAULT_RISK_POLICY.mediumFrom,
    });
    expect(riskLevelFor(assessment.bands.highFrom)).toBe('HIGH');
    expect(riskLevelFor(assessment.bands.mediumFrom)).toBe('MEDIUM');
    expect(riskLevelFor(assessment.bands.mediumFrom - 1)).toBe('LOW');
  });

  it('says a file is deficient when a checked fact failed, not when one is still missing', () => {
    const missing = assessCustomer(company());
    expect(missing.standing).toBe('IN_PROGRESS');
    expect(missing.standingAr).toBe('قيد الإكمال');

    const failed = assessCustomer(
      company({
        facts: new Map([
          ['cr.status_code', fact(2)],
          ['cr.status', fact('موقوف')],
        ]),
      }),
    );
    expect(failed.standing).toBe('DEFICIENT');
    expect(failed.statusAr).toBe('لم يجتز التحقق');
    expect(failed.statusTone).toBe('critical');
  });
});
