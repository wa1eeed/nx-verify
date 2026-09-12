export { NxError } from './errors.js';
export type { NxErrorCode, NxErrorOptions } from './errors.js';
export { canonicalJson } from './canonical-json.js';
export {
  REDACTED,
  describeProviderInput,
  redactForLog,
  stripProviderNames,
} from './logging/redact.js';
export {
  assertNoProviderLeak,
  scrubText,
  toPublicResults,
  toPublicStepResult,
} from './public-view.js';
export type {
  InternalStepRecord,
  PublicResults,
  PublicStepResult,
  PublicStepStatus,
} from './public-view.js';

export { EnvMasterKeySource, StaticMasterKeySource } from './crypto/master-key.js';
export type { MasterKeySource } from './crypto/master-key.js';
export { DerivedTenantKeyProvider } from './crypto/tenant-keys.js';
export type { TenantKeyProvider } from './crypto/tenant-keys.js';
export {
  decryptIdentifier,
  encryptIdentifier,
  hashIdentifier,
  identifiersMatch,
  maskIdentifier,
  normalizeIdentifier,
  protectIdentifier,
} from './crypto/identifier.js';
export type { IdentifierType, ProtectedIdentifier } from './crypto/identifier.js';

export {
  attachIdentifier,
  findEntityIdByIdentifier,
  listIdentifiers,
  revealIdentifier,
} from './repositories/identifiers.js';
export type {
  AttachIdentifierInput,
  AttachedIdentifier,
  RevealedIdentifier,
} from './repositories/identifiers.js';

export {
  getAttestationTimeline,
  hashValue,
  recordAttestation,
} from './repositories/attestations.js';
export type {
  AttestationTimelineEntry,
  RecordAttestationInput,
  RecordAttestationResult,
} from './repositories/attestations.js';

export { getEntity, resolveEntity } from './repositories/entities.js';
export type {
  EntitySummary,
  EntityType,
  IdentifierInput,
  ResolveEntityInput,
  ResolvedEntity,
} from './repositories/entities.js';

export {
  clearTenantTtl,
  listFreshnessPolicy,
  previewTtlChange,
  setTenantTtl,
} from './repositories/freshness.js';
export type {
  FreshnessCounts,
  FreshnessPolicyRow,
  SetTtlInput,
  TtlChangePreview,
} from './repositories/freshness.js';

export { getEntityProfile } from './repositories/profile.js';
export type { Freshness, ProfileField } from './repositories/profile.js';

export { getProduct, listProducts, requireProduct } from './products/catalog.js';
export type {
  PartialPolicy,
  ProductDefinition,
  ProductStepDefinition,
  ProductSummary,
  SubjectType,
} from './products/catalog.js';
export {
  assertValidSubject,
  invalidateSchemaCache,
  validateSubject,
} from './products/input-validation.js';
export type { ValidationIssue, ValidationResult } from './products/input-validation.js';

export { resolveBinding } from './orchestration/binding.js';
export type { BindingContext } from './orchestration/binding.js';
export { collectDependants, planExecution } from './orchestration/plan.js';
export type { ExecutionPlan } from './orchestration/plan.js';
export { executeProduct } from './orchestration/executor.js';
export type {
  ExecuteProductInput,
  ExecutionOutcome,
  RunStatus,
  StepOutcome,
  StepRunner,
} from './orchestration/executor.js';
export { findRunByIdempotencyKey, getRun, recordRun } from './orchestration/run-recorder.js';
export type {
  CloseRunInput,
  OpenRunInput,
  OpenRunOutcome,
  RecordRunInput,
  RecordedRun,
  StoredRun,
  StoredRunStep,
  TriggeredBy,
} from './orchestration/run-recorder.js';

export { getFieldMappings, isIdentifierType } from './normalisation/field-map.js';
export type { EntityRole, FieldMapping, RelationType } from './normalisation/field-map.js';
export { readMatches, resolveReference } from './normalisation/paths.js';
export type { PathMatch } from './normalisation/paths.js';
export { endRelation, normaliseRun } from './normalisation/normalise.js';
export type {
  NormaliseInput,
  NormaliseResult,
  NormalisedChange,
} from './normalisation/normalise.js';
export { findEntitiesLinkedToMany, getRelations } from './normalisation/network.js';
export type { EntityLink, RelationEdge } from './normalisation/network.js';

