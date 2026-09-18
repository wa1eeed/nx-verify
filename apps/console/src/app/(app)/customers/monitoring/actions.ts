'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertCan, audit, pauseMonitor, resumeMonitor } from '@nx-verify/core';
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
  const actor = await actingUser();
  assertCan(actor.capabilities, 'monitoring.manage');
  await move(formData, 'resume');
}

async function move(formData: FormData, how: 'pause' | 'resume'): Promise<void> {
  const user = await actingUser();
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
