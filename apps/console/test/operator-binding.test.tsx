import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperatorBinding, type OperatorBindingView } from '../src/components/operator-binding';

/**
 * Whose account one subscriber's calls go out on, operated from the panel (ADR-172).
 *
 * The card exists in the panel and nowhere else, which is the whole of the design decision: a
 * subscriber who brings their own credential knows whose credential it is, and rule 5 with
 * ADR-108 forbids telling them. So these assertions are about what the card says to staff: what
 * the switch costs and what it does to work already in flight, the two states a screen of
 * pointers has to distinguish, and the absence of any field that would take a key (rule 10).
 */

const EM_DASH = String.fromCharCode(0x2014);
const noop = async (): Promise<void> => undefined;
const TENANT = '6b7f0c62-3f4a-4a1b-9b3d-3f3f6b7c1f11';

const BYOC_BINDING: OperatorBindingView['bindings'][number] = {
  provider: 'wathq-alpha',
  nameAr: 'مصدر البيانات',
  mode: 'BYOC',
  credentialRef: `kms://tenants/${TENANT}/wathq-alpha`,
  credential: {
    updatedAt: new Date('2026-09-02T09:00:00Z'),
    fields: { clientId: { masked: 'abc…xyz' }, clientSecret: { fingerprint: '3f9a12c4' } },
  },
  priority: 10,
  healthStatus: 'healthy',
  activatedAt: new Date('2026-09-02T09:00:00Z'),
};

const VIEW: OperatorBindingView = {
  bindings: [
    BYOC_BINDING,
    {
      provider: 'sadad-beta',
      nameAr: 'مصدر المدفوعات',
      mode: 'MANAGED',
      credentialRef: null,
      credential: null,
      priority: 100,
      healthStatus: 'unknown',
      activatedAt: null,
    },
  ],
  catalogue: [
    { code: 'wathq-alpha', nameAr: 'مصدر البيانات' },
    { code: 'sadad-beta', nameAr: 'مصدر المدفوعات' },
  ],
  storeDescribes: true,
  canManage: true,
};

const render = (overrides: Partial<OperatorBindingView> = {}): string =>
  renderToStaticMarkup(
    <OperatorBinding tenantId={TENANT} view={{ ...VIEW, ...overrides }} setBinding={noop} />,
  );

describe('the data source of one subscriber, in the panel', () => {
  const html = render();

  it('says which account each binding runs on, and who pays the source in each', () => {
    for (const text of [
      'مصدر البيانات لهذا المشترك',
      'على اعتماد المنصة',
      'على اعتماد المشترك',
      'الاعتماد',
      'الترتيب',
      'مفعّل منذ',
      'موقوف',
      'حفظ الربط',
      'إيقاف الربط',
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain(EM_DASH);
  });

  it('says what the switch does to the bill and to a run already open', () => {
    // The two halves a reader would otherwise guess wrong. The mode is stamped once when the
    // run opens, so that run is still billed the way it was priced; the credential is memoised
    // for the life of one step runner, and a run that waits gets a new runner when it is taken
    // up again, so its remaining steps go out on the new one.
    expect(html).toContain('data-role="binding-consequences"');
    expect(html).toContain('النداء التالي يخرج على ما حُفظ هنا مباشرة');
    expect(html).toContain('يبقى محسوباً بالوضع الذي فُتح عليه');
    expect(html).toContain('تخرج على الاعتماد الجديد');
  });

  it('takes a pointer to a sealed secret and has no field that takes a key', () => {
    expect(html).toContain('kms://tenants/');
    expect(html).toContain('لا تُلصق هنا مفتاحاً ولا سراً');
    expect(html).toContain('وتُسأل الخزنة قبل الحفظ فيُرفض مؤشرٌ لا شيء تحته');
    // One field for the pointer, and none for anything the pointer resolves to (rule 10).
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('name="client_secret"');
    expect(html).not.toContain('name="api_key"');
  });

  it('describes a stored credential by fingerprint and never fetches its value', () => {
    expect(html).toContain('البصمة 3f9a12c4');
    expect(html).toContain('معرّف التطبيق · abc…xyz');
    // The masked identifier is all that a value ever shows of itself here.
    expect(html).not.toContain('clientSecret');
  });

  it('marks a reference with nothing behind it, because it fails at the first call', () => {
    const marked = render({ bindings: [{ ...BYOC_BINDING, credential: null }] });
    expect(marked).toContain('data-role="binding-credential-missing"');
    expect(marked).toContain('لا شيء محفوظ تحت هذا المرجع');
  });

  it('does not claim to have checked a store this deployment cannot ask', () => {
    const unasked = render({ storeDescribes: false });
    expect(unasked).toContain('لا تُسأل خزنة الأسرار في هذا النشر');
    expect(unasked).toContain('فلن يُتحقق من وجود السر قبل الحفظ');
    expect(unasked).not.toContain('وتُسأل الخزنة قبل الحفظ فيُرفض مؤشرٌ لا شيء تحته');
    expect(unasked).not.toContain('لا شيء محفوظ تحت هذا المرجع');
  });

  it('offers no control to a role that may only look', () => {
    const readOnly = render({ canManage: false });
    expect(readOnly).not.toContain('data-role="save-binding"');
    expect(readOnly).not.toContain('data-role="toggle-binding"');
    // It still says whose account each subscriber runs on: looking is every role's.
    expect(readOnly).toContain('على اعتماد المشترك');
  });

  it('says what a subscriber with no binding of its own runs on', () => {
    const empty = render({ bindings: [] });
    expect(empty).toContain(
      'لا ربط خاص بهذا المشترك. نداءاته تخرج على اعتماد المنصة لبيئة مساحته.',
    );
    expect(empty).toContain('كل نداءاته على اعتماد المنصة');
  });
});
