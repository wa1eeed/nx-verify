import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NxError } from '@nx-verify/core';
import { EnvSecretStore, type SecretDescription, type SecretStore } from '@nx-verify/providers';
import {
  BINDING_NOTICES,
  OperatorBinding,
  type OperatorBindingView,
} from '../src/components/operator-binding';
import { credentialState } from '../src/app/operator/(panel)/subscribers/[id]/credential';

/**
 * Whose account one subscriber's calls go out on, operated from the panel (ADR-172, ADR-179).
 *
 * The card exists in the panel and nowhere else, which is the whole of the design decision: a
 * subscriber who brings their own credential knows whose credential it is, and rule 5 with
 * ADR-108 forbids telling them. So these assertions are about what the card says to staff: what
 * the switch costs and what it does to work already in flight, the three states a screen of
 * pointers has to distinguish, where the answer to a save appears, and the absence of any field
 * that would take a key (rule 10).
 */

const EM_DASH = String.fromCharCode(0x2014);
const noop = async (): Promise<void> => undefined;
const TENANT = '6b7f0c62-3f4a-4a1b-9b3d-3f3f6b7c1f11';
const REF = `kms://tenants/${TENANT}/wathq-alpha`;

const sourceOf = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const BYOC_BINDING: OperatorBindingView['bindings'][number] = {
  provider: 'wathq-alpha',
  nameAr: 'مصدر البيانات',
  mode: 'BYOC',
  credential: {
    state: 'held',
    ref: REF,
    credential: {
      updatedAt: new Date('2026-09-02T09:00:00Z'),
      fields: { clientId: { masked: 'abc…xyz' }, clientSecret: { fingerprint: '3f9a12c4' } },
    },
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
      credential: { state: 'unset' },
      priority: 100,
      healthStatus: 'unknown',
      activatedAt: null,
    },
  ],
  catalogue: [
    { code: 'wathq-alpha', nameAr: 'مصدر البيانات' },
    { code: 'sadad-beta', nameAr: 'مصدر المدفوعات' },
  ],
  notice: null,
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

/**
 * A store that answered «nothing» and a store that did not answer (ADR-179).
 *
 * The bug this covers said the same sentence for both: «لا شيء محفوظ تحت هذا المرجع» for a
 * secret manager that was unreachable, for a variable that did not parse, and for an entry that
 * would not open. That sentence names a mistake the reader did not make and sends them to store
 * a secret that is very probably already stored, while the real fault, which is the deployment's
 * and not theirs, is named nowhere on the screen.
 */
describe('the three answers a credential reference can have', () => {
  const held = render();
  const empty = render({
    bindings: [{ ...BYOC_BINDING, credential: { state: 'empty', ref: REF } }],
  });
  const unanswered = render({
    bindings: [{ ...BYOC_BINDING, credential: { state: 'unanswered', ref: REF, code: 'NX-5002' } }],
  });

  it('marks a reference the store says is empty, because it fails at the first call', () => {
    expect(empty).toContain('data-role="binding-credential-missing"');
    expect(empty).toContain('لا شيء محفوظ تحت هذا المرجع');
    // Amber: the row and the store disagree and the first call will fail, which is «worth
    // looking at» and not a failure that has happened (CLAUDE.md, the mandatory distinction).
    expect(empty).toContain('tag tag-accent');
    expect(empty).not.toContain('tag tag-critical');
  });

  it('says a store that did not answer did not answer, and never calls that an absence', () => {
    expect(unanswered).toContain('data-role="binding-credential-unanswered"');
    expect(unanswered).toContain('تعذّر سؤال خزنة الأسرار');
    // Our own code, so the reader can take it to whoever runs the store.
    expect(unanswered).toContain('NX-5002');
    expect(unanswered).toContain('ما تحت هذا المرجع غير معروف الآن، ولا يعني أنه غائب');
    // The whole of the defect: these two states must not share a sentence or a colour.
    expect(unanswered).not.toContain('لا شيء محفوظ تحت هذا المرجع');
    expect(unanswered).not.toContain('data-role="binding-credential-missing"');
    // Red: the failure already happened, and it is the store's (CLAUDE.md).
    expect(unanswered).toContain('tag tag-critical');
  });

  it('keeps both apart from a binding that names no reference at all', () => {
    // Neutral, and no reference to show: that subscriber runs on the platform's own credential
    // for its workspace and nothing about it is wrong.
    expect(held).toContain('اعتماد المنصة لبيئة مساحته');
    expect(unanswered).not.toContain('اعتماد المنصة لبيئة مساحته');
    expect(unanswered).toContain(REF);
    expect(empty).toContain(REF);
  });
});

/**
 * Where the answer to a save appears (ADR-179).
 *
 * Both writes on this card are at the bottom of it and the card is the last section of a long
 * page, so the page's own header is the one place the answer must not be.
 */
