import { NxError } from '../errors.js';
import type { ProductStepDefinition } from '../products/catalog.js';

/**
 * Turning depends_on into an execution order.
 *
 * The steps form a directed acyclic graph. Independent steps run together, dependants
 * wait. The waves this produces are what makes a composite product take as long as its
 * longest chain rather than the sum of its steps.
 */

export interface ExecutionPlan {
  /** Steps grouped into waves. Everything inside a wave may run in parallel. */
  waves: ProductStepDefinition[][];
  /** Direct dependants, used to cascade a SKIPPED status. */
  dependants: ReadonlyMap<string, readonly string[]>;
}

export function planExecution(steps: readonly ProductStepDefinition[]): ExecutionPlan {
  const byKey = new Map(steps.map((step) => [step.stepKey, step]));

  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!byKey.has(dependency)) {
        throw new NxError('NX-5001', {
          detail: `step ${step.stepKey} depends on ${dependency}, which the product does not define`,
        });
      }
    }
  }

  const dependants = new Map<string, string[]>();
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      const list = dependants.get(dependency) ?? [];
      list.push(step.stepKey);
      dependants.set(dependency, list);
    }
  }

  const waves: ProductStepDefinition[][] = [];
  const done = new Set<string>();
  const remaining = [...steps];

  while (remaining.length > 0) {
    const ready = remaining.filter((step) =>
      step.dependsOn.every((dependency) => done.has(dependency)),
    );

    if (ready.length === 0) {
      // A cycle. This is a broken product definition, not a runtime condition, and it
      // must surface loudly rather than deadlock.
      throw new NxError('NX-5001', {
        detail: `product step dependencies contain a cycle among: ${remaining
          .map((step) => step.stepKey)
          .sort()
          .join(', ')}`,
      });
    }

    ready.sort((left, right) => left.seq - right.seq || left.stepKey.localeCompare(right.stepKey));
    waves.push(ready);
    for (const step of ready) {
      done.add(step.stepKey);
      remaining.splice(remaining.indexOf(step), 1);
    }
  }

  return { waves, dependants };
}

/**
 * Every step reachable from a failed step, directly or transitively.
 *
 * Used to mark dependants SKIPPED. The transitive part matters: in KYB_COMPLETE,
 * manager_auth depends on aoa which depends on cr_full, so a cr_full failure has to
 * reach manager_auth as well.
 */
export function collectDependants(
  dependants: ReadonlyMap<string, readonly string[]>,
  from: string,
): string[] {
  const collected = new Set<string>();
  const queue = [...(dependants.get(from) ?? [])];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || collected.has(next)) {
      continue;
    }
    collected.add(next);
    queue.push(...(dependants.get(next) ?? []));
  }

  return [...collected];
}
