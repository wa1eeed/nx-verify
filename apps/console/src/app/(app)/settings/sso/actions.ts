'use server';

import { resolveTxt } from 'node:dns/promises';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  audit,
  claimSsoDomain,
  configureIdp,
  listSsoDomains,
  removeSsoDomain,
  verifySsoDomain,
  type SsoRole,
} from '@nx-verify/core';
import { secretStoreFromEnv } from '@nx-verify/providers';
import { actingUser, currentTenantId, query } from '../../../../lib/context';

/**
 * Configuring a directory, and proving the domains that route to it (ADR-153).
 *
 * Neither could be done from anywhere before: `configureIdp` and `addSsoDomain` had no callers
 * outside tests, so the form on the login screen of every deployment could only ever fail.
 *
 * The client secret goes to the sealed store and the row keeps a `kms://` pointer (rule 10),
 * the same path the mail key and the provider credentials take.
 */

const HERE = '/settings/sso';

function back(outcome: string): never {
  redirect(`${HERE}?outcome=${outcome}`);
}

export async function configureIdpAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const tenantId = await currentTenantId();
  const issuer = String(formData.get('issuer') ?? '').trim();
  const clientId = String(formData.get('client_id') ?? '').trim();
  const clientSecret = String(formData.get('client_secret') ?? '').trim();
  const discoveryUrl = String(formData.get('discovery_url') ?? '').trim();
  const defaultRole = String(formData.get('default_role') ?? '') as SsoRole | '';
  const allowJit = formData.get('allow_jit') === 'on';
  const enforceSso = formData.get('enforce_sso') === 'on';

  if (issuer === '' || clientId === '' || discoveryUrl === '') {
    back('failed');
  }

  const ref = `kms://tenants/${tenantId}/idp`;
  const store = secretStoreFromEnv();

  if (clientSecret !== '') {
    if (!store.writable || !store.put) {
      back('failed');
    }
    await store.put(ref, { clientSecret });
  } else {
    // Nothing typed and nothing stored is a configuration that cannot complete a sign in.
    const stored = await store.fetch(ref).catch(() => null);
    if (!stored?.['clientSecret']) {
      back('secret');
    }
  }

  try {
    await query(async (tx) => {
      if (enforceSso) {
        // Closing the password door with no proved domain locks everybody out of their own
        // workspace, and the only way back is us. The screen hides the switch; this refuses
        // it, because a hidden control is not a rule.
        const domains = await listSsoDomains(tx);
        if (!domains.some((domain) => domain.verified)) {
          throw new Error('no verified domain');
        }
      }
      await configureIdp(
        tx,
        {
          issuer,
          clientId,
          clientSecretRef: ref,
          discoveryUrl,
          defaultRole: defaultRole === '' ? null : defaultRole,
          allowJit,
          enforceSso,
        },
        user.userId,
      );
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back((error as Error).message === 'no verified domain' ? 'no-verified-domain' : 'failed');
  }

  revalidatePath(HERE);
  back('configured');
}

export async function claimDomainAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const domain = String(formData.get('domain') ?? '');

  try {
    await query(async (tx) => {
      const claimed = await claimSsoDomain(tx, domain);
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'sso.domain_claimed',
        target: claimed.domain,
        metadata: { domain: claimed.domain },
      });
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    const code = (error as { code?: string }).code;
    back(code === 'NX-4091' ? 'taken' : code === 'NX-4002' ? 'domain' : 'failed');
  }

  revalidatePath(HERE);
  back('claimed');
}

/**
 * Looks for the record, and proves the domain if it is there.
 *
 * Not finding it is the normal first answer, not a failure: somebody has just been told to
 * edit their DNS and zones take minutes, sometimes hours.
 */
export async function verifyDomainAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const domain = String(formData.get('domain') ?? '');
  if (domain === '') {
    back('failed');
  }

  let verified = false;
  try {
    verified = await query(async (tx) => {
      const row = await verifySsoDomain(tx, domain, (name) => resolveTxt(name));
      if (row.verified) {
        await audit(tx, {
          actorType: 'USER',
          actorId: user.userId,
          action: 'sso.domain_verified',
          target: domain,
          metadata: { domain },
        });
      }
      return row.verified;
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back('failed');
  }

  revalidatePath(HERE);
  back(verified ? 'verified' : 'not-found');
}

export async function removeDomainAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  const domain = String(formData.get('domain') ?? '');
  if (domain === '') {
    back('failed');
  }

  await query(async (tx) => {
    await removeSsoDomain(tx, domain);
    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action: 'sso.domain_removed',
      target: domain,
      metadata: { domain },
    });
  });

  revalidatePath(HERE);
  back('removed');
}

/** A redirect inside a try is a thrown value, not a failure: it has to travel. */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}
