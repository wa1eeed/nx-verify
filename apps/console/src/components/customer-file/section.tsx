import type { ReactElement, ReactNode } from 'react';
import {
  NAME_MATCH_THRESHOLD_PCT,
  type CustomerFile,
  type FileField,
  type FileSection,
  type ManagerView,
  type PartnerView,
} from '@nx-verify/core';
import type { FieldHistoryView } from '../field-card';
import { dateAr, dayMonthAr, isoDate, shortMask } from '../format';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Card, CardTitle } from '../ui/card';
import type { IconName } from '../ui/icon';
import { Input } from '../ui/input';
import { Ltr } from '../ui/ltr';
import { SubmitButton } from '../ui/submit-button';
import { StateTag, type TagState } from '../ui/tag';
import { Table, Th } from '../ui/table';
import { MATCH_SCORE_FIELDS, orderedFields, permissionsCountAr, renderValue } from './values';

/**
 * One section of a customer file (README, screen 03).
 *
 * The number, the name and the source on one side; the state and the section's own verify
 * button facing them. A section whose verified facts do not hold carries the accent and the
 * one primary button a section may have; every other section's button is secondary. The
 * authority and the moment of observation are said once for the section when its facts
 * share them, and beside a fact when they do not (CLAUDE.md, interface).
 */

export type Action = string | ((formData: FormData) => void | Promise<void>);

export interface SectionContext {
  file: CustomerFile;
  action: Action;
  bundle: string;
  managerBundles: Readonly<Record<string, string>>;
  refusals: Readonly<Record<string, string | null>>;
  histories: Readonly<Record<string, FieldHistoryView[]>>;
  /** Checks queued or running for this customer: their sections say so and wait. */
  running: ReadonlySet<string>;
}

/** The kind a request for this file is made as. A business not read yet is offered a company's checks. */
export function customerKindOf(file: CustomerFile): 'COMPANY' | 'ESTABLISHMENT' | 'FREELANCER' {
  return file.entityType === 'FREELANCER' ? 'FREELANCER' : (file.kind ?? 'COMPANY');
}

function stateTagOf(section: FileSection): { state: TagState; text: string } {
  switch (section.state) {
    case 'VERIFIED':
      return {
        state: 'VERIFIED',
        text: section.observedAt ? `مُتحقق · ${dayMonthAr(section.observedAt)}` : 'مُتحقق',
      };
    case 'EXPIRING':
      return { state: 'VERIFIED', text: 'مُتحقق · ينتهي قريباً' };
    case 'EXPIRED':
      return { state: 'EXPIRED', text: 'منتهي' };
    case 'CHANGED':
      return { state: 'CHANGED', text: 'تغيّر مرصود' };
    case 'CONFLICT':
      return { state: 'CONFLICT', text: section.issueAr ?? 'تعارض' };
    case 'PARTIAL':
      return { state: 'PENDING', text: `مُتحقق جزئياً · ${section.issueAr ?? ''}` };
    case 'NOT_FOUND':
      return { state: 'NOT_VERIFIED', text: 'لا توجد بيانات' };
    case 'FAILED':
      return { state: 'NOT_VERIFIED', text: 'تعذّر التحقق' };
    case 'NOT_APPLICABLE':
      return { state: 'NOT_APPLICABLE', text: 'غير متاح لهذا النوع' };
    default:
      return { state: 'NOT_VERIFIED', text: 'لم يُتحقق' };
  }
}

function verifyLook(section: FileSection): {
  variant: 'primary' | 'secondary';
  icon: IconName | undefined;
  label: string;
} {
  switch (section.state) {
    case 'CONFLICT':
      return { variant: 'primary', icon: 'badge-check', label: 'تحقق' };
    case 'NOT_VERIFIED':
    case 'PARTIAL':
      return { variant: 'secondary', icon: undefined, label: 'تحقق' };
    case 'FAILED':
      return { variant: 'secondary', icon: 'refresh-cw', label: 'إعادة المحاولة' };
    default:
      return { variant: 'secondary', icon: 'refresh-cw', label: 'إعادة التحقق' };
  }
}

