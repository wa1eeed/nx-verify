import { describe, expect, it } from 'vitest';
import {
  CORPORATE_ADDRESS,
  CORPORATE_CONTRACT,
  CORPORATE_FULL,
  CORPORATE_MANAGER,
  CORPORATE_NOT_FOUND,
  FREELANCER_ACTIVE,
  FREELANCER_CANCELED,
  IBAN_INACTIVE,
  IBAN_MATCH,
  IBAN_NAME_PARTIAL,
  IBAN_UNSUPPORTED_BANK,
} from '../src/lean/sandbox/fixtures.js';
import {
  LEAN_VERIFICATION_ENDPOINTS,
  companyKind,
  establishedOn,
  interpretAnswer,
  mapCorporateAddress,
  mapCorporateContract,
  mapCorporateFull,
  mapCorporateManager,
  mapFreelancer,
  mapIbanVerification,
  partyIdentity,
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

  it('reads the contact details of the registration under our names', () => {
    // The owner's ask: every field the registry returns. A registration's contact details are
    // the business's, recorded by the authority, and carry its authority like any fact.
    expect(bag['phone']).toBe('011256398');
    expect(bag['mobile']).toBe('050111101');
    expect(bag['email']).toBe('TestEmail@mail.com');
    expect(bag['website']).toBe('www.google.com');
  });

  it('keeps every date in both calendars', () => {
    expect(bag['issue_date']).toBe('2002-10-05');
    expect(bag['issue_date_hijri']).toBe('1423-07-28');
    expect(bag['confirmation_date_hijri']).toBe('1424-07-28');
    expect(bag['reactivation_date']).toBe('2023-03-10');
    expect(bag['deletion_date_hijri']).toBe('1445-01-13');
  });

  it('breaks the capital down as the registry does, with each class of stock', () => {
    expect(bag['capital_currency']).toBe('ريال سعودي');
    expect(bag['capital_type']).toBe('نقدي و عيني');
    expect(bag['cash_capital']).toBe(75000);
    expect(bag['share_value']).toBe(100);
    expect(bag['cash_shares']).toBe(750);
    expect(bag['announced_capital']).toBe(1244);
    expect(bag['paid_capital']).toBe(12333);
    expect(bag['stocks']).toEqual([{ class_name: 'xx', type: 'xx', count: 11, value: 12 }]);
  });

  it('reads the details of the registration, activities with their codes, and its e-stores', () => {
    expect(bag['version_number']).toBe(1);
    expect(bag['name_language']).toBe('العربية');
    expect(bag['entity_characters']).toEqual(['غير ربحية خاصة']);
    expect(bag['license_issuer_number']).toBe('123456789');
    expect(bag['activity_codes']).toEqual(['162910', '477340']);
    expect(bag['e_stores']).toEqual([
      {
        store_url: 'www.google.com',
        platform_url: 'www.google.com',
        activities: ['صناعة زبدة المكسرات · 476201'],
      },
    ]);
    expect(bag['fiscal_calendar']).toBe('ميلادي');
    expect(bag['fiscal_is_first']).toBe(true);
  });

  it('counts from the day a business was established rather than its age, which grows daily', () => {
    // 99 days before the recorded answer of 24 October 2024.
    expect(bag['established_on']).toBe('2024-07-17');
    expect(establishedOn(10, '2026-01-11T09:00:00Z')).toBe('2026-01-01');
    expect(establishedOn(null, '2026-01-11T09:00:00Z')).toBeNull();
  });

  it('names the liquidators as people to link, and records nothing empty about anybody', () => {
    expect(bag['liquidators']).toEqual([
      {
        name: 'عبدالله سالم هليل الشمري',
        liquidator_type: 'فرد سعودي',
        nationality: 'سعودي',
        positions: ['عضو'],
        identity_id: '2345678901',
        identity_type: 'IQAMA',
      },
    ]);
    const [partner] = bag['partners'] as Record<string, unknown>[];
    // The recorded partner has no nationality and no profit share: the keys are absent, not null.
    expect(partner).toEqual({
      name: 'السيد عبدالعزيز احمد خالد الثنيان',
      party_type: 'جمعية خيرية/ مؤسسة أهلية',
      roles: ['عضو'],
      share_count: 500,
      cash_shares: 250,
      in_kind_shares: 250,
      identity_id: '1234567890',
      identity_type: 'NATIONAL_ID',
    });
  });

  it('reads the type and licence of a manager', () => {
    const [manager] = bag['managers'] as Record<string, unknown>[];
    expect(manager?.['manager_type']).toBe('سعودي');
    expect(manager?.['is_licensed']).toBe(true);
  });
});

