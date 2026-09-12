/**
 * Upstream payloads into the flat bag the normalisation layer expects.
 *
 * This file is the whole reason ADR-006 exists. Every quirk of a provider's response
 * shape stops here: their envelopes, their casing, their nesting, their habit of
 * returning a single object where the schema promised an array. Nothing past this file
 * knows any of it.
 *
 * The mapping is data, so adding an endpoint is a table entry rather than a branch.
 */

export interface EndpointMapping {
  /** Path template. {name} is filled from the request input. */
  path: string;
  method: 'GET' | 'POST';
  /** The official body behind this endpoint. This is what a customer sees (rule 5). */
  authority: string;
  /** Where the useful payload lives inside the provider's envelope. */
  dataPath?: string;
  /** Renames provider field names to the names our step_field_map rows reference. */
  fields?: Record<string, string>;
  /**
   * Nested objects merged in at the top level rather than prefixed.
   *
   * This is what makes two providers interchangeable. step_field_map belongs to a
   * product, not to a provider, so its source paths must not move when the provider
   * behind a step changes. One upstream returns the address nested and another returns it
   * flat; both arrive here as city, district and building_number, and the product
   * definition never learns which answered.
   */
  flatten?: string[];
}

export const DEFAULT_ENDPOINTS: Readonly<Record<string, EndpointMapping>> = {
  business_verification: {
    path: '/v1/commercial-registration/{identifications}',
    method: 'GET',
    authority: 'Commercial Registry',
    dataPath: 'data',
    fields: {
      unifiedNumber: 'unified_number',
      crNumber: 'cr_number',
      status: 'cr_status',
      name: 'company_name',
      capitalAmount: 'capital',
      issueDate: 'issue_date',
    },
    flatten: ['address'],
  },
  articles_of_association: {
    path: '/v1/aoa/{unified_number}',
    method: 'GET',
    authority: 'Ministry of Commerce',
    dataPath: 'data',
    fields: { unifiedNumber: 'unified_number', documentNumber: 'document_number' },
  },
  manager_permissions: {
    path: '/v1/aoa/{unified_number}/managers/{manager_id}',
    method: 'GET',
    authority: 'Ministry of Commerce',
    dataPath: 'data',
    fields: { unifiedNumber: 'unified_number', managerId: 'manager_id' },
  },
  ultimate_beneficial_owner: {
    path: '/v1/ubo/{unified_number}',
    method: 'GET',
    authority: 'Commercial Registry',
    dataPath: 'data',
    fields: { unifiedNumber: 'unified_number' },
  },
  property_deed: {
    path: '/v1/deeds/{deed_number}',
    method: 'GET',
    authority: 'Ministry of Justice',
    dataPath: 'data',
    fields: {
      deedNumber: 'deed_number',
      status: 'deed_status',
      ownerName: 'owner_name',
      ownerId: 'owner_identifier',
      propertyType: 'property_type',
      areaSqm: 'area_sqm',
      issueDate: 'issue_date',
    },
    flatten: ['location'],
  },
  freelancer_certificate: {
    path: '/v1/freelancer/{certificate_number}',
    method: 'GET',
    authority: 'Ministry of Human Resources',
    dataPath: 'data',
    fields: {
      certificateNumber: 'certificate_number',
      fullName: 'freelancer_name',
      status: 'certificate_status',
      issueDate: 'issue_date',
      expiryDate: 'expiry_date',
      activityName: 'activity',
    },
  },
  iban_ownership: {
    path: '/v1/iban/verify',
    method: 'POST',
    authority: 'Saudi Central Bank',
    dataPath: 'data',
    fields: {
      matchResult: 'match_result',
      accountHolderName: 'account_holder_name',
      holderIdentifier: 'holder_identifier',
      bankName: 'bank_name',
    },
  },
};

export function buildPath(
  mapping: EndpointMapping,
  input: Readonly<Record<string, unknown>>,
): { path: string; body: Record<string, unknown> | null } {
  const used = new Set<string>();
  const path = mapping.path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = input[name];
    used.add(name);
    return encodeURIComponent(String(value ?? ''));
  });

  if (mapping.method === 'GET') {
    return { path, body: null };
  }

  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!used.has(key)) {
      body[key] = value;
    }
  }
  return { path, body };
}

function readPath(source: unknown, path: string | undefined): unknown {
  if (!path) {
    return source;
  }
  let current = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Flattens and renames. Nested objects are folded in with snake_case keys, which is what
 * step_field_map rows address, so a product definition never has to know how deeply a
 * particular provider nests its address.
 */
export function mapResponse(
  mapping: EndpointMapping,
  payload: unknown,
): Record<string, unknown> | null {
  const data = readPath(payload, mapping.dataPath);
  if (data === null || data === undefined || typeof data !== 'object') {
    return null;
  }

  const flat: Record<string, unknown> = {};
  collect(data as Record<string, unknown>, mapping, flat, '');
  return Object.keys(flat).length === 0 ? null : flat;
}

function collect(
  source: Record<string, unknown>,
  mapping: EndpointMapping,
  target: Record<string, unknown>,
  prefix: string,
): void {
  const renames = mapping.fields ?? {};
  const merged = new Set(mapping.flatten ?? []);

  for (const [key, value] of Object.entries(source)) {
    const renamed = renames[key] ?? toSnakeCase(key);
    const name = prefix === '' ? renamed : `${prefix}_${renamed}`;

    if (Array.isArray(value)) {
      target[name] = value.map((entry) =>
        entry !== null && typeof entry === 'object'
          ? flattenEntry(entry as Record<string, unknown>, mapping)
          : entry,
      );
      continue;
    }
    if (value !== null && typeof value === 'object') {
      collect(value as Record<string, unknown>, mapping, target, merged.has(key) ? prefix : name);
      continue;
    }
    target[name] = value;
  }
}

function flattenEntry(
  entry: Record<string, unknown>,
  mapping: EndpointMapping,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  collect(entry, mapping, flat, '');
  return flat;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}
