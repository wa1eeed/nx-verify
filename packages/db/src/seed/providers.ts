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

export const SEED_PROVIDERS: readonly SeedProvider[] = [
  {
    code: 'stub',
    nameAr: 'مزوّد المحاكاة',
    nameEn: 'Simulation provider',
    endpoints: [
      'cr/basic',
      'cr/address',
      'cr/managers',
      'cr/owners',
      'cr/articles',
      'freelance/certificate',
      'deed/lookup',
      'iban/ownership',
      'bank/account-name',
      'bank/income',
    ],
    notes:
      'Answers from published test data. It is what a sandbox workspace runs against, and it never reaches a real authority.',
  },
  {
    code: 'wathq',
    nameAr: 'واثق',
    nameEn: 'Wathq',
    endpoints: [
      'cr/basic',
      'cr/address',
      'cr/managers',
      'cr/owners',
      'cr/articles',
      'freelance/certificate',
      'deed/lookup',
    ],
    notes:
      'Commercial registry, national address, managers, owners and articles. Resale of the raw response is restricted, so only normalised attestations are published.',
  },
  {
    code: 'lean',
    nameAr: 'لين',
    nameEn: 'Lean Technologies',
    endpoints: ['iban/ownership', 'bank/account-name', 'bank/income'],
    notes:
      'Open banking rail. Needs an API address and a separate token address, so its connection kind is openbanking rather than http.',
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