describe('the articles of association answer', () => {
  const bag = mapCorporateContract(CORPORATE_CONTRACT, { unn: UNN });

  it('keeps a party identified by a document of its own kind, never as a national ID', () => {
    // The example's only partner is an endowment identified by its deed number, which starts
    // with 7 like a unified number. It is kept under its own kind with the authority's name for
    // the document, so it can never merge with a person or a registration sharing its digits.
    expect(bag['partners']).toBeUndefined();
    expect(bag['partner_businesses']).toEqual([
      {
        name: 'وقف',
        party_type: 'وقف',
        roles: ['مؤسس'],
        share_count: 0,
        cash_shares: 0,
        in_kind_shares: 0,
        profit_pct: 0,
        loss_pct: 0,
        identity_id: '7111111111',
        identity_type: 'PARTY_ID',
        identity_label: 'رقم صك الوقف',
      },
    ]);
    expect(bag['partners_total']).toBe(1);
  });

  it('reads the articles in full, the decisions with their conditions, and both boards', () => {
    expect(bag['articles']).toEqual([
      { part: 'الباب الأول', text: 'تعمل الشركة وفقاً لنظام التجارة السعودي' },
      {
        part: 'الباب الثاني',
        title: 'شرط عدم المنافسة',
        text: 'لا يجوز للشركاء ممارسة أعمال منافسة',
      },
    ]);
    expect(bag['articles_count']).toBe(2);
    expect(bag['partner_decisions']).toEqual([
      { name: 'تعديل عقد التأسيس', approve_percentage: 75, condition: 'يتطلب موافقة مجلس الإدارة' },
    ]);
    expect(bag['additional_decision_text']).toBe('All major decisions require unanimous consent');
    expect(bag['notification_channels']).toEqual(['رسائل نصية']);
    expect(bag['set_aside_enabled']).toBe(true);
    expect(bag['set_aside_purpose']).toBe('صندوق احتياطي للتوسع');
    expect(bag['mb_quorum']).toBe('جميع المديرين');
    expect(bag['mb_term_years']).toBe(3);
    expect(bag['mb_positions']).toEqual(['رئيس']);
    expect(bag['db_reward_max']).toBe(50000);
    expect(bag['db_legal_quorum']).toBe(4);
    expect(bag['db_rewards']).toEqual(['مكافأة سنوية']);
    expect(bag['directors_board_members']).toBe(5);
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
    expect(bag['address_title']).toBe('مطعم ومعجنات السندباد');
    expect(bag['address_line1']).toBe('8411 طريق الملك فهد - حي المروج');
    expect(bag['address_line2']).toBe('الرياض 12263 - 2743');
    expect(bag['address_is_primary']).toBe(true);
    expect(bag['latitude']).toBe(24.75014397);
    expect('other_addresses' in bag).toBe(false);
  });

  it('keeps every other address whole', () => {
    const answer = sandboxVerificationAnswer('corporate_address', { unn: UNN }) ?? {};
    const bag = mapCorporateAddress(answer);
    expect(bag['addresses_count']).toBe(2);
    expect(bag['building_number']).toBe('2455');
    expect(bag['other_addresses']).toEqual([
      expect.objectContaining({
        title: 'فرع مطعم ومعجنات السندباد',
        building_number: '3120',
        is_primary: false,
      }),
    ]);
  });
});

