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
export type {
  ProviderBinding,
  SecretDescription,
  SecretFetcher,
  SecretStore,
} from './credentials.js';
export { LayeredSecretStore, SealedFileSecretStore, describeMaterial } from './sealed-store.js';

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
export { LeanProvider, LEAN_ENDPOINTS } from './lean/lean-provider.js';
export type { LeanEndpointMapping, LeanProviderOptions } from './lean/lean-provider.js';
export { TokenCache } from './lean/token.js';
export type { TokenRequest } from './lean/token.js';
export { SANDBOX_TEST_CASES } from './stub/test-cases.js';
export type { SandboxTestCase } from './stub/test-cases.js';
export { SCENARIO_NAMES } from './stub/scenarios.js';
export {
  listOperatorChanges,
  listProviderConnections,
  recordConnectionTest,
  recordOperatorChange,
  registryFor,
  setProviderConnection,
  testClientCredentials,
} from './connections.js';
export type {
  ConnectionTestResult,
  OperatorChange,
  OperatorChangeRow,
  ProviderConnection,
  SetConnectionInput,
} from './connections.js';
export {
  httpMappingsFor,
  listProviderEndpoints,
  openBankingMappingsFor,
  setProviderEndpoint,
} from './endpoint-map.js';
export type { SetEndpointInput, StoredEndpoint } from './endpoint-map.js';
