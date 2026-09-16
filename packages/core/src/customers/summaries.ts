import type { TenantTransaction } from '@nx-verify/db';
import type { TenantKeyProvider } from '../crypto/tenant-keys.js';
import { decryptIdentifier, displayIdentifier, maskIdentifier } from '../crypto/identifier.js';
import type { EntityType } from '../repositories/entities.js';
import type { Freshness, ProfileField } from '../repositories/profile.js';
import { listChecks, type CustomerKind, type ProfileSection } from './checks.js';
import {
  KIND_LABELS,
  fileStandingOf,
  primaryIdentifierOf,
  type FileBasis,
  type LastRun,
} from './customer-file.js';
import type { RiskLevel, Standing } from './indicators.js';
import { getPlatformSettings, layoutsOf, listSectionRequirements } from '../settings/platform.js';
import { listCustomers, profileOfEach, type CustomerFilter } from './list.js';
import { resolveRiskPolicy } from './risk-policy.js';

/**
 * Every customer's standing at once: how complete the file is, where it stands, its risk.
 *
 * The home screen counts them and the customers list draws a bar, a tag and a score on each
 * row (handoff screens 01 and 04). Both must agree with the file each row opens, so the
 * decisions are the file's own (fileStandingOf) and only the loading differs: a handful of
 * queries over all the customers at once, not one file assembled per row and thrown away.
 *
 * Scoped to one subscriber like everything else (rule 2), and the numbers shown are masked
 * here, where they are decrypted (rule 4).
 */

export interface CustomerSummary {
  entityId: string;
  displayName: string | null;
  entityType: EntityType;
  kind: CustomerKind | null;
  kindLabelAr: string;
  /** The number beside the name, with its short label, masked. */
  identifier: { labelAr: string; masked: string; display: string } | null;
  createdAt: Date;
  lastVerifiedAt: Date | null;
  /** When the customer first came back verified. */
  firstVerifiedAt: Date | null;
  completeness: number;
  sectionsDone: number;
  sectionsRequired: number;
  mode: 'KYB' | 'KYC';
  standing: Standing;
  standingAr: string;
  riskLevel: RiskLevel;
  riskLabelAr: string;
  riskScore: number | null;
  /** Sections whose verified facts do not hold. */
  conflicts: number;
  /** Each of those sections, with the few words that say what does not hold. */
  conflictIssues: { section: ProfileSection; issueAr: string | null }[];
  openChanges: number;
  /** What «تنبيهات مفتوحة» filters by: conflicts and changes nobody has looked at. */
  openAlerts: number;
}

type Grouped<T> = Map<string, T[]>;

function group<T>(rows: readonly T[], key: (row: T) => string): Grouped<T> {
  const result: Grouped<T> = new Map();
  for (const row of rows) {
    const list = result.get(key(row)) ?? [];
    list.push(row);
    result.set(key(row), list);
  }
  return result;
}