export {
  HALALAS_PER_RIYAL,
  VAT_RATE,
  applyFraction,
  halalasToDecimalString,
  halalasToRiyals,
  riyalsToHalalas,
  vatOn,
} from './billing/money.js';
export { checkMargin, openPriceVersion, resolvePrice } from './billing/price-book.js';
export type {
  MarginCheck,
  OpenPriceInput,
  PriceRow,
  ResolvePriceOptions,
} from './billing/price-book.js';
export { computeBilling, maximumCharge } from './billing/compute.js';
export type { BillingBreakdown, StepCharge } from './billing/compute.js';
export {
  ensureWallet,
  getLedger,
  getWallet,
  hold,
  reconcile,
  releaseHold,
  settle,
  topUp,
  vatForTopUp,
} from './billing/wallet.js';
export type { LedgerEntry, SettleInput, TopUpInput, WalletState } from './billing/wallet.js';

export { assertBillingIsSane, getVerification, verify } from './verification/verify.js';
export type { VerifyInput, VerifyResult } from './verification/verify.js';

export {
  assertScope,
  authenticate,
  hashApiKey,
  issueApiKey,
  revokeApiKey,
  secureEquals,
  touchApiKey,
} from './auth/api-keys.js';
export type { AuthenticatedCaller, IssueKeyInput, IssuedKey } from './auth/api-keys.js';
export { audit, readAudit } from './auth/audit.js';
export type { ActorType, AuditEntry, AuditRecord } from './auth/audit.js';

export {
  DEFAULT_TOLERANCE_SECONDS,
  RETRY_DELAYS_SECONDS,
  SIGNATURE_HEADER,
  nextRetryAt,
  signPayload,
  verifySignature,
} from './webhooks/signing.js';
export {
  claimPendingDeliveries,
  listEndpoints,
  queueEvent,
  recordDeliveryResult,
  registerEndpoint,
} from './webhooks/dispatch.js';
export type {
  PendingDelivery,
  QueueEventInput,
  WebhookEndpoint,
  WebhookEventType,
} from './webhooks/dispatch.js';

export {
  acknowledgeChange,
  listChangeEvents,
  recordChangeEvent,
} from './monitoring/change-events.js';
export type {
  ChangeEventView,
  RecordChangeInput,
  RecordedChange,
  Severity,
} from './monitoring/change-events.js';
export {
  budgetRemaining,
  claimDueMonitors,
  createMonitor,
  findExpiringFields,
  nextRunFor,
  pauseMonitor,
  recordMonitorSpend,
  scheduleNextRun,
} from './monitoring/monitors.js';
export type {
  Cadence,
  CreateMonitorInput,
  DueMonitor,
  ExpiryAlert,
} from './monitoring/monitors.js';
export { computeScore, storeScore } from './monitoring/scoring.js';
export type { EntityScore, ScoreComponent } from './monitoring/scoring.js';
export {
  buildBundleContent,
  buildEvidenceContent,
  checkEvidence,
  evidenceKeyVersion,
  evidenceStorageKey,
  hashBundle,
  sealBundle,
  hashContent,
  resolvePublicEvidence,
  sealEvidence,
  signContent,
  verifySignature as verifyEvidenceSignature,
} from './evidence/evidence.js';
export type {
  BundleContent,
  BundleEntry,
  EvidenceContent,
  PublicEvidence,
  SealEvidenceInput,
  SealedBundle,
  SealedEvidence,
} from './evidence/evidence.js';

export { evaluate, isCondition } from './decision/conditions.js';
export type { Condition, ConditionOperator, EvaluationContext } from './decision/conditions.js';
export { decide, listRulesets, simulateRuleset, storeDecision } from './decision/engine.js';
export type {
  Decision,
  DecisionReason,
  Outcome,
  RulesetSummary,
  SimulationResult,
} from './decision/engine.js';

export {
  approveCase,
  assignCase,
  decideCase,
  listQueue,
  openCase,
  queueStats,
  returnCase,
} from './review/queue.js';
export type {
  CaseOutcome,
  CasePriority,
  CaseStatus,
  DecideCaseInput,
  OpenCaseInput,
  QueueFilter,
  QueueItem,
  QueueStats,
} from './review/queue.js';

