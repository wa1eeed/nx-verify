'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertCan, audit, forkRuleset, setRuleOutcome } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Having decision rules of your own (ADR-149).
 *
 * «حفظ القواعد» and «محاكاة قبل الحفظ» were both dead submits, and unlike the other screens
 * in this sweep there was nothing in the domain to wire them to: the engine could read
 * rulesets, decide with one and simulate one, and no code anywhere could write one. Every
 * workspace ran on whatever the seed put in the database, permanently.
 *
 * The platform's own defaults stay out of reach, which is correct: every workspace inherits
 * them. So the act this screen offers is **fork, then move an outcome**. That is also the
 * question people actually ask: «what if these went to review instead of being refused».
 *
 * Changing what a rule *looks at* is a different act and is not offered from a dropdown.
 * Conditions are a closed set (ADR-031) and building one is a rule builder, a later unit.
 */

const HERE = '/settings/rules';

function back(rulesetId: string | null, outcome: string): never {
  const at = rulesetId === null ? '' : `ruleset=${rulesetId}&`;
  redirect(`${HERE}?${at}outcome=${outcome}`);
}

/** A code a person types: letters, digits and an underscore, upper cased. */
function codeFrom(raw: string): string | null {
  const code = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return /^[A-Z0-9_]{2,40}$/.test(code) ? code : null;
}

export async function forkRulesetAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'rules.manage');
  const user = await actingUser();
  const fromRulesetId = String(formData.get('from_ruleset') ?? '');
  const code = codeFrom(String(formData.get('code') ?? ''));
  const nameAr = String(formData.get('name_ar') ?? '').trim();

  if (fromRulesetId === '' || code === null || nameAr === '') {
    back(null, 'invalid');
  }

  let created: string;
  try {
    created = await query(async (tx) => {
      const id = await forkRuleset(tx, { fromRulesetId, code, nameAr });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'ruleset.forked',
        target: id,
        metadata: { code, from: fromRulesetId },
      });
      return id;
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back(null, (error as { code?: string }).code === 'NX-4091' ? 'exists' : 'failed');
  }

  revalidatePath(HERE);
  back(created, 'forked');
}

export async function setRuleOutcomeAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'rules.manage');
  const user = await actingUser();
  const rulesetId = String(formData.get('ruleset_id') ?? '');
  const seq = Number(formData.get('seq') ?? NaN);
  const outcome = String(formData.get('outcome') ?? '') as 'PASS' | 'FAIL' | 'REVIEW';

  if (rulesetId === '' || !Number.isInteger(seq)) {
    back(null, 'invalid');
  }

  try {
    await query(async (tx) => {
      await setRuleOutcome(tx, { rulesetId, seq, outcome });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'ruleset.rule_changed',
        target: rulesetId,
        // Which rule and what it decides now. This is the row read when somebody asks why
        // a customer was refused in March and reviewed in April.
        metadata: { seq, outcome },
      });
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back(rulesetId, (error as { code?: string }).code === 'NX-4031' ? 'default' : 'failed');
  }

  revalidatePath(HERE);
  back(rulesetId, 'saved');
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