export async function summarizeCustomers(
  tx: TenantTransaction,
  keys: TenantKeyProvider,
  filter: CustomerFilter = {},
  options: { now?: Date } = {},
): Promise<CustomerSummary[]> {
  const now = options.now ?? new Date();
  const customers = await listCustomers(tx, keys, filter);
  if (customers.length === 0) {
    return [];
  }
  const ids = customers.map((customer) => customer.entityId);
  const catalogue = await listChecks(tx);
  const settings = await getPlatformSettings(tx);
  const layouts = layoutsOf(await listSectionRequirements(tx));
  // Once for the whole list, so every row is scored under the same model as the file it opens.
  const riskPolicy = await resolveRiskPolicy(tx);

  const { rows: entityRows } = await tx.query<{ id: string; first_seen_at: Date }>(
    `SELECT id, first_seen_at FROM entities WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tx.tenantId, ids],
  );
  const firstSeen = new Map(entityRows.map((row) => [row.id, row.first_seen_at]));

  const profileRows = await profileOfEach<{
    entity_id: string;
    field_path: string;
    value: unknown;
    authority: string | null;
    observed_at: Date;
    effective_until: Date | null;
    ttl_days: number | null;
    weight: number | null;
    confidence: string;
    freshness: Freshness;
    attestation_id: string;
  }>(
    tx,
    ids,
    `SELECT entity_id, field_path, value, authority, observed_at, effective_until, ttl_days,
            weight, confidence, freshness, attestation_id
       FROM entity_profile
      WHERE tenant_id = $1 AND entity_id = $2
      ORDER BY field_path`,
  );
  const profiles = group(profileRows, (row) => row.entity_id);

  const { rows: changeRows } = await tx.query<{ entity_id: string; field_path: string }>(
    `SELECT DISTINCT entity_id, field_path FROM change_events
     WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[]) AND acknowledged_at IS NULL`,
    [tx.tenantId, ids],
  );
  const changes = group(changeRows, (row) => row.entity_id);

  const { rows: runRows } = await tx.query<{
    entity_id: string;
    product_code: string;
    status: string;
    reference: string | null;
    created_at: Date;
    first_success: Date | null;
  }>(
    `SELECT DISTINCT ON (entity_id, product_code) entity_id, product_code, status, reference,
            created_at,
            min(created_at) FILTER (WHERE status IN ('OK', 'PARTIAL'))
              OVER (PARTITION BY entity_id) AS first_success
     FROM verification_runs
     WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])
     ORDER BY entity_id, product_code, created_at DESC`,
    [tx.tenantId, ids],
  );
  const runs = group(runRows, (row) => row.entity_id);

  // The managers of each customer, what is known about them, and the other businesses they
  // manage: the same three reads the file makes, for every customer at once.
  const { rows: managerRows } = await tx.query<{
    company: string;
    person: string;
    name: string | null;
  }>(
    `SELECT DISTINCT r.from_entity AS company, r.to_entity AS person, e.display_name AS name
     FROM entity_relations r
     JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.to_entity
     WHERE r.tenant_id = $1 AND r.from_entity = ANY($2::uuid[])
       AND r.rel_type = 'MANAGES' AND r.ended_at IS NULL`,
    [tx.tenantId, ids],
  );
  // Grouped once rather than filtered per customer: a linear scan of every manager inside a
  // loop over every customer is the same N+1 the bulk query was written to avoid (ADR-140).
  const managersOf = group(managerRows, (row) => row.company);
  const people = [...new Set(managerRows.map((row) => row.person))];
  const personFacts = await profileOfEach<{
    entity_id: string;
    field_path: string;
    value: unknown;
    observed_at: Date;
  }>(
    tx,
    people,
    `SELECT entity_id, field_path, value, observed_at FROM entity_profile
      WHERE tenant_id = $1 AND entity_id = $2
        AND (field_path = 'person.name' OR field_path LIKE 'manager.%')`,
  );
  const factsOfPerson = new Map<string, Map<string, { value: unknown; observedAt: Date }>>();
  for (const row of personFacts) {
    const facts = factsOfPerson.get(row.entity_id) ?? new Map();
    facts.set(row.field_path, { value: row.value, observedAt: row.observed_at });
    factsOfPerson.set(row.entity_id, facts);
  }
  const { rows: managedRows } =
    people.length === 0
      ? { rows: [] as { person: string; company: string }[] }
      : await tx.query<{ person: string; company: string }>(
          `SELECT DISTINCT r.to_entity AS person, r.from_entity AS company
           FROM entity_relations r
           JOIN entities e ON e.tenant_id = r.tenant_id AND e.id = r.from_entity
           WHERE r.tenant_id = $1 AND r.to_entity = ANY($2::uuid[])
             AND r.rel_type = 'MANAGES' AND r.ended_at IS NULL AND e.entity_type = 'BUSINESS'`,
          [tx.tenantId, people],
        );
  const companiesOf = group(managedRows, (row) => row.person);

  const { rows: accountRows } = await tx.query<{ holder: string; account: string }>(
    `SELECT DISTINCT from_entity AS holder, to_entity AS account FROM entity_relations
     WHERE tenant_id = $1 AND from_entity = ANY($2::uuid[])
       AND rel_type = 'HOLDS_ACCOUNT' AND ended_at IS NULL`,
    [tx.tenantId, ids],
  );
  const accountsOf = group(accountRows, (row) => row.holder);
  const accounts = [...new Set(accountRows.map((row) => row.account))];
  const { rows: holderRows } =
    accounts.length === 0
      ? { rows: [] as { account: string; holder: string }[] }
      : await tx.query<{ account: string; holder: string }>(
          `SELECT DISTINCT to_entity AS account, from_entity AS holder FROM entity_relations
           WHERE tenant_id = $1 AND to_entity = ANY($2::uuid[])
             AND rel_type = 'HOLDS_ACCOUNT' AND ended_at IS NULL`,
          [tx.tenantId, accounts],
        );
  const holdersOf = group(holderRows, (row) => row.account);

  const addressOf = new Map(
    profileRows
      .filter((row) => row.field_path === 'address.national.key')
      .map((row) => [row.entity_id, JSON.stringify(row.value)]),
  );
  const addressKeys = [...new Set(addressOf.values())];
  const { rows: addressRows } =
    addressKeys.length === 0
      ? { rows: [] as { key: string; entities: string }[] }
      : await tx.query<{ key: string; entities: string }>(
          // Asked of the attestations rather than of the profile view: the question is how
          // many customers share an address, which needs no time to live resolved. Against
          // the view it had no entity to narrow by, so it rebuilt the whole workspace's
          // profile a second time on every page load (ADR-140).
          `SELECT a.value::text AS key, count(DISTINCT a.entity_id)::text AS entities
           FROM attestations a
           WHERE a.tenant_id = $1 AND a.field_path = 'address.national.key'
             AND a.superseded_by IS NULL AND a.value = ANY($2::jsonb[])
           GROUP BY a.value`,
          [tx.tenantId, addressKeys],
        );
  // Compared as parsed JSON: the database writes jsonb text its own way.
  const registeredAt = new Map(
    addressRows.map((row) => [JSON.stringify(JSON.parse(row.key)), Number(row.entities)]),
  );

  const { rows: identifierRows } = await tx.query<{
    entity_id: string;
    id_type: string;
    id_value_enc: Buffer;
    key_version: number;
    is_primary: boolean;
  }>(
    `SELECT entity_id, id_type, id_value_enc, key_version, is_primary FROM entity_identifiers
     WHERE tenant_id = $1 AND entity_id = ANY($2::uuid[])
       AND id_type IN ('CR', 'UNN', 'NATIONAL_ID', 'IQAMA')`,
    [tx.tenantId, ids],
  );
  const encryptionKeys = new Map<number, Buffer>();
  const identifiers = new Map<
    string,
    { idType: string; masked: string; display: string; isPrimary: boolean }[]
  >();
  for (const row of identifierRows) {
    let key = encryptionKeys.get(row.key_version);
    if (key === undefined) {
      key = await keys.encryptionKey(tx.tenantId, row.key_version);
      encryptionKeys.set(row.key_version, key);
    }
    // Decrypted to be masked, and only the masked form and the display form are kept: every
    // identifier shows in full on the signed in screen (ADR-127, ADR-128), the masked form is
    // for everywhere else.
    const value = decryptIdentifier(key, row.id_value_enc);
    const list = identifiers.get(row.entity_id) ?? [];
    list.push({
      idType: row.id_type,
      masked: maskIdentifier(value),
      display: displayIdentifier(row.id_type, value),
      isPrimary: row.is_primary,
    });
    identifiers.set(row.entity_id, list);
  }

  return customers.map((customer): CustomerSummary => {
    const id = customer.entityId;
    const profile: ProfileField[] = (profiles.get(id) ?? []).map((row) => ({
      fieldPath: row.field_path,
      value: row.value,
      authority: row.authority,
      observedAt: row.observed_at,
      effectiveUntil: row.effective_until,
      ttlDays: row.ttl_days,
      weight: row.weight,
      confidence: Number(row.confidence),
      freshness: row.freshness,
      attestationId: row.attestation_id,
    }));
    const entityRuns = runs.get(id) ?? [];
    const lastRuns = new Map<string, LastRun>(
      entityRuns.map((row) => [
        row.product_code,
        {
          productCode: row.product_code,
          status: row.status,
          reference: row.reference,
          at: row.created_at,
        },
      ]),
    );
    const managers: FileBasis['managers'] = (managersOf.get(id) ?? []).map((row) => {
      const facts = factsOfPerson.get(row.person);
      const permissions = facts?.get(`manager.permissions.${id}`);
      return {
        name: (facts?.get('person.name')?.value as string | undefined) ?? row.name,
        hasPermissions: permissions !== undefined && Array.isArray(permissions.value),
        otherCompanies: (companiesOf.get(row.person) ?? []).filter((entry) => entry.company !== id)
          .length,
        permissionsCheckedAt: permissions?.observedAt ?? null,
        observedAt:
          facts?.get(`manager.positions.${id}`)?.observedAt ??
          facts?.get('person.name')?.observedAt ??
          null,
      };
    });
    const accountsSharedWith = (accountsOf.get(id) ?? []).reduce(
      (sum, row) =>
        sum + (holdersOf.get(row.account) ?? []).filter((entry) => entry.holder !== id).length,
      0,
    );
    const address = addressOf.get(id);
    const addressSharedWith =
      address === undefined
        ? 0
        : Math.max(0, (registeredAt.get(JSON.stringify(JSON.parse(address))) ?? 1) - 1);

    const changedPaths = new Set((changes.get(id) ?? []).map((row) => row.field_path));
    const standing = fileStandingOf({
      settings,
      layouts,
      riskPolicy,
      entityType: customer.entityType as EntityType,
      profile,
      changedPaths,
      lastRuns,
      managers,
      accountsSharedWith,
      addressSharedWith,
      catalogue,
      now,
    });
    const conflictIssues = standing.sections
      .filter((section) => section.state === 'CONFLICT')
      .map((section) => ({ section: section.section, issueAr: section.issueAr }));
    const conflicts = conflictIssues.length;

    return {
      entityId: id,
      displayName: customer.displayName,
      entityType: customer.entityType as EntityType,
      kind: standing.kind,
      kindLabelAr: standing.kind ? KIND_LABELS[standing.kind] : 'منشأة',
      identifier: primaryIdentifierOf(identifiers.get(id) ?? []),
      createdAt: firstSeen.get(id) ?? now,
      lastVerifiedAt: customer.lastVerifiedAt,
      firstVerifiedAt: entityRuns[0]?.first_success ?? null,
      completeness: standing.completeness,
      sectionsDone: standing.sectionsDone,
      sectionsRequired: standing.sectionsRequired,
      mode: standing.assessment.mode,
      standing: standing.assessment.standing,
      standingAr: standing.assessment.standingAr,
      riskLevel: standing.assessment.riskLevel,
      riskLabelAr: standing.assessment.riskLabelAr,
      riskScore: standing.assessment.riskScore,
      conflicts,
      conflictIssues,
      openChanges: changedPaths.size,
      openAlerts: conflicts + changedPaths.size,
    };
  });
}