function HiddenFields({
  file,
  bundle,
  checks,
  person,
}: {
  file: CustomerFile;
  bundle: string;
  checks: readonly string[];
  person?: string | undefined;
}): ReactElement {
  return (
    <>
      <input type="hidden" name="entity_id" value={file.entityId} />
      <input
        type="hidden"
        name="kind"
        value={file.entityType === 'FREELANCER' ? 'FREELANCER' : 'BUSINESS'}
      />
      <input type="hidden" name="customer_kind" value={customerKindOf(file)} />
      <input type="hidden" name="bundle" value={bundle} />
      {checks.map((code) => (
        <input key={code} type="hidden" name="checks" value={code} />
      ))}
      {person === undefined ? null : <input type="hidden" name="person" value={person} />}
    </>
  );
}

/** The id of a banking section's verify form, which the IBAN field in its body belongs to. */
function bankFormId(file: CustomerFile): string {
  return `verify-banking-${file.entityId}`;
}

function SectionVerify({
  section,
  context,
}: {
  section: FileSection;
  context: SectionContext;
}): ReactElement | null {
  const { file } = context;
  const runnable = section.checks.filter((check) => check.availability === 'AVAILABLE');
  if (section.state === 'NOT_APPLICABLE' || runnable.length === 0) {
    return null;
  }
  // The powers of managers can only be checked once the registry has named them.
  if (section.section === 'MANAGERS' && file.managers.length === 0) {
    return null;
  }
  const refusal =
    runnable.map((check) => context.refusals[check.productCode] ?? null).find(Boolean) ?? null;
  const banking = section.section === 'BANKING';
  const look = verifyLook(section);
  const running = runnable.some((check) => context.running.has(check.productCode));

  return (
    <form
      action={context.action}
      className="file-section-form"
      data-role="section-form"
      id={banking ? bankFormId(file) : undefined}
    >
      <HiddenFields
        file={file}
        bundle={context.bundle}
        checks={runnable.map((check) => check.productCode)}
      />
      <SubmitButton
        variant={look.variant}
        icon={look.icon}
        disabled={refusal !== null || running}
        title={refusal ?? undefined}
        data-role="check-section"
      >
        {look.label}
      </SubmitButton>
    </form>
  );
}

function Meta({ section }: { section: FileSection }): ReactElement | null {
  if (section.sourceAr === null) {
    return null;
  }
  const parts: ReactNode[] = [section.sourceAr];
  if (section.authority) {
    parts.push(section.authority);
  }
  if (section.observedAt && section.state !== 'VERIFIED') {
    parts.push(`آخر تحقق ${dateAr(section.observedAt)}`);
  }
  return <p className="file-section-source">{parts.join(' · ')}</p>;
}

