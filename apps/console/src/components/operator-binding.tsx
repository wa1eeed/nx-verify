import type { ReactElement } from 'react';
import { Card, CardEmpty, CardHead, CardNote } from './ui/card';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Notice } from './ui/notice';
import { Select } from './ui/select';
import { SubmitButton } from './ui/submit-button';
import { Table, Th } from './ui/table';
import { Tag } from './ui/tag';
import { dateAr } from './format';

/**
 * Whose account one subscriber's calls go out on (ADR-005, ADR-172), operated from the panel.
 *
 * WHY THIS IS HERE AND NOT IN THE SUBSCRIBER'S OWN SETTINGS. BYOC was sized as a screen in the
 * subscriber's settings, and that screen cannot be built. ADR-108 settled that no subscriber
 * screen asks for a provider key and no text names the source, and rule 5 forbids a provider
 * name in anything a subscriber can reach. A field labelled «your credential at the data
 * source» tells the person filling it in exactly whose credential it is: you cannot paste a key
 * without knowing whose key it is. So the subscriber side of BYOC is not a smaller screen, it
 * is no screen.
 *
 * The panel is where naming a provider is allowed (ADR-135), behind its own sign in, its own
 * database role and its own connection, and it is already where the platform's own credential
 * is set. A subscriber who brings their own account hands it over during onboarding, and a
 * member of staff points the binding at it here. Nothing changes for the subscriber: their
 * console, their API responses and their shared profiles still name the authority and never
 * the provider.
 *
 * Rule 10 as far as it actually goes, which is not as far as this comment used to claim
 * (ADR-179). This screen has no field that takes a key: it takes a kms:// pointer to something
 * already sealed in the store of the deployment, the store is asked whether anything is behind
 * that pointer before the row is written, and what comes back into the page is a fingerprint of
 * each secret field, a mask of each identifier, and nothing else. So what passes through the
 * browser is a pointer and a fingerprint, and the material reaches no column, no log and no
 * response.
 *
 * What passes through the server is not the same thing. Every store describes a reference by
 * reading it: EnvSecretStore parses the variable, SealedFileSecretStore decrypts the entry, and
 * HttpSecretStore fetches the material and then reduces it, so while this page renders the
 * material is in the memory of the console process, and HttpSecretStore keeps it in its own
 * cache for up to a minute afterwards by design. Saying «the material never passes through this screen» was therefore false about the
 * half that matters to whoever runs the console. The true sentence is narrower and is the one
 * worth defending: the material does not reach the browser, and nothing here writes it down.
 */

/** What the secret store says it holds behind a reference. Fingerprints and masks, no values. */
export interface StoredCredential {
  updatedAt: Date | null;
  fields: Readonly<Record<string, { fingerprint?: string; masked?: string }>>;
}

/**
 * The answers a row's credential reference can have, kept apart (ADR-179).
 *
 * `empty` is the store saying there is nothing under the reference, and `unanswered` is the
 * store saying nothing at all: unreachable, unparsable, or an entry that would not open.
 * Flattening the second into the first is what this surface did when it shipped, and it is the
 * worst kind of wrong a panel can be: it sends a member of staff to put a secret into a store
 * that may already hold it, under a reference that may already be correct, for a subscriber
 * whose calls are failing for a reason nothing on this screen has named.
 */
export type CredentialState =
  | { state: 'unset' }
  | { state: 'held'; ref: string; credential: StoredCredential }
  | { state: 'empty'; ref: string }
  | { state: 'unanswered'; ref: string; code: string | null };

export interface OperatorBindingRow {
  provider: string;
  /** The provider's name from the catalogue, which exists in the panel only. */
  nameAr: string;
  mode: 'MANAGED' | 'BYOC';
  credential: CredentialState;
  priority: number;
  healthStatus: string;
  activatedAt: Date | null;
}

export interface OperatorBindingView {
  bindings: readonly OperatorBindingRow[];
  catalogue: readonly { code: string; nameAr: string }[];
  /**
   * What just happened to a binding, said in this card because this card is where it happened.
   *
   * The page carried these at the top of the screen while the form sat at the bottom of it, so
   * a save answered somewhere the person who saved was not looking (ADR-179).
   */
  notice: { tone: 'done' | 'refused'; text: string } | null;
  /** The integration permission, which is what guards every other provider credential. */
  canManage: boolean;
}

