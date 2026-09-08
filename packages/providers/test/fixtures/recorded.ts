/**
 * Recorded upstream responses.
 *
 * These are shapes, not data: an envelope, camelCase keys, nesting, an array where a
 * single object might arrive, and the failure bodies a real integration meets. They carry
 * no real identifiers and no real names.
 *
 * Recording rather than mocking is the point. A mock encodes what we believe the provider
 * does; a recording encodes what it actually sent, including the parts nobody designed.
 */

export interface RecordedResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export const RECORDED: Readonly<Record<string, RecordedResponse>> = {
  'GET /v1/commercial-registration/7001272184': {
    status: 200,
    headers: { 'x-charge-amount': '3.25' },
    body: {
      // Their envelope, which nothing outside the adapter ever sees.
      requestId: 'up_9f2',
      data: {
        unifiedNumber: '7001272184',
        crNumber: '1010478213',
        status: 'ACTIVE',
        name: 'شركة المثال للتجارة',
        capitalAmount: 500000,
        issueDate: '2019-03-14',
        address: { city: 'الرياض', district: 'العليا', buildingNumber: '2743' },
      },
    },
  },

  'GET /v1/commercial-registration/7000000000': {
    status: 404,
    body: { code: 'RECORD_NOT_FOUND', message: 'no registration for this number' },
  },

  // Two hundred with an empty envelope. Real registries do this, and no documentation
  // mentions it.
  'GET /v1/commercial-registration/7000000004': {
    status: 200,
    body: { requestId: 'up_9f3', data: null },
  },

  'GET /v1/commercial-registration/7000000002': {
    status: 401,
    body: { code: 'INVALID_CREDENTIALS' },
  },

  'GET /v1/commercial-registration/7000000005': {
    status: 429,
    body: { code: 'RATE_LIMITED' },
    headers: { 'retry-after': '1' },
  },

  'GET /v1/commercial-registration/7000000006': {
    status: 503,
    body: { code: 'UPSTREAM_UNAVAILABLE' },
  },

  'GET /v1/aoa/7001272184': {
    status: 200,
    body: {
      data: {
        unifiedNumber: '7001272184',
        documentNumber: 'AOA-88213',
        managers: [
          {
            name: 'محمد عبدالله',
            id: '1098765432',
            idType: 'NATIONAL_ID',
            signingAuthority: 'SOLE',
            verified: true,
          },
        ],
      },
    },
  },

  'GET /v1/aoa/7001272184/managers/1098765432': {
    status: 200,
    body: {
      data: {
        unifiedNumber: '7001272184',
        managerId: '1098765432',
        signingAuthority: 'SOLE',
        verified: true,
        scope: 'FULL',
      },
    },
  },

  'GET /v1/ubo/7001272184': {
    status: 200,
    body: {
      data: {
        unifiedNumber: '7001272184',
        owners: [{ name: 'محمد عبدالله', id: '1098765432', percentage: 100 }],
      },
    },
  },

  'POST /v1/iban/verify': {
    status: 200,
    body: {
      data: {
        matchResult: 'MATCHED',
        accountHolderName: 'شركة المثال للتجارة',
        holderIdentifier: '1010478213',
        bankName: 'Example Bank',
      },
    },
  },

  'GET /health': { status: 200, body: { status: 'ok' } },
};

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/**
 * A fetch that answers from the recordings and remembers what it was asked, so a test can
 * assert on the request as well as the response.
 */
export function recordedFetch(calls: RecordedCall[] = []): {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  calls: RecordedCall[];
} {
  const fetchImpl = (url: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    calls.push({
      url: path,
      method,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? init.body : null,
    });

    const recorded = RECORDED[`${method} ${path}`];
    if (!recorded) {
      return Promise.resolve(
        new Response(JSON.stringify({ code: 'RECORD_NOT_FOUND' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify(recorded.body), {
        status: recorded.status,
        headers: { 'content-type': 'application/json', ...recorded.headers },
      }),
    );
  };

  return { fetch: fetchImpl, calls };
}
