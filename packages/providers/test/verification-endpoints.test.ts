import { describe, expect, it } from 'vitest';
import {
  CORPORATE_ADDRESS,
  CORPORATE_CONTRACT,
  CORPORATE_FULL,
  CORPORATE_MANAGER,
  CORPORATE_NOT_FOUND,
  FREELANCER_ACTIVE,
  IBAN_INACTIVE,
  IBAN_MATCH,
  IBAN_NAME_PARTIAL,
  IBAN_UNSUPPORTED_BANK,
} from '../src/lean/sandbox/fixtures.js';
import {
  LEAN_VERIFICATION_ENDPOINTS,
  companyKind,
  interpretAnswer,
  mapCorporateAddress,
  mapCorporateContract,
  mapCorporateFull,
  mapCorporateManager,
  mapFreelancer,
  mapIbanVerification,
  personIdentifierType,
} from '../src/lean/verification-endpoints.js';
import { LeanProvider } from '../src/lean/lean-provider.js';
import { StubProvider } from '../src/stub/stub-provider.js';
import {
  SANDBOX_IBAN,
  SANDBOX_MANAGER_ID,
  SANDBOX_UNN,
  sandboxVerificationAnswer,
} from '../src/stub/verification-sandbox.js';

/**
 * Unit 77 acceptance: the data source's verification products, read the way its own
 * specification says they answer.
 *
 * Every assertion below runs against an example answer recorded from that specification,
 * so a mapping that passes here reads the real envelope, not an illustration of it.
 */

const UNN = SANDBOX_UNN.ACTIVE;

function mapping(endpoint: string) {
  const found = LEAN_VERIFICATION_ENDPOINTS[endpoint];
  if (!found) {
    throw new Error(`no mapping for ${endpoint}`);
  }
  return found;
}

describe('the registry answer', () => {
  const bag = mapCorporateFull(CORPORATE_FULL, { unn: UNN });

  it('reads the company in Arabic, with its status and kind', () => {
    expect(bag['company_name']).toBe('شركة اختبار للتجارة');
    expect(bag['status_text']).toBe('فعال');
    expect(bag['status_code']).toBe(1);
    expect(bag['company_kind']).toBe('COMPANY');
    expect(bag['issue_date']).toBe('2002-10-05');
    expect(bag['headquarters_city']).toBe('الرياض');
    expect(bag['activities']).toHaveLength(2);
  });

  it('takes the registration number as whichever field is not the unified number sent', () => {
    // The specification and the guides swap national_number and registration_number.
    expect(bag['cr_number']).toBe('1010711252');
  });

  it('keeps managers it can match to a person, and counts the rest', () => {
    const managers = bag['managers'] as { identity_type: string; positions: string[] }[];
    expect(managers.length).toBeGreaterThan(0);
    expect(managers[0]?.identity_type).toBe('NATIONAL_ID');
    expect(bag['managers_total']).toBe(managers.length + (bag['managers_unmatched'] as number));
  });

  it('never carries personal contact numbers into the bag', () => {
    const text = JSON.stringify(bag);
    expect(text).not.toContain('050111101');
    expect(text).not.toContain('TestEmail@mail.com');
  });
});

describe('the articles of association answer', () => {
  const bag = mapCorporateContract(CORPORATE_CONTRACT, { unn: UNN });

  it('skips a party whose identity is not a person or a registration, rather than guessing', () => {
    // The example's only partner is an endowment identified by its deed number.
    // An empty list is not a fact, so it is not in the bag at all.
    expect(bag['partners']).toBeUndefined();
    expect(bag['partners_total']).toBe(1);
  });

  it('reads a residence ID as a residence ID, by its shape', () => {
    const managers = bag['managers'] as { identity_type: string }[];
    expect(managers[0]?.identity_type).toBe('IQAMA');
    expect(bag['management_structure']).toBe('مديران أو أكثر');
  });
});

describe('the national address answer', () => {
  it('picks the primary address and keys it for comparison', () => {
    const bag = mapCorporateAddress(CORPORATE_ADDRESS);
    expect(bag['city']).toBe('الرياض');
    expect(bag['building_number']).toBe('2455');
    expect(bag['address_key']).toMatch(/^2455-\d+-\d+$/);
  });
});

describe('the manager authority answer', () => {
  it('lists each power with how it is exercised', () => {
    const bag = mapCorporateManager(CORPORATE_MANAGER, { unn: UNN, manager_id: SANDBOX_MANAGER_ID });
    const [manager] = bag['managers'] as { permissions: { name: string; method: string }[] }[];
    expect(manager?.permissions.map((permission) => permission.method)).toContain('منفرداً');
    expect(bag['permissions_count']).toBeGreaterThan(0);
  });
});

describe('the freelance certificate answer', () => {
  it('reads ownership and the certificate asked about', () => {
    const bag = mapFreelancer(FREELANCER_ACTIVE, { certificate_number: 'FL-013988291' });
    expect(bag['ownership']).toBe('VERIFIED');
    expect(bag['certificate_status']).toBe('ACTIVE');
  });
});