/**
 * What the screen says about each outcome of a save, kept beside the screen that says it.
 *
 * The page maps its query to one of these and hands it back. Two of them exist only since
 * ADR-179: a store that could not be asked is not a store that answered no, and neither of
 * those two is the third thing this card used to say instead of both.
 */
export const BINDING_NOTICES: Readonly<Record<string, { tone: 'done' | 'refused'; text: string }>> =
  {
    'saved:source': {
      tone: 'done',
      text: 'حُفظ الربط. نداء هذا المشترك التالي يخرج على الاعتماد المحدَّد، ولا يتغير شيء في كونسوله ولا في استجاباته.',
    },
    'saved:source_started': { tone: 'done', text: 'فُعِّل الربط. صار هذا المزوّد في صف من يخدمه.' },
    'saved:source_stopped': {
      tone: 'done',
      text: 'أُوقف الربط. يعود هذا المشترك إلى توجيه المنصة وإلى اعتمادها لبيئة مساحته.',
    },
    'refused:source': {
      tone: 'refused',
      text: 'لم يُحفظ: تحقق من المزوّد ومن الترتيب، والترتيب رقم صحيح أكبر من صفر.',
    },
    'refused:source_ref': {
      tone: 'refused',
      text: 'لم يُحفظ: مرجع الاعتماد يبدأ بـ kms:// ويشير إلى خزنة الأسرار. لا تُلصق هنا قيمة سر.',
    },
    'refused:source_byoc': {
      tone: 'refused',
      text: 'لم يُحفظ: «على اعتماد المشترك» يلزمه مرجع اعتماد. بلا مرجع يخرج النداء على اعتماد المنصة ويُسجَّل بلا تكلفة علينا.',
    },
    'refused:source_unsealed': {
      tone: 'refused',
      text: 'لم يُحفظ: سألنا خزنة الأسرار فأجابت أن لا شيء محفوظاً تحت هذا المرجع. ضع السر في الخزنة أولاً ثم وجّه الربط إليه، وإلا فشل أول نداء لهذا المشترك ولم يقل شيءٌ قبله.',
    },
    'refused:source_store': {
      tone: 'refused',
      text: 'لم يُحفظ: لم تُجب خزنة الأسرار عن هذا المرجع، فلا نعرف أتحته سرٌّ أم لا. هذا عطل في الخزنة لا في ما كتبته، والنداءات نفسها تقرأ من الخزنة ذاتها. أعد المحاولة حين تُجيب.',
    },
  };

const MODE_TAGS: Readonly<
  Record<'MANAGED' | 'BYOC', { labelAr: string; tone: 'accent-2' | 'brand' }>
> = {
  MANAGED: { labelAr: 'على اعتماد المنصة', tone: 'accent-2' },
  BYOC: { labelAr: 'على اعتماد المشترك', tone: 'brand' },
};

const HEALTH_LABELS: Readonly<Record<string, string>> = {
  unknown: 'لم يُختبر',
  healthy: 'سليم',
  degraded: 'متعثّر',
  down: 'متوقف',
};

/** The field names the providers read, in words. An unknown name is shown as it is stored. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  clientId: 'معرّف التطبيق',
  clientSecret: 'السر',
  apiKey: 'المفتاح',
  bearerToken: 'الرمز',
  appToken: 'رمز التطبيق',
};

/**
 * What one reference resolves to, in the three colours the rule allows.
 *
 * A row whose reference the store says is empty is a conflict between the row and the store,
 * and CLAUDE.md gives a conflict the amber of «يستحق النظر»: nothing has failed yet, the first
 * call will. A store that did not answer is a failure that already happened, which is the red,
 * and the sentence beside it has to say that the reference is unknown rather than absent. A
 * binding with no reference at all is neither, and stays neutral.
 */
