import { NxError } from '@nx-verify/core';
import type { SecretStore } from '@nx-verify/providers';
import type { CredentialState } from '../../../../../components/operator-binding';

/**
 * What the secret store says about one binding's reference, in the three answers there are.
 *
 * Read by the screen that shows the bindings and by the action that writes one, because the
 * two have to agree: a save is refused for «there is nothing there» in different words than
 * for «the store did not answer», and the row on the screen carries the same distinction in
 * its colour. Both used to flatten every failure into «nothing is stored under this
 * reference» (ADR-179), which is the one sentence that sends a member of staff looking for a
 * secret that may be exactly where they left it.
 *
 * Nothing that comes back carries material: SecretDescription holds a fingerprint per secret
 * field and a mask per identifier, and this adds only the error code to it (rule 10).
 */
/**
 * Which reference this save has to ask the store about, if any (ADR-185).
 *
 * Here rather than inline in the action, because the hint under the field on the screen
 * promises exactly this and the two have to be changed together: the hint said the store is
 * asked before every save while the action asked only when the row would serve afterwards, so
 * saving a new reference onto a stopped binding wrote it unasked under a sentence saying it had
 * been checked.
 *
 * The rule itself stands (ADR-179): a binding that will not serve sends nothing, so a reference
 * with nothing behind it is harmless there, and asking anyway would refuse the one act somebody
 * needs while a store is down, which is stopping the binding that depends on it. A reference on
 * a stopped row is asked about the moment the row is switched on.
 */
export function referenceToAsk(save: {
  willServe: boolean;
  credentialRef: string | null;
}): string | null {
  return save.willServe ? save.credentialRef : null;
}

export async function credentialState(
  store: SecretStore,
  ref: string | null,
): Promise<CredentialState> {
  if (ref === null) {
    return { state: 'unset' };
  }

  /**
   * Three answers and no fourth. The branch for a store without describe is gone with the
   * optional marker on the method (ADR-185): every store implements it, so the branch was
   * unreachable, and what it rendered was the red of «تعذّر سؤال خزنة الأسرار», a failure that
   * had happened, for a capability that was merely absent. An unreachable sentence nobody can
   * read is the kind that stops being checked and then stops being true.
   */
  try {
    const description = await store.describe(ref);
    return description === null
      ? { state: 'empty', ref }
      : { state: 'held', ref, credential: description };
  } catch (error) {
    // Our own code, never the store's message: the detail of a secret manager failure is for
    // the log of whoever runs the deployment, and the screen needs the fact and the code.
    return { state: 'unanswered', ref, code: error instanceof NxError ? error.code : null };
  }
}