describe('the IBAN answer', () => {
  it('separates a match, a partial name match and a blocked account', () => {
    expect(mapIbanVerification(IBAN_MATCH)['ownership']).toBe('MATCH');
    expect(mapIbanVerification(IBAN_NAME_PARTIAL)['ownership']).toBe('PARTIAL');
    const blocked = mapIbanVerification(IBAN_INACTIVE);
    expect(blocked['ownership']).toBe('NO_MATCH');
    expect(blocked['account_status']).toBe('BLOCKED');
  });

  it('names the payments rail that confirmed it, not the company that asked', () => {
    const answer = interpretAnswer(mapping('iban_verification'), IBAN_MATCH, {
      iban: SANDBOX_IBAN.MATCH,
    });
    expect(answer.authority).toBe('المدفوعات السعودية');
  });

  it('treats a bank the rail does not support as an unbilled failure of the source', () => {
    const answer = interpretAnswer(mapping('iban_verification'), IBAN_UNSUPPORTED_BANK, {});
    expect(answer.outcome).toBe('ERROR');
    expect(answer.errorCode).toBe('SOURCE_UNAVAILABLE');
    expect(answer.retryable).toBe(false);
  });
});

describe('what an answer did not say', () => {
  it('is left out rather than recorded as empty', () => {
    const answer = sandboxVerificationAnswer('corporate_full', { unn: UNN }) ?? {};
    const bag = mapCorporateFull(answer, { unn: UNN });
    // The sandbox's active company was never suspended, so there is no date to record.
    expect('suspension_date' in bag).toBe(false);
    // False is an answer and stays.
    expect(bag['in_liquidation']).toBe(false);
  });
});

describe('outcomes', () => {
  it('reads DATA_NOT_FOUND as an answer, not a failure', () => {
    const answer = interpretAnswer(mapping('corporate_full'), CORPORATE_NOT_FOUND, {});
    expect(answer.outcome).toBe('NOT_FOUND');
    expect(answer.authority).toBe('وزارة التجارة');
  });

  it('names no data source in any authority', () => {
    for (const entry of Object.values(LEAN_VERIFICATION_ENDPOINTS)) {
      expect(entry.authority.toLowerCase()).not.toContain('lean');
    }
  });
});

describe('identity by shape', () => {
  it('knows a national ID from a residence ID and refuses anything else', () => {
    expect(personIdentifierType('1098765432')).toBe('NATIONAL_ID');
    expect(personIdentifierType('2123456789')).toBe('IQAMA');
    expect(personIdentifierType('7111111111')).toBeNull();
    expect(personIdentifierType('12345')).toBeNull();
  });

  it('knows a company from a sole establishment', () => {
    expect(companyKind({ name: { ar: 'شركة ذات مسؤولية محدودة' } })).toBe('COMPANY');
    expect(companyKind({ name: { ar: 'مؤسسة فردية' } })).toBe('ESTABLISHMENT');
    expect(companyKind({ name: { en: 'Limited Liability Company' } })).toBe('COMPANY');
  });
});

describe('the live adapter', () => {
  const credential = { ref: 'kms://providers/primary/sandbox', mode: 'MANAGED' as const, material: { clientId: 'id', clientSecret: 'secret' } };

  function adapterAnswering(answer: Record<string, unknown>) {
    const calls: { url: string; body: unknown }[] = [];
    const provider = new LeanProvider({
      name: 'primary',
      baseUrl: 'https://sandbox.example.sa',
      authUrl: 'https://auth.sandbox.example.sa/oauth2/token',
      fetch: (url, init) => {
        if (url.endsWith('/oauth2/token')) {
          return Promise.resolve(new Response(JSON.stringify({ access_token: 't', expires_in: 3599 }), { status: 200 }));
        }
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
      },
    });
    return { provider, calls };
  }

  it('asks for the full registry record by unified number, in Arabic', async () => {
    const { provider, calls } = adapterAnswering(CORPORATE_FULL);
    const result = await provider.execute({ endpoint: 'corporate_full', input: { unn: UNN }, credential });

    expect(calls[0]?.url).toBe('https://sandbox.example.sa/verifications/v1/corporates');
    expect(calls[0]?.body).toEqual({
      type: 'FULL',
      language: 'ar',
      identifications: [{ type: 'UNIFIED_NUMBER', value: UNN }],
    });
    expect(result.outcome).toBe('OK');
    expect(result.data?.['company_name']).toBe('شركة اختبار للتجارة');
  });

  it('asks for one manager by the company and the manager identity', async () => {
    const { provider, calls } = adapterAnswering(CORPORATE_MANAGER);
    await provider.execute({
      endpoint: 'corporate_manager',
      input: { unn: UNN, manager_id: '2123456789' },
      credential,
    });
    expect(calls[0]?.url).toBe('https://sandbox.example.sa/verifications/v1/corporates/managers');
    expect(calls[0]?.body).toMatchObject({
      identifications: [
        { type: 'UNIFIED_NUMBER', value: UNN },
        { type: 'RESIDENT_ID', value: '2123456789' },
      ],
    });
  });

  it('answers a sandbox call and a live call with the same attestable data', async () => {
    // The live adapter is given exactly what the sandbox answers, so any difference below is
    // a difference in how the two read an answer, which is the thing that must not exist.
    const { provider } = adapterAnswering(sandboxVerificationAnswer('corporate_full', { unn: UNN }) ?? {});
    const live = await provider.execute({ endpoint: 'corporate_full', input: { unn: UNN }, credential });
    const sandbox = await new StubProvider().execute({ endpoint: 'corporate_full', input: { unn: UNN }, credential });
    expect(sandbox.data).toEqual(live.data);
    expect(sandbox.authority).toBe(live.authority);
  });
});