function CredentialCell({ binding }: { binding: OperatorBindingRow }): ReactElement {
  const credential = binding.credential;
  if (credential.state === 'unset') {
    return <span className="muted">اعتماد المنصة لبيئة مساحته</span>;
  }

  return (
    <>
      <bdi dir="ltr" className="mono">
        {credential.ref}
      </bdi>
      <br />
      {credential.state === 'empty' ? (
        // A pointer at nothing fails at the first call and says nothing until then, which is
        // the one thing a screen of pointers has to catch. Saving one is refused now, so a row
        // in this state is one written before that refusal existed, or one whose secret was
        // removed from the store afterwards.
        <Tag tone="accent" role="binding-credential-missing">
          لا شيء محفوظ تحت هذا المرجع
        </Tag>
      ) : credential.state === 'unanswered' ? (
        <>
          <Tag tone="critical" role="binding-credential-unanswered">
            {credential.code === null ? (
              'تعذّر سؤال خزنة الأسرار'
            ) : (
              <>
                {'تعذّر سؤال خزنة الأسرار · '}
                <bdi dir="ltr" className="mono">
                  {credential.code}
                </bdi>
              </>
            )}
          </Tag>
          <span className="admin-offer-terms">
            {' · '}
            ما تحت هذا المرجع غير معروف الآن، ولا يعني أنه غائب
          </span>
        </>
      ) : (
        <span className="faint">
          {Object.entries(credential.credential.fields)
            .map(([name, value]) => {
              const label = FIELD_LABELS[name] ?? name;
              return value.masked === undefined
                ? `${label} · البصمة ${value.fingerprint ?? ''}`
                : `${label} · ${value.masked}`;
            })
            .join(' · ')}
          {credential.credential.updatedAt === null
            ? ''
            : ` · حُفظ ${dateAr(credential.credential.updatedAt)}`}
        </span>
      )}
    </>
  );
}

