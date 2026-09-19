'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  assertCan,
  audit,
  pauseMonitor,
  resumeMonitor,
  riyalsToHalalas,
  setMonitorBudget,
} from '@nx-verify/core';
import { actingUser, query } from '../../../../lib/context';

/**
 * Stopping and starting a monitor (ADR-152).
 *
 * `pauseMonitor` had no caller anywhere and there was no monitors screen, so a monitor once
 * started kept spending until it hit its ceiling and nothing could stop it. Money leaving
 * with no stop is the dead control that gets expensive rather than merely annoying.
 */

const HERE = '/customers/monitoring';

function back(outcome: string): never {
  redirect(`${HERE}?outcome=${outcome}`);
}

export async function pauseMonitorAction(formData: FormData): Promise<void> {
  await move(formData, 'pause');
}

export async function resumeMonitorAction(formData: FormData): Promise<void> {
  await move(formData, 'resume');
}

/**
 * Moving the ceiling, which is the only thing that restarts an exhausted monitor.
 *
 * The screen said «ارفع السقف» beside a monitor that had stopped and offered nothing that
 * could raise it, and no ceiling could be changed anywhere in the platform, so paid
 * monitoring on a customer ended for good the first time it reached the cap its own
 * subscriber had set.
 */
export async function raiseMonitorBudgetAction(formData: FormData): Promise<void> {
  const user = await actingUser();
  assertCan(user.capabilities, 'monitoring.manage');

  const monitorId = String(formData.get('monitor_id') ?? '');
  // Typed in riyals, because that is what the figure beside it on screen is in. Halalas are
  // the only thing the domain is told, so nothing downstream has to guess the unit.
  const amount = Number(formData.get('budget_cap') ?? '');
  if (monitorId === '' || !Number.isFinite(amount) || amount <= 0) {
    back('failed');
  }

  // The cap change writes its own audit entry, so there is no second one here.
  const change = await query((tx) =>
    setMonitorBudget(tx, {
      monitorId,
      budgetCapPerPeriod: riyalsToHalalas(amount),
      changedBy: user.userId,
    }),
  );

  revalidatePath(HERE);
  // Three different things can have happened and they are not interchangeable: a monitor
  // watching again, one still stopped because the new ceiling was no higher than the spend,
  // and a ceiling that simply moved on something that was running anyway.
  if (change.resumed) {
    back('raised');
  }
  back(change.status === 'budget_exhausted' ? 'cap_too_low' : 'cap_changed');
}

async function move(formData: FormData, how: 'pause' | 'resume'): Promise<void> {
  // Here rather than in each caller: pausing had no check while resuming did, and pausing is
  // the half that stops paid monitoring. A guard each wrapper must remember gets forgotten.
  const user = await actingUser();
  assertCan(user.capabilities, 'monitoring.manage');
  const monitorId = String(formData.get('monitor_id') ?? '');
  if (monitorId === '') {
    back('failed');
  }

  await query(async (tx) => {
    if (how === 'pause') {
      await pauseMonitor(tx, monitorId);
    } else {
      await resumeMonitor(tx, monitorId);
    }
    await audit(tx, {
      actorType: 'USER',
      actorId: user.userId,
      action: how === 'pause' ? 'monitor.paused' : 'monitor.resumed',
      target: monitorId,
      metadata: {},
    });
  });

  revalidatePath(HERE);
  back(how === 'pause' ? 'paused' : 'resumed');
}
