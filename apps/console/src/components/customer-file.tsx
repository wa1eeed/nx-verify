import type { ReactElement, ReactNode } from 'react';
import type {
  AccountView,
  CustomerFile,
  FileField,
  FileSection,
  Intersection,
  ManagerView,
  PartnerView,
  SectionState,
} from '@nx-verify/core';
import { CheckList, type CheckOption } from './check-list';
import { CheckResults, type CheckResultView } from './check-results';
import { count, dateTime, isoDate, shortMask, sinceAr } from './format';
import type { FieldHistoryView } from './field-card';

/**
 * A customer's file.
 *
 * Read top to bottom the way the owner described it: who this is and what kind of customer,
 * how far they are verified and how risky that looks, then one section per verification,
 * each with the facts it holds and its own verify button. Beside the sections, the checklist
 * that verifies several at once, the KYB or KYC indicators with the reason for each, and the
 * links to the subscriber's other customers.
 *
 * Every fact shows its authority and when it was observed (rule 6), and a fact that was
 * verified before keeps its earlier values one click away: a new verification adds to a
 * file, it never erases it.
 *
 * One primary button on the screen, the checklist's. A section's own button is secondary,
 * because it does a smaller version of the same thing.
 */

type Action = string | ((formData: FormData) => void | Promise<void>);

export interface CustomerFileView {
  file: CustomerFile;
  /** One key for the checklist and one per section, issued when the page was drawn. */
  bundles: {
    checklist: string;
    sections: Readonly<Record<string, string>>;
    managers: Readonly<Record<string, string>>;
  };
  prices: Readonly<Record<string, number | null>>;
  refusals: Readonly<Record<string, string | null>>;
  fromPackage: boolean;
  capacityRemaining: number | null;
  results: CheckResultView[] | null;
  error: string | null;
  histories: Readonly<Record<string, FieldHistoryView[]>>;
  now: Date;
}

const ID_LABELS: Readonly<Record<string, string>> = {
  UNN: 'الرقم الموحد',
  CR: 'السجل التجاري',
  NATIONAL_ID: 'الهوية الوطنية',
  IQAMA: 'الإقامة',
  FREELANCE_DOC: 'وثيقة العمل الحر',
  IBAN: 'الآيبان',
  REAL_ESTATE_NO: 'رقم العقار',
};

const ERRORS: Readonly<Record<string, string>> = {
  iban: 'رقم الآيبان السعودي يبدأ بـSA ويتبعه 22 رقماً.',
  checks: 'حدّد عملية تحقق واحدة على الأقل.',
};

function StateBadge({ section, now }: { section: FileSection; now: Date }): ReactElement {
  const observed = section.fields.reduce<Date | null>(
    (latest, field) => (latest === null || field.observedAt > latest ? field.observedAt : latest),
    null,
  );
  const labels: Record<SectionState, { text: string; tone: string }> = {
    VERIFIED: { text: observed ? `موثّق · ${sinceAr(observed, now)}` : 'موثّق', tone: 'fresh' },
    EXPIRING: { text: 'تقترب صلاحيته من الانتهاء', tone: 'neutral' },
    EXPIRED: { text: 'منتهي الصلاحية', tone: 'expired' },
    CHANGED: { text: 'تغيّر مرصود', tone: 'changed' },
    NOT_VERIFIED: { text: 'لم يُتحقق بعد', tone: 'neutral' },
    NOT_FOUND: { text: 'لا توجد بيانات لدى الجهة', tone: 'neutral' },
    FAILED: { text: 'تعذّر آخر تحقق', tone: 'critical' },
  };
  const label = labels[section.state];
  return (
    <span
      className="badge"
      data-tone={label.tone}
      data-role="section-state"
      data-state={section.state}
    >
      {label.text}
    </span>
  );
}

