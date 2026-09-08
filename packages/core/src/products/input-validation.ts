import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import { NxError } from '../errors.js';

/**
 * Validating a subject against the product's own schema.
 *
 * ADR-015: Zod validates the request envelope, whose shape is known at compile time.
 * The subject cannot be validated that way, because its schema is a row in the database
 * and a new product must not need a deployment (rule 8). JSON Schema is what the
 * catalog stores, so Ajv is what reads it.
 *
 * Validation happens before any provider is called, so a malformed request costs the
 * customer nothing. That is the difference between a 422 and a billing dispute.
 */

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });
const compiled = new Map<string, ValidateFunction>();

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function validateSubject(
  productCode: string,
  schema: Record<string, unknown>,
  subject: unknown,
): ValidationResult {
  const validate = compileSchema(productCode, schema);
  const valid = validate(subject);
  if (valid) {
    return { valid: true, issues: [] };
  }

  return {
    valid: false,
    issues: (validate.errors ?? []).map((error) => ({
      path: error.instancePath === '' ? '$' : `$${error.instancePath}`,
      // Ajv messages describe the schema, not the value, so nothing here can carry an
      // identifier out to a caller (rule 4).
      message: error.message ?? 'is invalid',
    })),
  };
}

export function assertValidSubject(
  productCode: string,
  schema: Record<string, unknown>,
  subject: unknown,
): void {
  const result = validateSubject(productCode, schema, subject);
  if (!result.valid) {
    throw new NxError('NX-4002', {
      detail: result.issues.map((issue) => `${issue.path} ${issue.message}`).join('; '),
    });
  }
}

function compileSchema(productCode: string, schema: Record<string, unknown>): ValidateFunction {
  const cached = compiled.get(productCode);
  if (cached) {
    return cached;
  }
  const validate = ajv.compile(schema);
  compiled.set(productCode, validate);
  return validate;
}

/** Called when a product definition changes, so the next call recompiles. */
export function invalidateSchemaCache(productCode?: string): void {
  if (productCode === undefined) {
    compiled.clear();
  } else {
    compiled.delete(productCode);
  }
}
