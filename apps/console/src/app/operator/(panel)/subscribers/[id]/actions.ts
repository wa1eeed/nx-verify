'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  BINDING_CREDENTIAL_UNSEALED,
  NxError,
  listCatalog,
  listTenantBindings,
  setTenantBinding,
} from '@nx-verify/core';
import { secretStoreFromEnv } from '@nx-verify/providers';
import {
  operatorQuery,
  operatorTransaction,
  requireOperatorPermission,
} from '../../../../../lib/operator';
import { credentialState } from './credential';

/**
 * Whose account one subscriber's calls go out on (ADR-005).
 *
 * Guarded by the integration permission rather than the subscribers one: support moves plans and
 * stops accounts, but pointing a binding at a credential is the same act as setting the
 * platform's own connection, and it is owners who do that. The screen hides these controls from
 * everybody else and this refuses them again, because the form is still submittable.
 *
 * No value passes through here. The form carries a kms:// reference and the material lives in
 * the secret store (rule 10), so nothing in this file, its redirects or its audit trail can
 * carry a credential.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tenantOf(formData: FormData): string {
  const tenantId = String(formData.get('tenant_id') ?? '');
  if (!UUID.test(tenantId)) {
    redirect('/operator/subscribers');
  }
  return tenantId;
}

function back(tenantId: string, outcome: string): never {
  revalidatePath(`/operator/subscribers/${tenantId}`);
  redirect(`/operator/subscribers/${tenantId}?${outcome}`);
}

export async function setSourceAction(formData: FormData): Promise<void> {
  const actor = await requireOperatorPermission('integration');
  const tenantId = tenantOf(formData);
  const provider = String(formData.get('provider') ?? '').trim();
  const typedRef = String(formData.get('credential_ref') ?? '').trim();
  const rawActivate = String(formData.get('activate') ?? '');
  // The row's own button carries activate and nothing else, so stopping or starting a binding
  // never rewrites the mode or the reference it was set up with.
  const toggling = rawActivate !== '';

  const current = await operatorQuery(async (db) => ({
    binding:
      (await listTenantBindings(db, tenantId)).find((entry) => entry.provider === provider) ?? null,
    catalogue: await listCatalog(db),
  }));

  if (provider === '' || !current.catalogue.some((entry) => entry.code === provider)) {
    back(tenantId, 'refused=source');
  }
  if (toggling && current.binding === null) {
    back(tenantId, 'refused=source');
  }

  const mode = toggling
    ? (current.binding?.mode ?? 'MANAGED')
    : String(formData.get('mode') ?? '') === 'BYOC'
      ? 'BYOC'
      : 'MANAGED';

  /**
   * A reference left empty keeps what is stored, with one exception.
   *
   * Moving a binding down from the subscriber's own account to ours must drop their reference,
   * or their key keeps serving the calls while we bill them as if we had paid for the calls
   * ourselves. Typing a reference on the same save overrides that: a managed binding may have a
   * platform credential of its own.
   */
  const demoted = mode === 'MANAGED' && current.binding?.mode === 'BYOC';
  const credentialRef = toggling
    ? (current.binding?.credentialRef ?? null)
    : typedRef !== ''
      ? typedRef
      : demoted
        ? null
        : (current.binding?.credentialRef ?? null);

  if (typedRef !== '' && !typedRef.startsWith('kms://')) {
    back(tenantId, 'refused=source_ref');
  }
  if (mode === 'BYOC' && credentialRef === null) {
    back(tenantId, 'refused=source_byoc');
  }

  const typedPriority = String(formData.get('priority') ?? '').trim();
  const priority = toggling
    ? (current.binding?.priority ?? 100)
    : typedPriority === ''
      ? (current.binding?.priority ?? 100)
      : Number(typedPriority);
  if (!Number.isSafeInteger(priority) || priority <= 0) {
    back(tenantId, 'refused=source');
  }

  // Started where it was started: saving a change to a stopped binding must not switch it on,
  // and a binding that did not exist is written ready to serve.
  const activate = toggling ? rawActivate === '1' : (current.binding?.activatedAt ?? null) !== null;
  const willServe = current.binding === null ? true : activate;

  /**
   * Whether the store holds anything under the reference, asked before the row is written.
   *
   * Asked only about a row that will serve after this save. A binding being switched off sends
   * nothing, so a reference with nothing behind it is harmless there, and asking anyway would
   * refuse the one act that makes it harmless: the row whose secret was removed from the store
   * is exactly the row somebody needs to stop, and it carries its reference into this save
   * because the row's own button sends the mode and the reference untouched.
   *
   * Asked once, here, rather than inside the write. setTenantBinding takes a predicate that
   * answers yes or no, and a store that did not answer has no place in a yes or no: a failure
   * turned into «no» refuses the save with «there is nothing stored under that reference»,
   * which is a sentence about the operator's input and this is not the operator's doing
   * (ADR-179). So the three answers are separated before the domain sees any of them.
   *
   * A store that did not answer refuses the save rather than skipping the check. The screen
   * promises that the reference is checked before the row is written, and saving without it
   * would make that promise false; and a secret store that cannot be reached is a store no
   * verification can read either, so nothing this binding would serve is working anyway.
   */
  const held =
    willServe && credentialRef !== null
      ? await credentialState(secretStoreFromEnv(), credentialRef)
      : null;
  if (held?.state === 'unanswered') {
    back(tenantId, 'refused=source_store');
  }

  try {
    await operatorTransaction((db) =>
      setTenantBinding(
        db,
        {
          tenantId,
          provider,
          mode,
          credentialRef,
          priority,
          // Which endpoints this binding narrows to is not a decision this screen offers, so it
          // carries the row's own value rather than resetting it to «every endpoint».
          endpoints: current.binding?.endpoints ?? null,
          activate: willServe,
        },
        actor.id,
        held === null
          ? {}
          : // The answer above, about this same reference, handed over rather than asked again.
            { credentialExists: () => Promise.resolve(held.state === 'held') },
      ),
    );
  } catch (error) {
    if (!(error instanceof NxError)) {
      throw error;
    }
    back(
      tenantId,
      error.message.includes(BINDING_CREDENTIAL_UNSEALED)
        ? 'refused=source_unsealed'
        : 'refused=source',
    );
  }

  back(
    tenantId,
    toggling
      ? rawActivate === '1'
        ? 'saved=source_started'
        : 'saved=source_stopped'
      : 'saved=source',
  );
}
