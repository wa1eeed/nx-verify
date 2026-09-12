'use server';

import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { isSandbox, resolveProviders, verify, DerivedTenantKeyProvider, masterKeySourceFromEnv } from '@nx-verify/core';
import {
  createProviderRegistry,
  createProviderStepRunner,
  providerConfigFromEnv,
  resolveCredential,
  secretStoreFromEnv,
} from '@nx-verify/providers';
import { query } from '../../../lib/context';

/**
 * Running a call from the screen.
 *
 * It refuses outside a sandbox workspace, and that refusal is the point: a playground
 * that can spend a customer's money on a curious click is a trap, not a feature. The
 * button exists so an engineer can see a real response in the minute they are deciding
 * whether to integrate, and a real response in the sandbox costs nothing and touches no
 * authority.
 *
 * The run goes through the same domain path as the API, so what the screen shows is what
 * the integration will get rather than an illustration of it. The result is a real
 * verification with a real reference, so the page simply reads it back.
 */
export async function runPlaygroundAction(formData: FormData): Promise<void> {
  const productCode = String(formData.get('product') ?? '');
  const input = String(formData.get('input') ?? '').trim();
  const scenario = String(formData.get('scenario') ?? '').trim();

  if (productCode === '' || input === '') {
    redirect('/developer?error=input');
  }

  const outcome = await query(async (tx) => {
    if (!(await isSandbox(tx))) {
      return { error: 'live' as const };
    }

    const secrets = secretStoreFromEnv();
    const registry = createProviderRegistry(providerConfigFromEnv());
    const keys = new DerivedTenantKeyProvider(masterKeySourceFromEnv());

    const result = await verify(tx, {
      productCode,
      subject: subjectFor(productCode, input),
      subjectIdentifiers: [{ idType: identifierTypeFor(productCode), value: input }],
      idempotencyKey: `playground-${randomUUID()}`,
      triggeredBy: 'CONSOLE',
      modeAtExecution: 'BYOC',
      runStep: createProviderStepRunner({
        registry,
        candidatesFor: (step) =>
          resolveProviders(tx, {
            endpoint: step.endpoint,
            declaredProvider: step.provider,
            declaredFallback: step.fallbackProvider,
          }),
        credentialFor: (name, ref) => resolveCredential(tx, secrets, name, ref),
        ...(scenario === '' ? {} : { testScenario: scenario }),
      }),
      keys,
    });

    return { runId: result.runId };
  });

  if ('error' in outcome) {
    // Said plainly rather than silently doing nothing: the person clicked a button.
    redirect('/developer?error=live');
  }

  redirect(`/developer?run=${outcome.runId}`);
}

/**
 * Each product asks for the subject its own schema describes (rule 8), so the playground
 * shapes the one input it was given into what that product declared.
 */
function subjectFor(productCode: string, input: string): Record<string, unknown> {
  switch (productCode) {
    case 'IBAN_OWNERSHIP':
      return { iban: input, identifier: { type: 'CR', value: '1010478213' } };
    case 'BANK_ACCOUNT_OWNERSHIP':
      return { iban: input, holder: { type: 'BUSINESS', name: 'شركة المثال للتجارة' } };
    case 'NAME_MATCH':
      return { account_reference: input, full_name: 'شركة المثال للتجارة' };
    case 'INCOME_VERIFICATION':
      return { account_reference: input };
    case 'FREELANCER_CERTIFICATE':
      return { certificate_number: input };
    case 'PROPERTY_DEED':
      return { deed_number: input };
    case 'MANAGER_PERMISSIONS':
      return { unn: input, manager: { id: '1098765432', id_type: 'NATIONAL_ID' } };
    default:
      return { unn: input };
  }
}

function identifierTypeFor(productCode: string): 'UNN' | 'IBAN' | 'FREELANCE_DOC' | 'REAL_ESTATE_NO' {
  switch (productCode) {
    case 'IBAN_OWNERSHIP':
    case 'BANK_ACCOUNT_OWNERSHIP':
    case 'NAME_MATCH':
    case 'INCOME_VERIFICATION':
      return 'IBAN';
    case 'FREELANCER_CERTIFICATE':
      return 'FREELANCE_DOC';
    case 'PROPERTY_DEED':
      return 'REAL_ESTATE_NO';
    default:
      return 'UNN';
  }
}