function renderValue(field: FileField): ReactNode {
  if (field.valueLabelAr) {
    return field.valueLabelAr;
  }
  const value = field.value;
  if (typeof value === 'boolean') {
    return value ? 'نعم' : 'لا';
  }
  if (typeof value === 'number') {
    return (
      <bdi dir="ltr" className="mono">
        {count(value)}
      </bdi>
    );
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string')) {
      return (
        <span className="chips">
          {(value as string[]).map((entry) => (
            <span className="chip" key={entry}>
              {entry}
            </span>
          ))}
        </span>
      );
    }
    return (
      <ul className="stack" style={{ gap: 2, margin: 0, paddingInlineStart: 0, listStyle: 'none' }}>
        {value.map((entry, index) => {
          const record = (entry ?? {}) as Record<string, unknown>;
          const name = typeof record['name'] === 'string' ? record['name'] : JSON.stringify(entry);
          const pct = record['approve_percentage'];
          return (
            <li key={index}>
              {name}
              {typeof pct === 'number' ? (
                <span className="faint">
                  {' '}
                  (
                  <bdi dir="ltr" className="mono">
                    {pct}%
                  </bdi>
                  )
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }
  if (typeof value === 'string' && !/[\u0600-\u06FF]/.test(value)) {
    // Latin text inside a right to left page keeps its own order: a masked holder name,
    // a web address, a SWIFT code.
    return /^[\w\-+.:/]+$/.test(value) ? (
      <bdi dir="ltr" className="mono">
        {value}
      </bdi>
    ) : (
      <bdi dir="ltr">{value}</bdi>
    );
  }
  if (typeof value === 'string') {
    return value;
  }
  return value === null || value === undefined ? 'غير متوفر' : JSON.stringify(value);
}

function Fact({
  field,
  history,
}: {
  field: FileField;
  history: FieldHistoryView[] | undefined;
}): ReactElement {
  const wide = Array.isArray(field.value) && field.value.length > 2;
  return (
    <div
      className={`fact${wide ? ' fact-wide' : ''}`}
      data-field={field.fieldPath}
      data-freshness={field.freshness}
      data-changed={field.changed ? 'yes' : 'no'}
    >
      <dt>{field.labelAr}</dt>
      <dd>
        <span className="fact-value">{renderValue(field)}</span>
        <span className="fact-meta">
          <span data-role="authority">{field.authority ?? 'بلا جهة'}</span> ·{' '}
          <bdi dir="ltr" className="mono" data-role="observed-at">
            {dateTime(field.observedAt)}
          </bdi>
          {field.freshness === 'expired'
            ? ' · منتهية الصلاحية'
            : field.freshness === 'expiring'
              ? ' · تقترب من الانتهاء'
              : ''}
        </span>
        {history && history.length > 0 ? (
          <details data-role="field-history">
            <summary className="fact-meta">القيم السابقة ({history.length})</summary>
            <ul
              className="stack"
              style={{ gap: 2, margin: 0, paddingInlineStart: 0, listStyle: 'none' }}
            >
              {history.map((entry, index) => (
                <li
                  key={`${entry.observedAt.toISOString()}-${index}`}
                  className="fact-meta"
                  data-changed={entry.changed ? 'yes' : 'no'}
                >
                  <bdi dir="ltr" className="mono">
                    {isoDate(entry.observedAt)}
                  </bdi>{' '}
                  {typeof entry.value === 'string' || typeof entry.value === 'number'
                    ? String(entry.value)
                    : JSON.stringify(entry.value)}
                  {entry.changed ? ' · تغيّر هنا' : ''}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </dd>
    </div>
  );
}

function LinkList({
  entities,
}: {
  entities: { entityId: string; name: string | null }[];
}): ReactElement {
  return (
    <>
      {entities.map((entity, index) => (
        <span key={entity.entityId}>
          {index > 0 ? '، ' : ''}
          <a href={`/customers/${entity.entityId}`}>{entity.name ?? 'بلا اسم'}</a>
        </span>
      ))}
    </>
  );
}

function ManagerCard({
  manager,
  entityId,
  bundle,
  action,
  canCheck,
}: {
  manager: ManagerView;
  entityId: string;
  bundle: string;
  action: Action;
  canCheck: boolean;
}): ReactElement {
  return (
    <article className="person-card" data-role="manager">
      <div className="person-head">
        <div className="stack" style={{ gap: 2 }}>
          <strong>{manager.name ?? 'مدير بلا اسم'}</strong>
          <span className="faint">
            {manager.maskedId ? (
              <bdi dir="ltr" className="mono">
                {shortMask(manager.maskedId)}
              </bdi>
            ) : null}
            {manager.nationality ? ` · ${manager.nationality}` : ''}
          </span>
        </div>
        {canCheck ? (
          <form action={action}>
            <input type="hidden" name="entity_id" value={entityId} />
            <input type="hidden" name="kind" value="BUSINESS" />
            <input type="hidden" name="bundle" value={bundle} />
            <input type="hidden" name="checks" value="MANAGER_AUTHORITY" />
            <input type="hidden" name="person" value={manager.entityId} />
            <button type="submit" className="btn btn-secondary btn-small" data-role="check-manager">
              {manager.permissions === null ? 'تحقق من صلاحياته' : 'تحديث الصلاحيات'}
            </button>
          </form>
        ) : null}
      </div>

      {manager.positions.length > 0 ? (
        <span className="chips">
          {manager.positions.map((position) => (
            <span className="chip" key={position}>
              {position}
            </span>
          ))}
        </span>
      ) : null}

      {manager.permissions === null ? (
        <span className="muted">لم يُتحقق من صلاحياته في هذه المنشأة بعد.</span>
      ) : manager.permissions.length === 0 ? (
        <span className="muted">لا صلاحيات مسجلة له في هذه المنشأة.</span>
      ) : (
        <div className="table-scroll">
          <table className="permission-table" data-role="permissions">
            <thead>
              <tr>
                <th>الصلاحية</th>
                <th>تُمارس</th>
                <th>إصدار توكيل</th>
                <th>تفويض</th>
              </tr>
            </thead>
            <tbody>
              {manager.permissions.map((permission, index) => (
                <tr key={`${permission.name ?? ''}-${index}`}>
                  <td>
                    {permission.name}
                    {permission.condition ? (
                      <div className="faint">{permission.condition}</div>
                    ) : null}
                  </td>
                  <td>{permission.method ?? 'غير محدد'}</td>
                  <td>
                    {permission.canIssuePoa === null
                      ? 'غير محدد'
                      : permission.canIssuePoa
                        ? 'نعم'
                        : 'لا'}
                  </td>
                  <td>
                    {permission.canDelegate === null
                      ? 'غير محدد'
                      : permission.canDelegate
                        ? 'نعم'
                        : 'لا'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <span className="fact-meta">
        وزارة التجارة
        {manager.permissionsCheckedAt ? (
          <>
            {' '}
            · الصلاحيات{' '}
            <bdi dir="ltr" className="mono">
              {dateTime(manager.permissionsCheckedAt)}
            </bdi>
          </>
        ) : manager.observedAt ? (
          <>
            {' '}
            ·{' '}
            <bdi dir="ltr" className="mono">
              {dateTime(manager.observedAt)}
            </bdi>
          </>
        ) : null}
      </span>

      {manager.alsoManages.length > 0 ? (
        <span className="muted" data-role="also-manages">
          يدير أيضاً من عملائك: <LinkList entities={manager.alsoManages} />
        </span>
      ) : null}
      {manager.isCustomer ? (
        <span>
          <a className="chip" data-kind="FREELANCER" href={`/customers/${manager.entityId}`}>
            عميل لديك كعامل حر
          </a>
        </span>
      ) : null}
    </article>
  );
}

function PartnersTable({ partners }: { partners: PartnerView[] }): ReactElement {
  return (
    <div className="table-scroll" data-role="partners">
      <table>
        <thead>
          <tr>
            <th>الشريك</th>
            <th>الصفة</th>
            <th>الحصص</th>
            <th>نسبة الأرباح</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((partner) => (
            <tr key={partner.entityId}>
              <td>
                {partner.name ?? 'بلا اسم'}
                <div className="faint">
                  {partner.kind === 'BUSINESS' ? 'منشأة' : 'فرد'}
                  {partner.maskedId ? (
                    <>
                      {' · '}
                      <bdi dir="ltr" className="mono">
                        {shortMask(partner.maskedId)}
                      </bdi>
                    </>
                  ) : null}
                </div>
                {partner.alsoOwns.length > 0 ? (
                  <div className="muted">
                    شريك أيضاً في: <LinkList entities={partner.alsoOwns} />
                  </div>
                ) : null}
              </td>
              <td>{partner.roles.join('، ') || 'غير محدد'}</td>
              <td>
                <bdi dir="ltr" className="mono">
                  {partner.shares === null ? 'غير محدد' : count(partner.shares)}
                </bdi>
              </td>
              <td>
                <bdi dir="ltr" className="mono">
                  {partner.profitPct === null ? 'غير محدد' : `${partner.profitPct}%`}
                </bdi>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OWNERSHIP: Readonly<Record<string, { text: string; tone: string }>> = {
  MATCH: { text: 'مطابق', tone: 'fresh' },
  PARTIAL: { text: 'تطابق جزئي', tone: 'neutral' },
  NO_MATCH: { text: 'غير مطابق', tone: 'critical' },
};

function AccountsList({ accounts }: { accounts: AccountView[] }): ReactElement {
  return (
    <ul
      className="stack"
      style={{ gap: 'var(--s-2)', margin: 0, paddingInlineStart: 0, listStyle: 'none' }}
      data-role="accounts"
    >
      {accounts.map((account) => (
        <li key={account.entityId} className="person-card">
          <div className="person-head">
            <span>
              <bdi dir="ltr" className="mono">
                {shortMask(account.maskedIban) ?? 'آيبان'}
              </bdi>
              {account.bank ? <span className="muted"> · {account.bank}</span> : null}
            </span>
            {account.ownership ? (
              <span className="badge" data-tone={OWNERSHIP[account.ownership]?.tone ?? 'neutral'}>
                {OWNERSHIP[account.ownership]?.text ?? account.ownership}
              </span>
            ) : null}
          </div>
          {account.checkedAt ? (
            <span className="fact-meta">
              تحقق{' '}
              <bdi dir="ltr" className="mono">
                {dateTime(account.checkedAt)}
              </bdi>
            </span>
          ) : null}
          {account.sharedWith.length > 0 ? (
            <span className="badge" data-tone="critical" style={{ justifySelf: 'start' }}>
              مقدَّم أيضاً لعميل آخر
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SectionForm({
  section,
  file,
  bundle,
  action,
}: {
  section: FileSection;
  file: CustomerFile;
  bundle: string;
  action: Action;
}): ReactElement | null {
  const runnable = section.checks.filter(
    (check) => check.availability === 'AVAILABLE' && check.productCode !== 'IBAN_BENEFICIARY_NAME',
  );
  if (runnable.length === 0) {
    return section.checks.length > 0 ? <span className="chip">قريباً</span> : null;
  }
  // Checking managers is done person by person, beside each of them.
  if (section.section === 'MANAGERS') {
    return null;
  }
  const banking = section.section === 'BANKING';
  return (
    <form action={action} className="row" style={{ gap: 'var(--s-2)' }} data-role="section-form">
      <input type="hidden" name="entity_id" value={file.entityId} />
      <input
        type="hidden"
        name="kind"
        value={file.entityType === 'FREELANCER' ? 'FREELANCER' : 'BUSINESS'}
      />
      <input type="hidden" name="bundle" value={bundle} />
      {runnable.map((check) => (
        <input key={check.productCode} type="hidden" name="checks" value={check.productCode} />
      ))}
      {banking ? (
        <input
          name="iban"
          dir="ltr"
          className="mono"
          placeholder={file.accounts.length > 0 ? 'آيبان آخر (اختياري)' : 'SA...'}
          aria-label="رقم الآيبان"
          style={{ width: '16rem', padding: '5px 10px', fontSize: 13 }}
          required={file.accounts.length === 0}
        />
      ) : null}
      <button type="submit" className="btn btn-secondary btn-small" data-role="check-section">
        {section.fields.length > 0 ? 'إعادة التحقق' : 'تحقق'}
      </button>
    </form>
  );
}

function SectionCard({
  section,
  view,
  action,
}: {
  section: FileSection;
  view: CustomerFileView;
  action: Action;
}): ReactElement {
  const { file } = view;
  const bundle = view.bundles.sections[section.section] ?? view.bundles.checklist;
  const managerCheck = file.checks.find((check) => check.productCode === 'MANAGER_AUTHORITY');
  return (
    <section
      className="section-card"
      data-role="file-section"
      data-section={section.section}
      data-state={section.state}
    >
      <div className="section-head">
        <div className="row" style={{ gap: 'var(--s-3)' }}>
          <h2>{section.titleAr}</h2>
          <StateBadge section={section} now={view.now} />
        </div>
        <SectionForm section={section} file={file} bundle={bundle} action={action} />
      </div>
      <div className="section-body stack" style={{ gap: 'var(--s-4)' }}>
        {section.fields.length > 0 ? (
          <dl className="fact-list">
            {section.fields.map((field) => (
              <Fact key={field.fieldPath} field={field} history={view.histories[field.fieldPath]} />
            ))}
          </dl>
        ) : null}

        {section.section === 'MANAGERS' ? (
          file.managers.length > 0 ? (
            <div>
              {file.managers.map((manager) => (
                <ManagerCard
                  key={manager.entityId}
                  manager={manager}
                  entityId={file.entityId}
                  bundle={view.bundles.managers[manager.entityId] ?? view.bundles.checklist}
                  action={action}
                  canCheck={managerCheck?.availability === 'AVAILABLE' && manager.maskedId !== null}
                />
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              يظهر المدراء بعد التحقق من السجل التجاري، ثم يمكن التحقق من صلاحيات كل مدير.
            </p>
          )
        ) : null}

        {section.section === 'CONTRACT' && file.partners.length > 0 ? (
          <PartnersTable partners={file.partners} />
        ) : null}
        {section.section === 'BANKING' && file.accounts.length > 0 ? (
          <AccountsList accounts={file.accounts} />
        ) : null}

        {section.fields.length === 0 &&
        section.section !== 'MANAGERS' &&
        !(section.section === 'BANKING' && file.accounts.length > 0) ? (
          <p className="muted" style={{ margin: 0 }} data-role="section-empty">
            {section.state === 'NOT_FOUND'
              ? 'سألنا الجهة الرسمية ولم تجد بيانات لهذا العميل.'
              : section.state === 'FAILED'
                ? 'تعذّر الوصول إلى الجهة في آخر محاولة، ولم تُحتسب العملية.'
                : 'لم يُتحقق من هذا القسم بعد.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}

const MARKS: Readonly<Record<string, string>> = {
  PASS: '✓',
  FAIL: '✕',
  WARN: '!',
  UNKNOWN: '؟',
  NA: '–',
};

function IndicatorsPanel({ file }: { file: CustomerFile }): ReactElement {
  const { assessment } = file;
  return (
    <section className="panel" data-role="indicators">
      <div className="panel-header">
        <h2>مؤشرات {assessment.mode}</h2>
        <span className="muted">
          <bdi dir="ltr" className="mono">
            {assessment.passed}/{assessment.applicable}
          </bdi>
        </span>
      </div>
      <div className="panel-body stack" style={{ gap: 'var(--s-4)' }}>
        <ul className="indicator-list">
          {assessment.items.map((item) => (
            <li
              key={item.key}
              className="indicator"
              data-state={item.state}
              data-indicator={item.key}
            >
              <span className="indicator-mark" aria-hidden="true">
                {MARKS[item.state]}
              </span>
              <span className="stack" style={{ gap: 0 }}>
                <span>{item.labelAr}</span>
                {item.detailAr ? <span className="faint">{item.detailAr}</span> : null}
              </span>
            </li>
          ))}
        </ul>

        <div>
          <strong style={{ fontSize: 14 }}>ما يستحق الانتباه</strong>
          {assessment.signals.length === 0 ? (
            <p className="muted" style={{ margin: 'var(--s-2) 0 0' }}>
              لا شيء لافت فيما تحققنا منه.
            </p>
          ) : (
            <div data-role="signals">
              {assessment.signals.map((signal) => (
                <div
                  key={signal.key + signal.textAr}
                  className="signal"
                  data-severity={signal.severity}
                >
                  <span
                    className="badge"
                    data-tone={signal.severity === 'HIGH' ? 'critical' : 'neutral'}
                  >
                    {signal.severity === 'HIGH'
                      ? 'مرتفع'
                      : signal.severity === 'MEDIUM'
                        ? 'متوسط'
                        : 'منخفض'}
                  </span>
                  <span>{signal.textAr}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function IntersectionsPanel({ intersections }: { intersections: Intersection[] }): ReactElement {
  return (
    <section className="panel" data-role="intersections">
      <div className="panel-header">
        <h2>روابط مع عملائك</h2>
        <span className="muted">
          {intersections.length === 0 ? 'لا روابط' : count(intersections.length)}
        </span>
      </div>
      <div className="panel-body">
        {intersections.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            لم نجد مديراً أو شريكاً أو حساباً أو عنواناً مشتركاً مع عملائك الآخرين.
          </p>
        ) : (
          intersections.map((intersection, index) => (
            <div
              key={`${intersection.kind}-${index}`}
              className="intersection"
              data-kind={intersection.kind}
            >
              <span>{intersection.textAr}</span>
              <span className="muted">
                <LinkList entities={intersection.entities} />
              </span>
            </div>
          ))
        )}
        <p className="faint" style={{ margin: 'var(--s-3) 0 0' }}>
          تُبحث الروابط بين عملائك وحدهم، ولا تُقارن بيانات مشترك بمشترك آخر.
        </p>
      </div>
    </section>
  );
}

function VerifyPanel({ view, action }: { view: CustomerFileView; action: Action }): ReactElement {
  const { file } = view;
  const stateOf = new Map(file.sections.map((section) => [section.section, section.state]));
  const options: CheckOption[] = file.checks.map((check) => {
    const state = stateOf.get(check.section);
    const refusal = view.refusals[check.productCode] ?? null;
    return {
      productCode: check.productCode,
      nameAr: check.nameAr,
      sectionAr: '',
      unitPriceHalalas: view.prices[check.productCode] ?? null,
      // Ticked where the file is thin or old; left alone where it is current.
      checked:
        check.productCode !== 'IBAN_BENEFICIARY_NAME' &&
        state !== 'VERIFIED' &&
        state !== 'EXPIRING' &&
        !(check.section === 'BANKING' && file.accounts.length === 0),
      disabledReasonAr: check.availability !== 'AVAILABLE' ? 'قريباً' : refusal,
      noteAr: check.productCode === 'MANAGER_AUTHORITY' ? 'لكل مدير' : null,
    };
  });
  const banking = file.checks.some((check) => check.section === 'BANKING');

  return (
    <section className="panel" data-role="verify-panel">
      <div className="panel-header">
        <h2>تحقق من العميل</h2>
        <span className="muted">حدّد ثم تحقق</span>
      </div>
      <form action={action} className="panel-body stack" style={{ gap: 'var(--s-3)' }}>
        <input type="hidden" name="entity_id" value={file.entityId} />
        <input
          type="hidden"
          name="kind"
          value={file.entityType === 'FREELANCER' ? 'FREELANCER' : 'BUSINESS'}
        />
        <input type="hidden" name="bundle" value={view.bundles.checklist} />
        <CheckList
          options={options}
          fromPackage={view.fromPackage}
          capacityRemaining={view.capacityRemaining}
        />
        {banking ? (
          <input
            name="iban"
            dir="ltr"
            className="mono"
            placeholder="آيبان للتحقق (اختياري)"
            aria-label="رقم الآيبان"
          />
        ) : null}
        <button type="submit" className="btn btn-primary" data-role="run-checks">
          تحقق من المحدد
        </button>
      </form>
    </section>
  );
}

export function CustomerFileScreen({
  view,
  action,
}: {
  view: CustomerFileView;
  action: Action;
}): ReactElement {
  const { file } = view;
  const assessment = file.assessment;
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }} data-role="customer-file">
      {view.results ? <CheckResults results={view.results} /> : null}
      {view.error ? (
        <p className="sign-in-error" role="alert">
          {ERRORS[view.error] ?? 'تعذّر تنفيذ الطلب.'}
        </p>
      ) : null}

      <header className="card file-header" data-role="header">
        <div className="file-title">
          <h1>{file.displayName ?? 'عميل بلا اسم بعد'}</h1>
          <span className="chip" data-kind={file.kind ?? 'UNKNOWN'} data-role="classification">
            {file.kindLabelAr}
          </span>
          {file.status.textAr ? (
            <span className="badge" data-tone={file.status.tone} data-role="status">
              {file.status.textAr}
            </span>
          ) : null}
        </div>

        {file.identifiers.length > 0 ? (
          <div className="row" style={{ gap: 'var(--s-4)' }} data-role="identifiers">
            {file.identifiers.map((identifier) => (
              <span key={`${identifier.idType}-${shortMask(identifier.masked)}`} className="muted">
                {ID_LABELS[identifier.idType] ?? identifier.idType}:{' '}
                <bdi dir="ltr" className="mono">
                  {shortMask(identifier.masked)}
                </bdi>
              </span>
            ))}
          </div>
        ) : null}

        <div className="kpi-strip" data-role="headline">
          <div className="kpi" data-tone={assessment.statusTone}>
            <span className="stat-label">حالة التحقق</span>
            <strong>{assessment.statusAr}</strong>
          </div>
          <div
            className="kpi"
            data-tone={
              assessment.riskLevel === 'HIGH'
                ? 'critical'
                : assessment.riskLevel === 'LOW'
                  ? 'fresh'
                  : 'neutral'
            }
          >
            <span className="stat-label">مستوى المخاطر</span>
            <strong data-role="risk-level">{assessment.riskLabelAr}</strong>
          </div>
          <div className="kpi">
            <span className="stat-label">اكتمال الملف</span>
            <strong>
              <bdi dir="ltr" className="mono">
                {file.completeness}%
              </bdi>
            </strong>
            <span className="meter" aria-hidden="true">
              <span className="meter-fill" style={{ width: `${file.completeness}%` }} />
            </span>
          </div>
          <div className="kpi">
            <span className="stat-label">آخر تحقق</span>
            <strong>
              <bdi dir="ltr" className="mono">
                {file.lastVerifiedAt ? isoDate(file.lastVerifiedAt) : 'لا يوجد'}
              </bdi>
            </strong>
          </div>
          <div className="kpi">
            <span className="stat-label">المراجعة القادمة</span>
            <strong>
              <bdi dir="ltr" className="mono">
                {file.nextReviewAt ? isoDate(file.nextReviewAt) : 'لا يوجد'}
              </bdi>
            </strong>
          </div>
        </div>
      </header>

      <div className="file-layout">
        <div className="stack" style={{ gap: 'var(--s-4)' }}>
          {file.sections.map((section) => (
            <SectionCard key={section.section} section={section} view={view} action={action} />
          ))}
          {file.sections.length === 0 ? (
            <p className="empty">لا أقسام لهذا النوع من السجلات.</p>
          ) : null}
        </div>
        <aside className="file-aside">
          {file.checks.length > 0 ? <VerifyPanel view={view} action={action} /> : null}
          <IndicatorsPanel file={file} />
          <IntersectionsPanel intersections={file.intersections} />
        </aside>
      </div>
    </div>
  );
}
