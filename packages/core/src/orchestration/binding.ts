import { NxError } from '../errors.js';

/**
 * Building a provider request from input_binding.
 *
 * Three reference forms and no more, from docs/03-products.md section 2:
 *
 *   $.subject.<path>          from what the customer sent
 *   $.steps.<step>.<path>     from an earlier step's output
 *   literal:<value>           a constant
 *
 * The deliberate absence here is any expression language. A binding is a lookup, not a
 * program. Anything richer would put product behaviour back into something that needs
 * testing and deploying, which is exactly what rule 8 exists to prevent.
 */

export interface BindingContext {
  subject: Readonly<Record<string, unknown>>;
  steps: Readonly<Record<string, Readonly<Record<string, unknown>> | null>>;
}

export function resolveBinding(
  binding: Readonly<Record<string, string>>,
  context: BindingContext,
): Record<string, unknown> {
  const request: Record<string, unknown> = {};

  for (const [field, reference] of Object.entries(binding)) {
    const value = resolveReference(reference, context);
    if (value !== undefined) {
      request[field] = value;
    }
  }

  return request;
}

function resolveReference(reference: string, context: BindingContext): unknown {
  if (reference.startsWith('literal:')) {
    return reference.slice('literal:'.length);
  }

  if (reference.startsWith('$.subject.')) {
    return readPath(context.subject, reference.slice('$.subject.'.length));
  }

  if (reference.startsWith('$.steps.')) {
    const rest = reference.slice('$.steps.'.length);
    const separator = rest.indexOf('.');
    if (separator === -1) {
      throw new NxError('NX-4001', { detail: `step reference has no field path: ${reference}` });
    }
    const stepKey = rest.slice(0, separator);
    const output = context.steps[stepKey];
    if (output === undefined) {
      throw new NxError('NX-4001', {
        detail: `binding refers to step ${stepKey}, which is not a dependency of this step`,
      });
    }
    return output === null ? undefined : readPath(output, rest.slice(separator + 1));
  }

  throw new NxError('NX-4001', { detail: `unsupported binding reference: ${reference}` });
}

function readPath(source: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
