'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addToPortfolio,
  assertCan,
  audit,
  createPortfolio,
  removeFromPortfolio,
  setPortfolioTtl,
  type Cadence,
} from '@nx-verify/core';
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
 *
 * Two of those it asked for and never received. `default_product` was read from a field the
 * form did not have, so every group was created with no product and every member who joined
 * a watching group started no monitor: a ceiling set, a cadence set, and nothing watched.
 * `decisionRuleset` was never passed at all, which also stranded the rules screen, since a
 * forked ruleset only decides anything through a group. Both are fields on the form now.
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
  const defaultProductCode = String(formData.get('default_product') ?? '').trim();
  const decisionRuleset = String(formData.get('decision_ruleset') ?? '').trim();

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
  if (monitorByDefault && defaultProductCode === '') {
    // A monitor repeats one product. Accepting the toggle without one is how the ceiling and
    // the cadence were saved for a group that watched nobody, and said nothing about it.
    back('product');
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
        defaultProductCode: defaultProductCode === '' ? null : defaultProductCode,
        decisionRuleset: decisionRuleset === '' ? null : decisionRuleset,
      });
      await audit(tx, {
        actorType: 'USER',
        actorId: user.userId,
        action: 'portfolio.created',
        target: portfolioId,
        metadata: {
          code,
          monitor_by_default: monitorByDefault,
          monitor_budget: monitorBudget,
          default_product: defaultProductCode === '' ? null : defaultProductCode,
          decision_ruleset: decisionRuleset === '' ? null : decisionRuleset,
        },
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
 *
 * No screen imported this, so the only part of the header's promise that could be kept after
 * a group was created was kept by nobody, and the notice it redirects to was unreachable text.
 * The groups screen posts to it now.
 */
export async function setPortfolioTtlAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  assertCan(actor.capabilities, 'settings.manage');
  const user = await actingUser();
  const portfolioId = String(formData.get('portfolio_id') ?? '');
  const fieldPath = String(formData.get('field_path') ?? '').trim();
  const ttlDays = Number(formData.get('ttl_days') ?? NaN);
  const weight = Number(formData.get('weight') ?? 10);

  // Its own refusal, not the create form's: «لم تُنشأ: الرمز حروف وأرقام» is a sentence about
  // a group nobody was making, and a wrong reason is worse than a vague one.
  if (portfolioId === '' || fieldPath === '' || !Number.isFinite(ttlDays) || ttlDays <= 0) {
    back('ttl_invalid');
  }
  // The same bounds the retention screen enforces. Two screens writing one column under two
  // sets of rules is how a field ends up scored differently depending on where it was set.
  if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
    back('ttl_invalid');
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

/**
 * Putting a customer in a group, and taking them out again (ADR-176).
 *
 * `addToPortfolio` is the only writer of `portfolio_members`, and until now its only caller
 * in the product was `POST /v1/portfolios/:id/members` in the API. So a subscriber who wrote
 * code against the API could fill a group, and a subscriber who used the console could not:
 * every promise this screen makes was made about a table it had no way to write to, the
 * count column read zero, the ruleset a group carries decided nobody, and the monitoring
 * ADR-167 built inside `addToPortfolio` started only for whoever called the endpoint.
 * `removeFromPortfolio` had no caller at all, so nothing could undo an add either.
 *
 * The capability is not this screen's. Making a group and giving it a policy is
 * `settings.manage`, which is why the page asks for it; naming a customer and putting them
 * under a policy is an act on a customer, so it asks for `customers.read`, and when the
 * group watches its members it asks for `monitoring.manage` as well, because that add starts
 * a monitor that spends the workspace's balance on a schedule. Both are enforced here rather
 * than left to the page: hiding a form is a courtesy, the form still posts.
 */

/** The ids of one membership, or null when the form arrived without them. */
function membershipFrom(formData: FormData): { portfolioId: string; entityId: string } | null {
  const portfolioId = String(formData.get('portfolio_id') ?? '').trim();
  const entityId = String(formData.get('entity_id') ?? '').trim();
  return portfolioId === '' || entityId === '' ? null : { portfolioId, entityId };
}

export async function addMemberAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  // Said as a refusal on the screen rather than thrown. A capability error escaping a server
  // action replaces the whole console with an error page, and «you may not do this» is a
  // sentence this screen already knows how to print.
  if (!actor.can('customers.read')) {
    back('member_denied');
  }
  const membership = membershipFrom(formData);
  if (membership === null) {
    back('member_invalid');
  }

  let outcome: string;
  try {
    outcome = await query(async (tx) => {
      const { rows } = await tx.query<{ monitor_by_default: boolean }>(
        `SELECT monitor_by_default FROM portfolios WHERE tenant_id = $1 AND id = $2`,
        [tx.tenantId, membership.portfolioId],
      );
      const portfolio = rows[0];
      if (!portfolio) {
        return 'member_missing';
      }
      // The group decides whether this add spends money, so the group decides which
      // capability the add needs.
      if (portfolio.monitor_by_default) {
        assertCan(actor.capabilities, 'monitoring.manage');
      }

      const result = await addToPortfolio(
        tx,
        membership.portfolioId,
        membership.entityId,
        actor.userId,
      );
      if (!result.added) {
        return 'member_exists';
      }
      // Three different things happened, and the screen says which. «Watching started» over
      // a monitor whose ceiling is spent is the same lie this whole change is about.
      if (result.monitoring === 'running') {
        return 'member_watched';
      }
      return result.monitoring === 'stopped' ? 'member_watch_stopped' : 'member_added';
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    outcome = refusal(error);
  }

  revalidatePath(HERE);
  back(outcome);
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const actor = await actingUser();
  // Stopping the spending is not gated on the capability to start it. Somebody who may see
  // this customer may take them out of a group, and a person able to see that a customer is
  // being watched by mistake must be able to end it.
  if (!actor.can('customers.read')) {
    back('member_denied');
  }
  const membership = membershipFrom(formData);
  if (membership === null) {
    back('member_invalid');
  }

  let outcome: string;
  try {
    outcome = await query(async (tx) => {
      const result = await removeFromPortfolio(
        tx,
        membership.portfolioId,
        membership.entityId,
        actor.userId,
      );
      if (!result.removed) {
        return 'member_gone';
      }
      return result.monitorsStopped > 0 ? 'member_removed_stopped' : 'member_removed';
    });
  } catch (error) {
    if (isRedirect(error)) {
      throw error;
    }
    outcome = refusal(error);
  }

  revalidatePath(HERE);
  back(outcome);
}

/**
 * Why a membership change did not happen, told apart rather than flattened to «failed».
 *
 * A refused capability and a customer that is not there are different mistakes with
 * different fixes, and one message for both sends somebody looking in the wrong place.
 */
function refusal(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === 'NX-4031') {
    return 'member_denied';
  }
  // 23503 is a foreign key: the customer named on the form is not in this workspace.
  return code === 'NX-4041' || code === '23503' ? 'member_missing' : 'failed';
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