function FieldCell({
  field,
  section,
  history,
  alert,
  valueOverride,
}: {
  field: FileField;
  section: FileSection;
  history: FieldHistoryView[] | undefined;
  alert?: boolean;
  valueOverride?: ReactNode;
}): ReactElement {
  // A list takes the whole row: two long activity names side by side do not fit one column.
  const wide = Array.isArray(field.value);
  const ownMeta = section.authority === null || field.authority !== section.authority;
  return (
    <div
      className={wide ? 'file-field file-field-wide' : 'file-field'}
      data-field={field.fieldPath}
      data-freshness={field.freshness}
      data-changed={field.changed ? 'yes' : 'no'}
    >
      <dt>{field.labelAr}</dt>
      <dd className={alert ? 'file-field-alert' : undefined}>
        <span className="fact-value">{valueOverride ?? renderValue(field)}</span>
        {ownMeta || field.freshness === 'expired' || field.changed ? (
          <span className="file-field-meta">
            {ownMeta ? (
              <>
                <span data-role="authority">{field.authority ?? 'بلا جهة'}</span> ·{' '}
                <Ltr>
                  <span data-role="observed-at">{isoDate(field.observedAt)}</span>
                </Ltr>
              </>
            ) : null}
            {field.freshness === 'expired' ? ' · منتهية الصلاحية' : ''}
            {field.changed ? ' · تغيّر' : ''}
          </span>
        ) : (
          <span className="visually-hidden">
            <span data-role="authority">{field.authority ?? 'بلا جهة'}</span>{' '}
            <span data-role="observed-at">{isoDate(field.observedAt)}</span>
          </span>
        )}
        {history && history.length > 0 ? (
          <details className="file-details" data-role="field-history">
            <summary>القيم السابقة ({history.length})</summary>
            <ul>
              {history.map((entry, index) => (
                <li
                  key={`${entry.observedAt.toISOString()}-${index}`}
                  data-changed={entry.changed ? 'yes' : 'no'}
                >
                  <Ltr>{isoDate(entry.observedAt)}</Ltr>{' '}
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

function FieldsGrid({
  section,
  fields,
  context,
  children,
}: {
  section: FileSection;
  fields: readonly FileField[];
  context: SectionContext;
  children?: ReactNode;
}): ReactElement | null {
  if (fields.length === 0 && children === undefined) {
    return null;
  }
  return (
    <dl className="file-fields">
      {children}
      {fields.map((field) => (
        <FieldCell
          key={field.fieldPath}
          field={field}
          section={section}
          history={context.histories[field.fieldPath]}
        />
      ))}
    </dl>
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

function ManagersTable({
  managers,
  context,
}: {
  managers: ManagerView[];
  context: SectionContext;
}): ReactElement {
  const { file } = context;
  const canCheck =
    file.checks.find((check) => check.productCode === 'MANAGER_AUTHORITY')?.availability ===
      'AVAILABLE' &&
    (context.refusals['MANAGER_AUTHORITY'] ?? null) === null &&
    !context.running.has('MANAGER_AUTHORITY');

  return (
    <Table label="المدراء المفوضون">
      <thead>
        <tr>
          <Th>الاسم</Th>
          <Th>الهوية</Th>
          <Th>الصلاحية</Th>
          <Th>نطاق التوقيع</Th>
          <Th>حالة KYC</Th>
        </tr>
      </thead>
      <tbody>
        {managers.map((manager) => {
          const methods = [
            ...new Set(
              (manager.permissions ?? [])
                .map((permission) => permission.method)
                .filter((method): method is string => method !== null),
            ),
          ];
          return (
            <tr key={manager.entityId} data-role="manager">
              <td>
                {manager.name ?? 'مدير بلا اسم'}
                {manager.alsoManages.length > 0 ? (
                  <span className="file-cell-note" data-role="also-manages">
                    يدير أيضاً: <LinkList entities={manager.alsoManages} />
                  </span>
                ) : null}
                {manager.isCustomer ? (
                  <span className="file-cell-note">
                    <a href={`/customers/${manager.entityId}`}>عميل لديك كعامل حر</a>
                  </span>
                ) : null}
              </td>
              <td>{manager.maskedId ? <Ltr>{shortMask(manager.maskedId)}</Ltr> : '·'}</td>
              <td>{manager.positions.join('، ') || '·'}</td>
              <td>
                {methods.join('، ') || '·'}
                {manager.permissions && manager.permissions.length > 0 ? (
                  <details className="file-details" data-role="permissions">
                    <summary>{permissionsCountAr(manager.permissions.length)}</summary>
                    <ul>
                      {manager.permissions.map((permission, index) => (
                        <li key={`${permission.name ?? ''}-${index}`}>
                          {permission.name}
                          {permission.method ? ` · ${permission.method}` : ''}
                          {permission.canIssuePoa ? ' · يصدر توكيلاً' : ''}
                          {permission.canDelegate ? ' · يفوّض' : ''}
                          {permission.condition ? ` · ${permission.condition}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </td>
              <td>
                <span className="file-cell-status">
                  {manager.permissions === null ? (
                    <>
                      <StateTag state="PENDING">بانتظار التحقق</StateTag>
                      {canCheck && manager.maskedId !== null ? (
                        <form action={context.action}>
                          <HiddenFields
                            file={file}
                            bundle={context.managerBundles[manager.entityId] ?? context.bundle}
                            checks={['MANAGER_AUTHORITY']}
                            person={manager.entityId}
                          />
                          <Button type="submit" variant="ghost" data-role="check-manager">
                            تحقق
                          </Button>
                        </form>
                      ) : null}
                    </>
                  ) : (
                    <StateTag state="VERIFIED">مُتحقق</StateTag>
                  )}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function PartnersTable({ partners }: { partners: PartnerView[] }): ReactElement {
  return (
    <Table label="الشركاء">
      <thead>
        <tr>
          <Th>الشريك</Th>
          <Th>الهوية</Th>
          <Th>نسبة الملكية</Th>
          <Th>الحالة</Th>
        </tr>
      </thead>
      <tbody>
        {partners.map((partner) => (
          <tr key={partner.entityId} data-role="partner">
            <td>
              {partner.name ?? 'بلا اسم'}
              {partner.alsoOwns.length > 0 ? (
                <span className="file-cell-note">
                  شريك أيضاً في: <LinkList entities={partner.alsoOwns} />
                </span>
              ) : null}
            </td>
            <td>
              {partner.maskedId ? (
                <>
                  {partner.kind === 'BUSINESS' ? 'س.ت ' : ''}
                  <Ltr>{shortMask(partner.maskedId)}</Ltr>
                </>
              ) : (
                '·'
              )}
            </td>
            <td>
              {partner.profitPct !== null ? (
                <Ltr>{partner.profitPct}%</Ltr>
              ) : partner.shares !== null ? (
                <>
                  <Ltr>{partner.shares}</Ltr> حصة
                </>
              ) : (
                '·'
              )}
            </td>
            <td>
              {partner.kind === 'PERSON' ? (
                <StateTag state="VERIFIED">مُتحقق</StateTag>
              ) : partner.hasOwnFile ? (
                <a href={`/customers/${partner.entityId}`}>
                  <StateTag state="VERIFIED">مُتحقق</StateTag>
                </a>
              ) : (
                <StateTag state="CONFLICT">كيان مالك · يحتاج KYB منفصل</StateTag>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function BankFields({
  section,
  context,
}: {
  section: FileSection;
  context: SectionContext;
}): ReactElement | null {
  const { file } = context;
  const account = file.accounts[0];
  const fields = orderedFields(
    'BANKING',
    section.fields.filter((field) => !MATCH_SCORE_FIELDS.has(field.fieldPath)),
  );
  const score = section.fields.find((field) => MATCH_SCORE_FIELDS.has(field.fieldPath));
  const raw = typeof score?.value === 'number' ? score.value : null;
  const pct = raw === null ? null : Math.round(raw <= 1 ? raw * 100 : raw);

  if (account === undefined && fields.length === 0) {
    return null;
  }
  return (
    <>
      <dl className="file-fields">
        {account?.maskedIban ? (
          <div className="file-field" data-field="iban">
            <dt>الآيبان</dt>
            <dd>
              <Ltr>{shortMask(account.maskedIban)}</Ltr>
            </dd>
          </div>
        ) : null}
        {fields.map((field) => (
          <FieldCell
            key={field.fieldPath}
            field={field}
            section={section}
            history={context.histories[field.fieldPath]}
          />
        ))}
        {score !== undefined && pct !== null ? (
          <FieldCell
            field={{ ...score, labelAr: 'مطابقة الاسم' }}
            section={section}
            history={undefined}
            alert={pct < NAME_MATCH_THRESHOLD_PCT}
            valueOverride={
              <>
                {pct >= NAME_MATCH_THRESHOLD_PCT ? 'مطابق ' : 'تطابق جزئي '}
                <Ltr>{pct}%</Ltr>
              </>
            }
          />
        ) : null}
      </dl>
      {file.accounts.length > 1 ? (
        <ul className="file-accounts" data-role="accounts">
          {file.accounts.slice(1).map((other) => (
            <li key={other.entityId}>
              <Ltr>{shortMask(other.maskedIban) ?? 'آيبان'}</Ltr>
              {other.bank ? ` · ${other.bank}` : ''}
              {other.sharedWith.length > 0 ? ' · مقدَّم أيضاً لعميل آخر' : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function IbanField({ file }: { file: CustomerFile }): ReactElement {
  const needsIban = file.accounts.length === 0;
  const id = `${bankFormId(file)}-iban`;
  return (
    <div className="file-iban-field">
      <Field
        id={id}
        label={needsIban ? 'رقم الآيبان' : 'التحقق من آيبان آخر'}
        hint={needsIban ? 'يبدأ بـ SA ويتبعه 22 رقماً' : undefined}
      >
        {(control) => (
          <Input
            {...control}
            form={bankFormId(file)}
            name="iban"
            ltr
            placeholder="SA…"
            required={needsIban}
          />
        )}
      </Field>
    </div>
  );
}

function emptyText(section: FileSection, file: CustomerFile): string {
  if (section.state === 'NOT_APPLICABLE') {
    return 'لا يتوفر تحقق من العنوان الوطني للأفراد حالياً.';
  }
  if (section.section === 'MANAGERS') {
    return 'يظهر المدراء بعد التحقق من السجل التجاري، ثم يُتحقق من صلاحيات كل منهم.';
  }
  if (section.state === 'NOT_FOUND') {
    return 'سألنا الجهة الرسمية ولم تجد بيانات لهذا العميل.';
  }
  if (section.state === 'FAILED') {
    return 'تعذّر الوصول إلى الجهة في آخر محاولة، ولم تُحتسب العملية.';
  }
  if (section.section === 'BANKING' && file.accounts.length === 0) {
    return 'أدخل رقم الآيبان ثم اضغط تحقق، ليُعرف البنك وصاحب الحساب ومطابقة الاسم.';
  }
  return 'لم يُتحقق من هذا القسم بعد.';
}

export function SectionCard({
  section,
  context,
}: {
  section: FileSection;
  context: SectionContext;
}): ReactElement {
  const { file } = context;
  const running = section.checks.some((check) => context.running.has(check.productCode));
  // A section being checked says so, whatever it said before (README, screen 02 and 03).
  const tag = running
    ? { state: 'PROCESSING' as const, text: 'قيد المعالجة' }
    : stateTagOf(section);
  const shared = file.intersections.find((link) => link.kind === 'SHARED_ADDRESS');
  const titleId = `section-${section.section}-title`;

  let body: ReactNode = null;
  if (section.section === 'MANAGERS') {
    body =
      file.managers.length > 0 ? (
        <ManagersTable managers={file.managers} context={context} />
      ) : null;
  } else if (section.section === 'BANKING') {
    body = <BankFields section={section} context={context} />;
  } else {
    body = (
      <>
        <FieldsGrid
          section={section}
          fields={orderedFields(section.section, section.fields)}
          context={context}
        />
        {section.section === 'CONTRACT' && file.partners.length > 0 ? (
          <PartnersTable partners={file.partners} />
        ) : null}
        {section.section === 'ADDRESS' && shared !== undefined && section.fields.length > 0 ? (
          <p className="file-note" data-role="address-note">
            العنوان مطابق لعنوان <LinkList entities={shared.entities} /> ·{' '}
            <a href="#intersections">انظر التقاطعات</a>
          </p>
        ) : null}
      </>
    );
  }
  const empty =
    section.state === 'NOT_APPLICABLE' ||
    (section.section === 'MANAGERS'
      ? file.managers.length === 0
      : section.section === 'BANKING'
        ? file.accounts.length === 0 && section.fields.length === 0
        : section.fields.length === 0);

  return (
    <Card as="section" labelledBy={titleId} role="file-section">
      <div
        className="file-section"
        data-section={section.section}
        data-state={section.state}
        data-requirement={section.requirement}
        data-running={running ? 'yes' : undefined}
      >
        <div className="file-section-head">
          <span
            className="file-section-number"
            data-done={section.done ? 'yes' : 'no'}
            aria-hidden="true"
          >
            <Ltr>{section.number}</Ltr>
          </span>
          <div className="file-section-title">
            <CardTitle as="h2" id={titleId}>
              {section.titleAr}
              {section.requirement === 'OPTIONAL' ? (
                <span className="file-optional"> · اختياري</span>
              ) : null}
            </CardTitle>
            <Meta section={section} />
          </div>
          <div className="file-section-actions">
            <StateTag state={tag.state} role="section-state">
              {tag.text}
            </StateTag>
            <SectionVerify section={section} context={context} />
          </div>
        </div>
        {empty ? (
          <p className="file-empty" data-role="section-empty">
            {emptyText(section, file)}
          </p>
        ) : (
          body
        )}
        {section.section === 'BANKING' &&
        section.checks.some((check) => check.availability === 'AVAILABLE') ? (
          <IbanField file={file} />
        ) : null}
      </div>
    </Card>
  );
}
