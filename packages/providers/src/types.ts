/**
 * The provider contract.
 *
 * ADR-006: every provider call goes through this interface, and the domain layer never
 * calls a provider directly. Unit 9 is the test of whether that held: if wiring a real
 * provider needs a change anywhere outside this package, the abstraction failed.
 *
 * Note what a provider does NOT decide: the field paths, the entity model, the decision,
 * the price, or the shape of anything a caller sees. A provider returns a flat bag of
 * data and an outcome. The normalisation layer (unit 5) turns that into attestations
 * through step_field_map, so our response resembles no provider's response.
 */

/** Normalised outcome. A provider's own status codes never travel further than here. */
export type ProviderOutcome = 'OK' | 'NOT_FOUND' | 'ERROR';

/**
 * Normalised failure reasons. Deliberately small: the domain layer decides what to do
 * about a failure, and it can only do that if failures come in a known set.
 */
export type ProviderErrorCode =
  'NETWORK' | 'TIMEOUT' | 'AUTH' | 'RATE_LIMIT' | 'UPSTREAM' | 'MALFORMED' | 'UNSUPPORTED_ENDPOINT';

export type ProviderMode = 'MANAGED' | 'BYOC';

/**
 * A credential that has already been fetched from the KMS. It exists only for the life
 * of a call. Rule 10: it is never persisted, never logged, and never returned.
 */
export interface ResolvedCredential {
  /** The KMS reference this came from. Safe to log, unlike the material. */
  ref: string;
  mode: ProviderMode;
  material: Readonly<Record<string, string>>;
}

export interface ProviderRequest {
  endpoint: string;
  input: Readonly<Record<string, unknown>>;
  credential: ResolvedCredential;
  /** Passed through to providers that support it, so a retry is not a second charge. */
  idempotencyKey?: string | undefined;
  /**
   * Forces a named answer, in a sandbox only.
   *
   * A real provider ignores it: it has no way to be told what to reply, and would not be
   * asked. The stub honours it so a customer's QA team can run the case they wrote rather
   * than looking up which identifier produces it.
   */
  testScenario?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface ProviderResult {
  outcome: ProviderOutcome;
  /**
   * The official body the data came from, such as the commercial registry. This is the
   * only provenance field that reaches a caller (rule 5).
   */
  authority: string | null;
  /** Flat provider output. The normalisation layer maps it, nothing else reads it. */
  data: Readonly<Record<string, unknown>> | null;
  latencyMs: number;
  errorCode?: ProviderErrorCode | undefined;
  retryable?: boolean | undefined;
  /** What the provider actually charged us, when it tells us. */
  providerCost?: number | undefined;
}

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  checkedAt: Date;
  latencyMs?: number | undefined;
  detail?: string | undefined;
}

export interface VerificationProvider {
  /** Internal identifier. Rule 5: this string must never reach a caller. */
  readonly name: string;
  /** Endpoints this provider can serve. product_steps.endpoint refers to these. */
  readonly endpoints: readonly string[];
  execute(request: ProviderRequest): Promise<ProviderResult>;
  healthCheck(credential: ResolvedCredential): Promise<ProviderHealth>;
}
