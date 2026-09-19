import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SubscriberSource,
  type SubscriberSourceView,
} from '../src/components/admin-subscribers/source';

/**
 * Whose account one subscriber's calls go out on, operated from the panel.
 *
 * The card exists in the panel and nowhere else, which is the whole of the design decision: a
 * subscriber who brings their own credential knows whose credential it is, and rule 5 with
 * ADR-108 forbids telling them. So these assertions are about what the card says to staff, and
 * about the two states a screen of pointers has to distinguish: a reference with something
 * behind it, and a reference with nothing.
 */

const EM_DASH = String.fromCharCode(0x2014);
const noop = async (): Promise<void> => undefined;
const TENANT = '6b7f0c62-3f4a-4a1b-9b3d-3f3f6b7c1f11';

const BYOC_BINDING: SubscriberSourceView['bindings'][number] = {
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

const VIEW: SubscriberSourceView = {
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

const render = (overrides: Partial<SubscriberSourceView> = {}): string =>
  renderToStaticMarkup(
    <SubscriberSource tenantId={TENANT} view={{ ...VIEW, ...overrides }} setSource={noop} />,
  );

describe('the data source of one subscriber, in the panel', () => {
  const html = render();

  it('says which account each binding runs on, and what it costs us', () => {
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

  it('describes a stored credential by fingerprint and never fetches its value', () => {
    expect(html).toContain('kms://tenants/');
    expect(html).toContain('البصمة 3f9a12c4');
    expect(html).toContain('معرّف التطبيق · abc…xyz');
    // The masked identifier is all that a value ever shows of itself here.
    expect(html).not.toContain('clientSecret');
  });

  it('marks a reference with nothing behind it, because it fails at the first call', () => {
    const html = render({ bindings: [{ ...BYOC_BINDING, credential: null }] });
    expect(html).toContain('data-role="binding-credential-missing"');
    expect(html).toContain('لا شيء محفوظ تحت هذا المرجع');
  });

  it('says nothing about a store this deployment cannot ask', () => {
    const html = render({ storeDescribes: false });
    expect(html).toContain('لا تُسأل خزنة الأسرار في هذا النشر');
    expect(html).not.toContain('لا شيء محفوظ تحت هذا المرجع');
  });

  it('offers no control to a role that may only look', () => {
    const readOnly = render({ canManage: false });
    expect(readOnly).not.toContain('data-role="save-source"');
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
