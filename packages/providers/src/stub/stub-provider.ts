import {
  DEFAULT_SCENARIO,
  STUB_SCENARIOS,
  scenarioKeyFor,
  type StubScenario,
} from './scenarios.js';
import type {
  ProviderHealth,
  ProviderRequest,
  ProviderResult,
  ResolvedCredential,
  VerificationProvider,
} from '../types.js';

/**
 * The stub provider.
 *
 * It answers with fixed data chosen by the identifier in the request, so the entire
 * platform can be built and tested before any provider account exists. It is not a mock
 * in the test double sense: it implements the same interface a real provider implements,
 * it is registered the same way, and the domain layer cannot tell the difference. That is
 * the point. If unit 9 needs to change anything outside this package to plug in a real
 * provider, the abstraction failed.
 */

const AUTHORITIES: Readonly<Record<string, string>> = {
  business_verification: 'Commercial Registry',
  articles_of_association: 'Ministry of Commerce',
  manager_permissions: 'Ministry of Commerce',
  ultimate_beneficial_owner: 'Commercial Registry',
  iban_ownership: 'Saudi Central Bank',
  freelancer_certificate: 'Ministry of Human Resources',
  // The open banking endpoints. The authority is who confirmed the fact, never who
  // carried the question (rule 5).
  bank_account_ownership: 'Confirmation of Payee',
  name_match: 'Account Holder Records',
  income_verification: 'Bank Statements',
};

export interface StubProviderOptions {
  /** Registered name. Overridable so a leak test can use a distinctive string. */
  name?: string;
  /** Fixed latency reported back, so tests are deterministic. */
  latencyMs?: number;
  /** Overrides the scenario lookup. Used to force a case in a test. */
  scenarioOverride?: StubScenario | undefined;
}

export class StubProvider implements VerificationProvider {
  readonly name: string;
  readonly endpoints = Object.keys(AUTHORITIES);

  readonly #latencyMs: number;
  readonly #override: StubScenario | undefined;
  #calls = 0;

  constructor(options: StubProviderOptions = {}) {
    this.name = options.name ?? 'stub';
    this.#latencyMs = options.latencyMs ?? 12;
    this.#override = options.scenarioOverride;
  }

  /** Number of calls made. Idempotency tests assert on this. */
  get callCount(): number {
    return this.#calls;
  }

  resetCallCount(): void {
    this.#calls = 0;
  }

  execute(request: ProviderRequest): Promise<ProviderResult> {
    this.#calls += 1;

    if (!this.endpoints.includes(request.endpoint)) {
      return Promise.resolve(this.#failure('UNSUPPORTED_ENDPOINT', false));
    }
    if (Object.keys(request.credential.material).length === 0) {
      return Promise.resolve(this.#failure('AUTH', false));
    }

    const key = scenarioKeyFor(request.input);
    const scenario =
      this.#override ??
      (key !== null ? (STUB_SCENARIOS.get(key) ?? DEFAULT_SCENARIO) : DEFAULT_SCENARIO);

    switch (scenario.kind) {
      case 'NOT_FOUND':
        return Promise.resolve({
          outcome: 'NOT_FOUND',
          authority: AUTHORITIES[request.endpoint] ?? null,
          data: null,
          latencyMs: this.#latencyMs,
        });

      case 'NETWORK':
      case 'AUTH':
        return Promise.resolve(
          this.#failure(scenario.errorCode ?? 'UPSTREAM', scenario.retryable ?? false),
        );

      case 'OK':
      case 'INCOMPLETE': {
        const data = scenario.data?.[request.endpoint];
        if (!data) {
          // The provider answered, and answered with nothing usable for this endpoint.
          return Promise.resolve({
            outcome: 'NOT_FOUND',
            authority: AUTHORITIES[request.endpoint] ?? null,
            data: null,
            latencyMs: this.#latencyMs,
          });
        }
        return Promise.resolve({
          outcome: 'OK',
          authority: AUTHORITIES[request.endpoint] ?? null,
          data,
          latencyMs: this.#latencyMs,
          providerCost: 0,
        });
      }
    }
  }

  healthCheck(credential: ResolvedCredential): Promise<ProviderHealth> {
    return Promise.resolve({
      status: Object.keys(credential.material).length > 0 ? 'healthy' : 'down',
      checkedAt: new Date(),
      latencyMs: this.#latencyMs,
    });
  }

  #failure(errorCode: ProviderResult['errorCode'], retryable: boolean): ProviderResult {
    return {
      outcome: 'ERROR',
      authority: null,
      data: null,
      latencyMs: this.#latencyMs,
      errorCode,
      retryable,
    };
  }
}
