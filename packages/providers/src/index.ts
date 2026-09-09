export type {
  ProviderErrorCode,
  ProviderHealth,
  ProviderHealthStatus,
  ProviderMode,
  ProviderOutcome,
  ProviderRequest,
  ProviderResult,
  ResolvedCredential,
  VerificationProvider,
} from './types.js';

export { ProviderRegistry } from './registry.js';
export {
  EnvSecretStore,
  HttpSecretStore,
  InMemorySecretStore,
  getProviderBinding,
  resolveCredential,
  secretStoreFromEnv,
} from './credentials.js';
export type { ProviderBinding, SecretFetcher, SecretStore } from './credentials.js';

export { StubProvider } from './stub/stub-provider.js';
export type { StubProviderOptions } from './stub/stub-provider.js';
export { STUB_SCENARIOS, scenarioKeyFor } from './stub/scenarios.js';
export type { StubScenario, StubScenarioKind } from './stub/scenarios.js';

export { createProviderStepRunner } from './step-runner.js';
export type { StepDescriptor, StepRunResult, StepRunnerOptions } from './step-runner.js';

export { HttpVerificationProvider } from './http/http-provider.js';
export type { FetchLike, HttpProviderOptions } from './http/http-provider.js';
export { DEFAULT_ENDPOINTS, buildPath, mapResponse } from './http/response-mapping.js';
export type { EndpointMapping } from './http/response-mapping.js';
export { failureForStatus, failureForThrown, isSubjectAbsent } from './http/errors.js';
export type { NormalisedFailure } from './http/errors.js';

export { createProviderRegistry, providerConfigFromEnv } from './factory.js';
export type { ProviderConfig } from './factory.js';
