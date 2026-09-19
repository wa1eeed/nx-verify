import type { ReactElement } from 'react';
import { Card, CardEmpty, CardHead, CardNote } from './ui/card';
import { Field } from './ui/field';
import { Input } from './ui/input';
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
 * Rule 10 throughout: this screen has no field that takes a key. It takes a kms:// pointer to
 * something already sealed in the store of the deployment, the store is asked whether anything
 * is behind that pointer before the row is written, and what is shown back is a fingerprint.
 * The material never passes through this screen and never reaches a column.
 */

/** What the secret store says it holds behind a reference. Fingerprints and masks, no values. */
export interface StoredCredential {
  updatedAt: Date | null;
  fields: Readonly<Record<string, { fingerprint?: string; masked?: string }>>;
}

export interface OperatorBindingRow {
  provider: string;
  /** The provider's name from the catalogue, which exists in the panel only. */
  nameAr: string;
  mode: 'MANAGED' | 'BYOC';
  credentialRef: string | null;
  credential: StoredCredential | null;
  priority: number;
  healthStatus: string;
  activatedAt: Date | null;
}

export interface OperatorBindingView {
  bindings: readonly OperatorBindingRow[];
  catalogue: readonly { code: string; nameAr: string }[];
  /** Whether this deployment's secret store can be asked what it holds. */
  storeDescribes: boolean;
  /** The integration permission, which is what guards every other provider credential. */
  canManage: boolean;
}

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

function CredentialCell({
  binding,
  storeDescribes,
}: {
  binding: OperatorBindingRow;
  storeDescribes: boolean;
}): ReactElement {
  if (binding.credentialRef === null) {
    return <span className="muted">اعتماد المنصة لبيئة مساحته</span>;
  }

  const entries = Object.entries(binding.credential?.fields ?? {});
  return (
    <>
      <bdi dir="ltr" className="mono">
        {binding.credentialRef}
      </bdi>
      <br />
      {!storeDescribes ? (
        <span className="muted">لا تُسأل خزنة الأسرار في هذا النشر</span>
      ) : binding.credential === null ? (
        // A pointer at nothing fails at the first call and says nothing until then, which is
        // the one thing a screen of pointers has to catch. Saving one is refused now, so a row
        // in this state is one written before that refusal existed, or one whose secret was
        // removed from the store afterwards.
        <Tag tone="critical" role="binding-credential-missing">
          لا شيء محفوظ تحت هذا المرجع
        </Tag>
      ) : (
        <span className="faint">
          {entries
            .map(([name, value]) => {
              const label = FIELD_LABELS[name] ?? name;
              return value.masked === undefined
                ? `${label} · البصمة ${value.fingerprint ?? ''}`
                : `${label} · ${value.masked}`;
            })
            .join(' · ')}
          {binding.credential.updatedAt === null
            ? ''
            : ` · حُفظ ${dateAr(binding.credential.updatedAt)}`}
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
        تنتظر ولم تبدأ بعد فتخرج على الاعتماد الجديد حين تُستأنف، لأن الاعتماد يُقرأ عند كل
        استئناف.
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
                    <CredentialCell binding={binding} storeDescribes={view.storeDescribes} />
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
            hint={
              view.storeDescribes
                ? 'مؤشر إلى سرٍّ محفوظ سلفاً في خزنة الأسرار، يبدأ بـ kms://. لا تُلصق هنا مفتاحاً ولا سراً: هذه الخانة لا تقبل قيمة، وتُسأل الخزنة قبل الحفظ فيُرفض مؤشرٌ لا شيء تحته. يُترك فارغاً ليبقى المحفوظ كما هو.'
                : 'مؤشر إلى سرٍّ محفوظ سلفاً في خزنة الأسرار، يبدأ بـ kms://. لا تُلصق هنا مفتاحاً ولا سراً: هذه الخانة لا تقبل قيمة. خزنة هذا النشر لا تُسأل عمّا تحمل، فلن يُتحقق من وجود السر قبل الحفظ. يُترك فارغاً ليبقى المحفوظ كما هو.'
            }
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