describe('a save is answered where it was made', () => {
  const saved = BINDING_NOTICES['saved:source'];
  const markup = render({ notice: saved ?? null });

  it('draws the notice inside the card, after the bindings and beside the form', () => {
    expect(saved).toBeDefined();
    expect(markup).toContain('data-role="binding-notice"');
    expect(markup).toContain('حُفظ الربط');
    const notice = markup.indexOf('data-role="binding-notice"');
    expect(notice).toBeGreaterThan(markup.indexOf('data-role="subscriber-binding"'));
    expect(notice).toBeLessThan(markup.indexOf('data-role="set-binding"'));
  });

  it('draws nothing when nothing happened', () => {
    expect(render()).not.toContain('data-role="binding-notice"');
  });

  it('has a sentence for every outcome the action redirects with', () => {
    const action = sourceOf('../src/app/operator/(panel)/subscribers/[id]/actions.ts');
    const outcomes = [...action.matchAll(/'(saved|refused)=([a-z_]+)'/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    );
    expect(outcomes.length).toBeGreaterThan(4);
    for (const outcome of outcomes) {
      expect(BINDING_NOTICES[outcome], outcome).toBeDefined();
    }
    // The refusal for a store that did not answer is not the refusal for a reference with
    // nothing under it, in the action and in the words both.
    expect(outcomes).toContain('refused:source_store');
    expect(BINDING_NOTICES['refused:source_store']?.text).not.toBe(
      BINDING_NOTICES['refused:source_unsealed']?.text,
    );
    expect(BINDING_NOTICES['refused:source_store']?.text).toContain('لم تُجب خزنة الأسرار');
  });

  it('leaves none of these sentences in the screen header the page draws', () => {
    // The page kept them in its own notice map, several sections above the form, which is how
    // the answer ended up off screen. A key that comes back here brings the bug back with it.
    const page = sourceOf('../src/app/operator/(panel)/subscribers/[id]/page.tsx');
    expect(page).not.toContain("'saved:source");
    expect(page).not.toContain("'refused:source");
  });
});

/**
 * The seam between the store and the screen (ADR-179).
 *
 * The screen can only keep the three answers apart if what hands them to it keeps them apart,
 * and this is the function that does. The assertion that matters is the last one: a store that
 * raises must not arrive as «empty», which is what `.catch(() => null)` made of it.
 */
describe('what the page makes of each answer the store gives', () => {
  const asking = (answer: () => Promise<SecretDescription | null>): SecretStore => ({
    writable: false,
    fetch: () => Promise.reject(new Error('not asked here')),
    describe: answer,
  });

  it('carries a description through as held, with the reference beside it', async () => {
    const description = { updatedAt: null, fields: { apiKey: { fingerprint: '1a2b3c4d' } } };
    const state = await credentialState(
      asking(() => Promise.resolve(description)),
      REF,
    );

    expect(state).toEqual({ state: 'held', ref: REF, credential: description });
  });

  it('calls a store that answered nothing empty, and a binding with no reference unset', async () => {
    expect(
      await credentialState(
        asking(() => Promise.resolve(null)),
        REF,
      ),
    ).toEqual({
      state: 'empty',
      ref: REF,
    });
    expect(
      await credentialState(
        asking(() => Promise.resolve(null)),
        null,
      ),
    ).toEqual({
      state: 'unset',
    });
  });

  it('calls a store that raised unanswered, and keeps our own code with it', async () => {
    const state = await credentialState(
      asking(() => Promise.reject(new NxError('NX-5002', { detail: 'the manager answered 503' }))),
      REF,
    );

    expect(state).toEqual({ state: 'unanswered', ref: REF, code: 'NX-5002' });
    // Nothing of the failure's own words travels to the screen, only the code.
    expect(JSON.stringify(state)).not.toContain('503');
  });

  it('calls a failure that carries no code of ours unanswered all the same', async () => {
    expect(
      await credentialState(
        asking(() => Promise.reject(new Error('socket hang up'))),
        REF,
      ),
    ).toEqual({ state: 'unanswered', ref: REF, code: null });
  });

  it('never turns a real failure of a real store into an absence', async () => {
    // The whole chain, with the store this deployment gets when nothing is configured: the
    // variable is unset, so EnvSecretStore raises, and the screen says so rather than sending
    // somebody to look for a secret.
    const state = await credentialState(new EnvSecretStore('NX_SECRETS_NOT_SET_IN_THIS_TEST'), REF);

    expect(state.state).toBe('unanswered');
    expect(state.state).not.toBe('empty');
  });
});

describe('what this screen says about itself', () => {
  it('no longer claims that the material does not pass through it', () => {
    /**
     * The claim was false on the half that matters: describe() in EnvSecretStore and
     * HttpSecretStore reads the material and reduces it, so it passes through the console
     * process that renders this page. What is true is narrower, and the file now says that.
     */
    const source = sourceOf('../src/components/operator-binding.tsx');
    expect(source).not.toContain('المادة لا تمر عبر هذه الشاشة');
    expect(source).not.toContain('The material never passes through this screen');
    expect(source).toContain('the material does not reach the browser');
  });
});
