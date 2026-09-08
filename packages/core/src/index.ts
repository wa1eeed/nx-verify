export { NxError } from './errors.js';
export type { NxErrorCode, NxErrorOptions } from './errors.js';
export { canonicalJson } from './canonical-json.js';

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

export { getEntityProfile } from './repositories/profile.js';
export type { Freshness, ProfileField } from './repositories/profile.js';