export {
  addToPortfolio,
  createPortfolio,
  listPortfolios,
  membershipsOf,
  removeFromPortfolio,
  resolveRuleset,
  setPortfolioTtl,
} from './portfolios/portfolios.js';
export type {
  AddMemberResult,
  CreatePortfolioInput,
  Portfolio,
  PortfolioMembership,
  PortfolioPolicy,
} from './portfolios/portfolios.js';

export {
  cancelBatch,
  claimBatchItems,
  confirmBatch,
  createBatch,
  getBatch,
  previewBatch,
  recordBatchItem,
} from './batches/batches.js';
export type {
  BatchCriteria,
  BatchPreview,
  BatchStatus,
  BatchSummary,
  ConfirmBatchInput,
  CreateBatchInput,
  CreatedBatch,
  PendingBatchItem,
} from './batches/batches.js';

export { buildMonthlyReport, portfolioHealth, riskDashboard } from './reporting/dashboard.js';
export type {
  FreshnessDistribution,
  MonthlyReport,
  PortfolioHealth,
  RiskDashboard,
} from './reporting/dashboard.js';

export {
  assertRole,
  canAdminister,
  canApprove,
  canDecide,
  createSession,
  createUser,
  disableUser,
  getUser,
  hashSessionToken,
  listUsers,
  resolveSession,
  revokeSession,
  setUserRole,
} from './auth/users.js';
export type {
  CreateSessionInput,
  CreateUserInput,
  IssuedSession,
  ResolvedSession,
  User,
  UserRole,
} from './auth/users.js';

export {
  DEFAULT_PARAMS,
  PASSWORD_REQUIREMENTS,
  assertPasswordAcceptable,
  changeOwnPassword,
  login,
  setPassword,
} from './auth/passwords.js';
export type {
  LoginInput,
  LoginSuccess,
  PasswordRequirements,
  ScryptParams,
  SetPasswordInput,
} from './auth/passwords.js';

export {
  listCatalog,
  listTenantBindings,
  resolveProviders,
  setTenantBinding,
  upsertCatalogEntry,
} from './routing/provider-routing.js';
export type {
  BindingLevel,
  CatalogEntry,
  ProviderCandidate,
  ResolveProvidersInput,
  SetBindingInput,
  TenantBinding,
} from './routing/provider-routing.js';

export { activateKeyVersion, listKeyVersions, retireKeyVersion } from './crypto/key-versions.js';
export type { KeyVersion, KeyVersionStatus } from './crypto/key-versions.js';

export {
  buildEvidenceDocument,
  decisionLabel,
  statusLabel,
  verificationQrSvg,
} from './evidence/document.js';
export type {
  BuildDocumentInput,
  DocumentField,
  DocumentHeader,
  EvidenceDocument,
} from './evidence/document.js';
export { renderEvidenceHtml } from './evidence/render.js';
export type { RenderOptions } from './evidence/render.js';
export { FilesystemEvidenceStore, InMemoryEvidenceStore } from './evidence/store.js';
export type { EvidenceStore } from './evidence/store.js';
export { addSsoDomain, beginSso, completeSso, configureIdp, verifyIdToken } from './auth/sso.js';
export type {
  BeginSsoInput,
  CompleteSsoInput,
  HttpJson,
  ConfigureIdpInput,
  IdTokenClaims,
  IdpConfig,
  SsoFetcher,
  SsoLoginSuccess,
  SsoRedirect,
  VerifyIdTokenOptions,
} from './auth/sso.js';
export {
  addChannel,
  claimPendingNotifications,
  listChannels,
  queueNotifications,
  recordNotificationResult,
  renderMessage,
  subscribe,
  unsubscribe,
  verifyChannel,
} from './notifications/notifications.js';
export type {
  AddChannelInput,
  Message,
  NotificationChannel,
  NotificationSeverity,
  PendingNotification,
  QueueNotificationsInput,
  SubscribeInput,
} from './notifications/notifications.js';
export { HttpKmsClient, KmsMasterKeySource, masterKeySourceFromEnv } from './crypto/kms.js';
export type { Fetcher, HttpKmsOptions, KmsClient, KmsDecryptRequest } from './crypto/kms.js';
export {
  advancePeriod,
  assertEntitled,
  getSubscription,
  listEntitlements,
  recordUsage,
  resolveEntitlement,
} from './billing/entitlements.js';
export type {
  Entitlement,
  EntitlementRefusal,
  Subscription,
} from './billing/entitlements.js';