describe('the manager authority answer', () => {
  it('lists each power with how it is exercised', () => {
    const bag = mapCorporateManager(CORPORATE_MANAGER, {
      unn: UNN,
      manager_id: SANDBOX_MANAGER_ID,
    });
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

  it('reads the English name, the codes and the English names of the speciality', () => {
    const bag = mapFreelancer(FREELANCER_ACTIVE, { certificate_number: 'FL-013988291' });
    expect(bag['name_en']).toBe('adel');
    expect(bag['speciality_code']).toBe('AS090');
    expect(bag['speciality_en']).toBe('Sales Promotion and Management');
    expect(bag['category_code']).toBe('C106');
    expect(bag['category_en']).toBe('Sales & Marketing');
    expect(bag['certificates_count']).toBe(1);
    expect('other_certificates' in bag).toBe(false);
  });

  it('keeps when a certificate was cancelled', () => {
    const bag = mapFreelancer(FREELANCER_CANCELED, { certificate_number: 'FL-013988291' });
    expect(bag['certificate_canceled_at']).toBe('2025-05-26T00:00:00Z');
    expect('certificate_revoked_at' in bag).toBe(false);
  });

  it('lists the other certificates without their numbers, which are identifiers', () => {
    const answer = structuredClone(FREELANCER_ACTIVE);
    const verifications = answer['verifications'] as { certificate: Record<string, unknown>[] };
    verifications.certificate.push({
      ...structuredClone(verifications.certificate[0]),
      number: 'FL-099999999',
      status: 'EXPIRED',
    });
    const bag = mapFreelancer(answer, { certificate_number: 'FL-013988291' });
    expect(bag['certificates_count']).toBe(2);
    expect(bag['other_certificates']).toEqual([expect.objectContaining({ status: 'EXPIRED' })]);
    expect(JSON.stringify(bag['other_certificates'])).not.toContain('099999999');
  });
});

describe('the IBAN answer', () => {
  it('reads the bank in both languages, its code, and keeps every answer on the account too', () => {
    const bag = mapIbanVerification(IBAN_NAME_PARTIAL, { iban: SANDBOX_IBAN.OTHER_NAME });
    expect(bag['bank_name']).toBe('بنك البلاد');
    expect(bag['bank_name_en']).toBe('AlBilad Bank');
    expect(bag['bank_code']).toBe('24');
    expect(bag['account_match_score']).toBe(0.7);
    expect(bag['account_state']).toBe('ACTIVE');
    expect(bag['account_swift']).toBe('ALBISARI');
    expect(bag['account_method']).toBe('SARIE_AND_CONFIRMATION_OF_PAYEE_SERVICE');
  });

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

describe('the manager authority answer, several entries for one person', () => {
  it('merges the powers and positions of every entry about the person asked about', () => {
    const answer = structuredClone(CORPORATE_MANAGER);
    const [first] = answer['verifications'] as Record<string, unknown>[];
    (answer['verifications'] as Record<string, unknown>[]).push({
      ...structuredClone(first),
      positions: [{ id: 8, ar: 'عضو', en: null }],
      permissions: [
        {
          id: 9,
          name: { ar: 'فتح الحسابات البنكية', en: null },
          can_issue_poa: false,
          can_delegate: false,
          special_condition_text: null,
          exercise_method_id: 1,
          exercise_method_description: { ar: 'منفرداً', en: null },
        },
      ],
    });
    const bag = mapCorporateManager(answer, { unn: UNN, manager_id: SANDBOX_MANAGER_ID });
    const [manager] = bag['managers'] as {
      positions: string[];
      permissions: { name: string }[];
      manager_type: string;
      is_licensed: boolean;
    }[];
    expect(manager?.positions).toEqual(['مدير تنفيذي', 'عضو']);
    expect(manager?.permissions.map((permission) => permission.name)).toEqual([
      'إصدار توكيل',
      'توقيع العقود',
      'فتح الحسابات البنكية',
    ]);
    expect(manager?.manager_type).toBe('سعودي');
    expect(manager?.is_licensed).toBe(true);
    expect(bag['permissions_count']).toBe(3);
  });
});

describe('the identity of a party', () => {
  it('is a person by the shape of an ID, a business by a registration, else its own kind', () => {
    expect(partyIdentity({ id: '1098765432', type: { ar: 'هوية وطنية' } })).toEqual({
      identity_id: '1098765432',
      identity_type: 'NATIONAL_ID',
      identity_label: null,
      kind: 'PERSON',
    });
    expect(partyIdentity({ id: null }, '1010711252')?.identity_type).toBe('CR');
    expect(partyIdentity({ id: null }, '7001272184')?.identity_type).toBe('UNN');
    // A registration number written where an ID goes, named as a registration by the authority.
    expect(partyIdentity({ id: '1010711252', type: { ar: 'سجل تجاري' } })).toMatchObject({
      identity_type: 'CR',
      kind: 'BUSINESS',
    });
    expect(partyIdentity({ id: 'A1234567', type: { ar: 'جواز سفر' } })).toEqual({
      identity_id: 'A1234567',
      identity_type: 'PARTY_ID',
      identity_label: 'جواز سفر',
      kind: 'PERSON',
    });
    expect(partyIdentity({ id: '7111111111', type: { ar: 'رقم صك الوقف' } })).toMatchObject({
      identity_type: 'PARTY_ID',
      kind: 'BUSINESS',
    });
    expect(partyIdentity({ id: null, type: { ar: 'هوية وطنية' } })).toBeNull();
  });

  it('keeps the guardian a minor partner acts through, with the partner it acts for', () => {
    const answer = structuredClone(CORPORATE_FULL);
    const [party] = (answer['verifications'] as { parties: Record<string, unknown>[] }).parties;
    if (party) {
      party['guardian'] = {
        name: { ar: 'خالد أحمد الثنيان', en: null },
        identity: { id: '1087654321', type_id: 1, type: { ar: 'هوية وطنية', en: null } },
        nationality: { id: 113, type: { ar: 'سعودي', en: null } },
        is_father_guardian: true,
      };
    }
    const bag = mapCorporateFull(answer, { unn: UNN });
    expect(bag['guardians']).toEqual([
      {
        name: 'خالد أحمد الثنيان',
        identity_id: '1087654321',
        identity_type: 'NATIONAL_ID',
        nationality: 'سعودي',
        is_father: true,
        ward: 'السيد عبدالعزيز احمد خالد الثنيان',
      },
    ]);
    expect((bag['partners'] as Record<string, unknown>[])[0]?.['guardian']).toBe(
      'خالد أحمد الثنيان',
    );
  });

  it('links a branch to its main registration', () => {
    const answer = structuredClone(CORPORATE_FULL);
    const verifications = answer['verifications'] as Record<string, unknown>;
    verifications['main_commercial_registry'] = {
      is_main: false,
      national_number: '7001000001',
      registration_number: '1010000001',
    };
    const bag = mapCorporateFull(answer, { unn: UNN });
    expect(bag['main_registry']).toEqual([
      { identity_id: '1010000001', identity_type: 'CR', has_branch: true },
    ]);
    // A main registration names no other.
    expect('main_registry' in mapCorporateFull(CORPORATE_CONTRACT, { unn: UNN })).toBe(false);
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
  const credential = {
    ref: 'kms://providers/primary/sandbox',
    mode: 'MANAGED' as const,
    material: { clientId: 'id', clientSecret: 'secret' },
  };

  function adapterAnswering(answer: Record<string, unknown>) {
    const calls: { url: string; body: unknown }[] = [];
    const provider = new LeanProvider({
      name: 'primary',
      baseUrl: 'https://sandbox.example.sa',
      authUrl: 'https://auth.sandbox.example.sa/oauth2/token',
      fetch: (url, init) => {
        if (url.endsWith('/oauth2/token')) {
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: 't', expires_in: 3599 }), { status: 200 }),
          );
        }
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
      },
    });
    return { provider, calls };
  }

  it('asks for the full registry record by unified number, in Arabic', async () => {
    const { provider, calls } = adapterAnswering(CORPORATE_FULL);
    const result = await provider.execute({
      endpoint: 'corporate_full',
      input: { unn: UNN },
      credential,
    });

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
    const { provider } = adapterAnswering(
      sandboxVerificationAnswer('corporate_full', { unn: UNN }) ?? {},
    );
    const live = await provider.execute({
      endpoint: 'corporate_full',
      input: { unn: UNN },
      credential,
    });
    const sandbox = await new StubProvider().execute({
      endpoint: 'corporate_full',
      input: { unn: UNN },
      credential,
    });
    expect(sandbox.data).toEqual(live.data);
    expect(sandbox.authority).toBe(live.authority);
  });
});
