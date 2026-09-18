'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertCan, audit, createPortfolio, setPortfolioTtl, type Cadence } from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Making a group, and giving it a policy (ADR-147).
 *
 * «محفظة جديدة» was a submit button with no form around it, and the screen's own subtitle
 * promised per-group durations, decision rules and monitoring, none of which could be set.
 * `createPortfolio` was reachable only from tests.
 *
 * A group is not a folder. It carries policy: what product a new member is verified with,
 * which ruleset decides them, whether they are watched and for how much. That is the reason
 * to have one at all, so the form asks for those at the moment the group is made rather than
 * leaving a shell nobody comes back to configure.
 */

const HERE = '/settings/portfolios';

function back(outcome: string): never {
  redirect(`${HERE}?outcome=${outcome}`);
}

/** A code a person types: letters, digits and an underscore, upper cased. */
function codeFrom(raw: string): string | null {
  const code = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return /^[A-Z0-9_]{2,40}$/.test(code) ? code : null;
}

export async function createPortfolioAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const code = codeFrom(String(formData.get('code') ?? ''));
  const nameAr = String(formData.get('name_ar') ?? '').trim();
  const monitorByDefault = formData.get('monitor_by_default') === 'on';
  const cadence = String(formData.get('monitor_cadence') ?? '') as Cadence | '';
  const budgetRiyals = Number(formData.get('monitor_budget') ?? NaN);
  const alertOnEnter = formData.get('alert_on_enter') === 'on';
  const defaultProductCode = String(formData.get('default_product') ?? '').trim();

  if (code === null || nameAr === '') {
    back('invalid');
  }
  // A budget is in halalas everywhere below the screen (ADR-021); the field asks for riyals
  // because that is what a person says out loud.
  const monitorBudget =
    Number.isFinite(budgetRiyals) && budgetRiyals > 0 ? Math.round(budgetRiyals * 100) : null;
  if (monitorByDefault && monitorBudget === null) {
    // Watching with no ceiling is how a group quietly spends a workspace's balance.
    back('budget');
  }

  try {
    await query(async (tx) => {
      const portfolioId = await createPortfolio(tx, {
        code,
        nameAr,
        // The English name is not asked for: this console is Arabic, and a second name
        // somebody types once and never reads is a field that goes stale.
        nameEn: code,
        monitorByDefault,
        monitorCadence: cadence === '' ? null : cadence,
        monitorBudget,
        alertOnEnter,
        defaultProductCode: defaultProductCode === '' ? null : defaultProductCode,
      });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'portfolio.created',
        target: portfolioId,
        metadata: { code, monitor_by_default: monitorByDefault, monitor_budget: monitorBudget },
      });
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back((error as { code?: string }).code === 'NX-4091' ? 'exists' : 'failed');
  }

  revalidatePath(HERE);
  back('created');
}

/**
 * A duration for one field, for the members of one group.
 *
 * Shorter than the workspace's own wins, which is the rule ADR-035 settled: where two groups
 * disagree the shorter duration is the one that applies, because the safe direction for
 * «how long do we trust this» is down.
 */
export async function setPortfolioTtlAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const portfolioId = String(formData.get('portfolio_id') ?? '');
  const fieldPath = String(formData.get('field_path') ?? '').trim();
  const ttlDays = Number(formData.get('ttl_days') ?? NaN);
  const weight = Number(formData.get('weight') ?? 5);

  if (portfolioId === '' || fieldPath === '' || !Number.isFinite(ttlDays) || ttlDays <= 0) {
    back('invalid');
  }

  try {
    await query(async (tx) => {
      await setPortfolioTtl(tx, portfolioId, fieldPath, ttlDays, weight);
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'portfolio.ttl_set',
        target: portfolioId,
        metadata: { field_path: fieldPath, ttl_days: ttlDays },
      });
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    back('failed');
  }

  revalidatePath(HERE);
  back('ttl');
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