export function OperatorBinding({
  tenantId,
  view,
  setBinding,
}: {
  tenantId: string;
  view: OperatorBindingView;
  setBinding: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  const own = view.bindings.filter(
    (binding) => binding.mode === 'BYOC' && binding.activatedAt !== null,
  ).length;

  return (
    <Card variant="flush" role="subscriber-binding-section" labelledBy="subscriber-binding-title">
      <CardHead titleId="subscriber-binding-title" title="مصدر البيانات لهذا المشترك">
        <Tag tone={own === 0 ? 'neutral' : 'brand'}>
          {own === 0 ? 'كل نداءاته على اعتماد المنصة' : `${own} على اعتماده هو`}
        </Tag>
      </CardHead>

      <CardNote>
        على اعتماد المنصة تخرج نداءات هذا المشترك بحسابنا عند المصدر، فتُحتسب تكلفتها علينا ويُحاسَب
        هو عليها هنا. وعلى اعتماده هو تخرج بحسابه فلا تكلفة علينا ولا نشحن عليه ثمن النداء، ولذلك لا
        يُقبل هذا الوضع بلا مرجع اعتماد: ربطٌ يقول «حسابه» ولا يحمل مرجعاً يخرج على حسابنا ويُسجَّل
        بلا تكلفة.
      </CardNote>
      {/*
       * What the switch does, in the two places a reader will not guess.
       *
       * The mode is stamped once when the run opens (verify.ts, resolveExecutionMode), so a run
       * that is already open is still billed the way it was priced. The credential is resolved
       * by the step runner, which memoises it for the life of one runner (step-runner.ts), and a
       * run that stops to wait gets a new runner when it is taken up again: so the steps of a
       * waiting run go out on whatever is saved here, and the steps of a call in flight do not.
       * Saying only «the next call changes» would be wrong about both halves.
       */}
      <CardNote role="binding-consequences">
        ما يحدث عند الحفظ: النداء التالي يخرج على ما حُفظ هنا مباشرة، بلا نشر ولا إعادة تشغيل.
        وتشغيلٌ بدأ قبل الحفظ يبقى محسوباً بالوضع الذي فُتح عليه فلا تتغير فاتورته، أما خطواته التي
        تنتظر ولم تبدأ بعد فتخرج على الاعتماد الجديد حين تُستأنف، لأن الاعتماد يُقرأ عند كل استئناف.
      </CardNote>
      <CardNote>
        لا يصل المشترك شيء من هذه الشاشة: لا اسم مزوّد ولا خانة لمفتاحه. من أحضر اعتماده سلّمه في
        التأهيل، ويوجّه إليه الربطَ موظفٌ من هنا.
      </CardNote>

      {view.bindings.length === 0 ? (
        <CardEmpty>لا ربط خاص بهذا المشترك. نداءاته تخرج على اعتماد المنصة لبيئة مساحته.</CardEmpty>
      ) : (
        <div className="admin-table">
          <Table label="ارتباطات هذا المشترك بمصادر البيانات">
            <thead>
              <tr>
                <Th>المزوّد</Th>
                <Th>الوضع</Th>
                <Th>الاعتماد</Th>
                <Th>الترتيب</Th>
                <Th>الحالة</Th>
                <Th>
                  <span className="visually-hidden">إجراء</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {view.bindings.map((binding) => (
                <tr
                  key={binding.provider}
                  data-role="subscriber-binding"
                  data-item={binding.provider}
                >
                  <td>
                    <span className="admin-offer-title">{binding.nameAr}</span>
                    <span className="admin-offer-terms">
                      {' · '}
                      <bdi dir="ltr" className="mono">
                        {binding.provider}
                      </bdi>
                    </span>
                  </td>
                  <td>
                    <Tag tone={MODE_TAGS[binding.mode].tone} role="binding-mode">
                      {MODE_TAGS[binding.mode].labelAr}
                    </Tag>
                  </td>
                  <td>
                    <CredentialCell binding={binding} />
                  </td>
                  <td>
                    <bdi dir="ltr" className="mono">
                      {binding.priority}
                    </bdi>
                  </td>
                  <td>
                    <Tag tone={binding.activatedAt === null ? 'neutral' : 'accent-2'}>
                      {binding.activatedAt === null
                        ? 'موقوف'
                        : `مفعّل منذ ${dateAr(binding.activatedAt)}`}
                    </Tag>
                    <span className="admin-offer-terms">
                      {' · '}
                      {HEALTH_LABELS[binding.healthStatus] ?? binding.healthStatus}
                    </span>
                  </td>
                  <td>
                    {view.canManage ? (
                      <form action={setBinding} className="row admin-inline-form">
                        <input type="hidden" name="tenant_id" value={tenantId} />
                        <input type="hidden" name="provider" value={binding.provider} />
                        <SubmitButton
                          name="activate"
                          value={binding.activatedAt === null ? '1' : '0'}
                          variant="secondary"
                          data-role="toggle-binding"
                          pendingLabel="جارٍ الحفظ"
                        >
                          {binding.activatedAt === null ? 'تفعيل الربط' : 'إيقاف الربط'}
                        </SubmitButton>
                      </form>
                    ) : (
                      <span className="muted">·</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {/*
       * The answer where the question was asked.
       *
       * Both writes on this card are down here: the toggle in the last column of the table
       * above, and the form below. The page used to hand these sentences to the screen's own
       * header, several sections up, so a save made at the bottom of a long page answered
       * somewhere nobody was looking (ADR-179).
       */}
      {view.notice === null ? null : (
        <Notice tone={view.notice.tone} role="binding-notice">
          {view.notice.text}
        </Notice>
      )}

      {view.canManage ? (
        <form action={setBinding} className="admin-dialog-form" data-role="set-binding">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <Field
            id="binding-provider"
            label="المزوّد"
            hint="من كتالوج المزودين. لا يظهر هذا الاسم في أي شاشة أو استجابة يصلها المشترك."
          >
            {(control) => (
              <Select {...control} name="provider" defaultValue="" required>
                <option value="" disabled>
                  اختر مزوّداً
                </option>
                {view.catalogue.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.nameAr}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            id="binding-mode"
            label="الوضع"
            hint="من يدفع للمصدر بعد الحفظ: المنصة، أو المشترك بحسابه الذي أحضره."
          >
            {(control) => (
              <Select {...control} name="mode" defaultValue="MANAGED" required>
                <option value="MANAGED">{MODE_TAGS.MANAGED.labelAr}</option>
                <option value="BYOC">{MODE_TAGS.BYOC.labelAr}</option>
              </Select>
            )}
          </Field>
          <Field
            id="binding-ref"
            label="مرجع الاعتماد"
            hint="مؤشر إلى سرٍّ محفوظ سلفاً في خزنة الأسرار، يبدأ بـ kms://. لا تُلصق هنا مفتاحاً ولا سراً: هذه الخانة لا تقبل قيمة، وتُسأل الخزنة قبل الحفظ فيُرفض مؤشرٌ لا شيء تحته ويُرفض الحفظ أيضاً إن لم تُجب الخزنة. يُترك فارغاً ليبقى المحفوظ كما هو."
          >
            {(control) => (
              <Input
                {...control}
                name="credential_ref"
                placeholder={`kms://tenants/${tenantId}/`}
                ltr
              />
            )}
          </Field>
          <Field id="binding-priority" label="الترتيب" hint="الأقل يُنادى أولاً. الافتراضي 100.">
            {(control) => (
              <Input {...control} name="priority" inputMode="numeric" placeholder="100" ltr />
            )}
          </Field>
          <SubmitButton variant="secondary" data-role="save-binding" pendingLabel="جارٍ الحفظ">
            حفظ الربط
          </SubmitButton>
        </form>
      ) : null}
    </Card>
  );
}
