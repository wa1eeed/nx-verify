import type { Queryable } from '../client.js';

/**
 * The providers this deployment knows how to talk to.
 *
 * A provider is a row and not a branch in the code. This seed exists because the admin
 * panel configures rows, and a fresh deployment with an empty catalogue shows an operator
 * nothing to configure: they cannot set an address, a credential reference, or an
 * environment for a provider that does not exist yet.
 *
 * Names live here and never leave the operator surface. Rule 5 keeps the provider name
 * out of every subscriber-facing response, which carries the authority instead.
 */

export interface SeedProvider {
  code: string;
  nameAr: string;
  nameEn: string;
  /** The endpoints a product step may name for this provider. */
  endpoints: string[];
  notes: string | null;
}

/**
 * The data source every subscriber is served through.
 *
 * NX sells verification under its own agreement with one data source (ADR-108), so there
 * is one connection per environment and no subscriber brings a credential of their own.
 * The code names it for the adapter and the connection rows. No screen, response or
 * document names it: a subscriber sees the official authority behind each fact, and the
 * administration panel says "the data source" (rule 5, and the owner's instruction).
 */
export const PRIMARY_PROVIDER = 'lean';

/**
 * The addresses a fresh connection starts from, per environment, as the data source
 * documents them for Saudi Arabia. The panel shows them pre-filled and they can be
 * corrected there without a release.
 */
export const PRIMARY_CONNECTION_DEFAULTS: Readonly<
  Record<'sandbox' | 'live', { baseUrl: string; authUrl: string }>
> = {
  sandbox: {
    baseUrl: 'https://sandbox.sa.leantech.me',
    authUrl: 'https://auth.sandbox.sa.leantech.me/oauth2/token',
  },
  live: {
    baseUrl: 'https://api2.sa.leantech.me',
    authUrl: 'https://auth.sa.leantech.me/oauth2/token',
  },
};

export const SEED_PROVIDERS: readonly SeedProvider[] = [
  {
    code: 'stub',
    nameAr: 'بيانات الاختبار الداخلية',
    nameEn: 'Internal test data',
    endpoints: [
      'business_verification',
      'articles_of_association',
      'manager_permissions',
      'national_address',
      'freelancer_certificate',
      'iban_ownership',
      'bank_account_ownership',
      'name_match',
      'income_verification',
      'property_deed',
    ],
    notes:
      'Answers from published test data. It is what a sandbox workspace runs against when no sandbox connection to the data source is set, and it never reaches a real authority.',
  },
  {
    code: PRIMARY_PROVIDER,
    nameAr: 'مصدر البيانات',
    nameEn: 'Data source',
    endpoints: [
      'business_verification',
      'articles_of_association',
      'manager_permissions',
      'national_address',
      'freelancer_certificate',
      'iban_ownership',
      'bank_account_ownership',
      'name_match',
      'income_verification',
      'property_deed',
    ],
    notes:
      'The one data source NX is contracted with. It mints a token at one address and answers at another, so its connection kind is openbanking.',
  },
];

/**
 * Writes the catalogue. Must run on a connection that holds nx_operator: the catalogue
 * is configuration that crosses subscribers, and no tenant role may write it.
 */
export async function applyProviderSeed(
  db: Queryable,
  providers: readonly SeedProvider[] = SEED_PROVIDERS,
): Promise<void> {
  for (const provider of providers) {
    await db.query(
      `INSERT INTO provider_catalog (code, name_ar, name_en, endpoints, status, notes)
       VALUES ($1, $2, $3, $4, 'active', $5)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         name_en = EXCLUDED.name_en,
         endpoints = EXCLUDED.endpoints,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [provider.code, provider.nameAr, provider.nameEn, provider.endpoints, provider.notes],
    );
  }
}
