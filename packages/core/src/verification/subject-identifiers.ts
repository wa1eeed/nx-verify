import type { IdentifierInput } from '../repositories/entities.js';

/**
 * Reads whatever identifiers an applicant record happens to carry (ADR-148).
 *
 * Deliberately conservative: it recognises the keys the seeded products use and nothing
 * else. Guessing more widely would resolve the wrong entity, and a wrong merge is far harder
 * to undo than a refusal.
 *
 * It lives in the domain rather than in a route because three callers read the same record
 * now: the verification endpoint, the onboarding endpoint, and the console screen that opens
 * a file. Two readings of «what counts as an identifier» would eventually disagree, and the
 * disagreement would show up as a customer resolved one way over the API and another way on
 * a screen.
 */

export const IDENTIFIER_TYPES = [
  'CR',
  'UNN',
  'NATIONAL_ID',
  'IQAMA',
  'FREELANCE_DOC',
  'IBAN',
  'REAL_ESTATE_NO',
] as const;
// `PARTY_ID` is deliberately absent: it is ours, minted when a party document is read, and
// never something a caller declares about an applicant.

export type DeclaredIdentifierType = (typeof IDENTIFIER_TYPES)[number];

export function isIdentifierTypeName(value: unknown): value is DeclaredIdentifierType {
  return typeof value === 'string' && IDENTIFIER_TYPES.includes(value as DeclaredIdentifierType);
}

export function inferIdentifiers(subject: Record<string, unknown>): IdentifierInput[] {
  const identifiers: IdentifierInput[] = [];
  const add = (idType: IdentifierInput['idType'], value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) {
      identifiers.push({ idType, value });
    }
  };

  add('UNN', subject['unn']);
  add('CR', subject['cr_number']);
  add('IBAN', subject['iban']);

  const identifier = subject['identifier'];
  if (identifier && typeof identifier === 'object') {
    const record = identifier as Record<string, unknown>;
    if (isIdentifierTypeName(record['type'])) {
      add(record['type'], record['value']);
    }
  }

  return identifiers;
}
