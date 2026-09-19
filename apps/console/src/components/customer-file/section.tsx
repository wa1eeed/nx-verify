import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  PART_LABELS,
  type AccountView,
  type CustomerFile,
  type FieldPart,
  type FileField,
  type FileSection,
  type IdentifierView,
  type LiquidatorView,
  type ManagerView,
  type PartnerView,
  type RegistryLinkView,
  type SectionIdentifier,
} from '@nx-verify/core';
import type { FieldHistoryView } from '../field-card';
import { count, dateAr, dayMonthAr, isoDate, shortMask } from '../format';
import { Field } from '../ui/field';
import { Card, CardTitle } from '../ui/card';
import type { IconName } from '../ui/icon';
import { Input } from '../ui/input';
import { Ltr } from '../ui/ltr';
import { SubmitButton } from '../ui/submit-button';
import { StateTag, Tag, TagLink, type TagState } from '../ui/tag';
import { Table, Th } from '../ui/table';
import { FieldHistory } from './field-history';
import { historyStretches } from './field-history-model';
import { SectionLive, SectionVerifyForm, type SectionCheckAction } from './section-live';
import { MATCH_SCORE_FIELDS, isWide, permissionsCountAr, renderValue } from './values';

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
  /** A section's own verify, which stays on the page; without it the form leaves as before. */
  sectionAction?: SectionCheckAction | undefined;
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

  const fields = (
    <>
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
    </>
  );
  const id = banking ? bankFormId(file) : undefined;

  return context.sectionAction === undefined ? (
    <form action={context.action} className="file-section-form" data-role="section-form" id={id}>
      {fields}
    </form>
  ) : (
    <SectionVerifyForm action={context.sectionAction} id={id}>
      {fields}
    </SectionVerifyForm>
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

/** The same value, compared as the attestation store compares it. */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A past value in words: as the page worded it, or as plain text when it did not. */
function wordsOf(entry: FieldHistoryView): string {
  if (entry.valueAr !== undefined) {
    return entry.valueAr;
  }
  return typeof entry.value === 'string' || typeof entry.value === 'number'
    ? String(entry.value)
    : JSON.stringify(entry.value);
}

function FieldCell({
  field,
  section,
  entityId,
  history,
  alert,
  valueOverride,
}: {
  field: FileField;
  section: FileSection;
  /** Whose file this is, so a field can open its own page of the ledger. */
  entityId: string;
  history: FieldHistoryView[] | undefined;
  alert?: boolean;
  valueOverride?: ReactNode;
}): ReactElement {
  // A list, a table or a long text takes the whole row: two long activity names side by side
  // do not fit one column.
  const wide = isWide(field);
  // The value this one replaced, when the last verification changed it.
  const latest = history?.[0];
  const previous =
    latest !== undefined && !sameValue(latest.value, field.value) ? latest : undefined;
  const ownMeta = section.authority === null || field.authority !== section.authority;
  return (
    <div
      className={wide ? 'file-field file-field-wide' : 'file-field'}
      data-field={field.fieldPath}
      data-freshness={field.freshness}
      data-changed={field.changed ? 'yes' : 'no'}
      data-observed={String(field.observedAt.getTime())}
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
        {previous !== undefined ? (
          <span className="file-field-was" data-role="previous-value">
            كانت <s>{wordsOf(previous)}</s> حتى <Ltr>{isoDate(field.observedAt)}</Ltr>
          </span>
        ) : null}
        {history && history.length > 0 ? (
          // One line for both, wrapping on a narrow screen rather than stacking a chip under
          // a chip in every field of the grid.
          <span className="row" style={{ gap: 'var(--s-2)' }}>
            <FieldHistory
              label={field.labelAr}
              current={renderValue(field)}
              stretches={historyStretches(
                {
                  value: field.value,
                  valueAr: '',
                  observedAt: isoDate(field.observedAt),
                  authority: field.authority,
                },
                history.map((entry) => ({
                  value: entry.value,
                  valueAr: wordsOf(entry),
                  observedAt: isoDate(entry.observedAt),
                  authority: entry.authority,
                })),
              )}
            />
            {/*
              The story above collapses repeats into stretches, which is what a reader
              wants first. The ledger behind it keeps every line with the verification that
              wrote it and what set that off, which is what an auditor asks for next.
            */}
            <TagLink
              href={`/customers/${entityId}/attestations?field=${encodeURIComponent(field.fieldPath)}`}
              role="field-ledger"
            >
              سجل الإفادات
            </TagLink>
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/** The order parts come in, the catalogue's. */
const PART_ORDER = Object.keys(PART_LABELS) as FieldPart[];

/** A number a section is about, in full, as the first line of its part (ADR-127, ADR-128). */
function IdentifierCell({ identifier }: { identifier: SectionIdentifier }): ReactElement {
  return (
    <div className="file-field" data-identifier={identifier.idType} data-role="section-identifier">
      <dt>{identifier.labelAr}</dt>
      <dd>
        <span className="fact-value">
          <Ltr>{identifier.display}</Ltr>
        </span>
      </dd>
    </div>
  );
}

/**
 * A section's facts, split into its parts under small headings when it has more than one.
 *
 * The numbers the section is about lead its first part; a table that belongs to a part (the
 * partners, the liquidators, the managers) follows that part's facts; and a part with neither
 * facts nor a table is not drawn at all.
 */
function SectionParts({
  section,
  context,
  fields = section.fields,
  identityPart,
  extras = {},
}: {
  section: FileSection;
  context: SectionContext;
  fields?: readonly FileField[];
  /** The part the section's identifiers lead. */
  identityPart?: FieldPart | undefined;
  extras?: Partial<Record<FieldPart, ReactNode>>;
}): ReactElement | null {
  const identifiers = section.identifiers ?? [];
  const byPart = new Map<FieldPart | 'general', FileField[]>();
  for (const field of fields) {
    const key = field.part ?? 'general';
    byPart.set(key, [...(byPart.get(key) ?? []), field]);
  }
  const lead: FieldPart | 'general' = identityPart ?? fields[0]?.part ?? 'general';
  // The parts in the order their facts come; the section's identifiers lead theirs.
  const order: (FieldPart | 'general')[] = [];
  if (identifiers.length > 0) {
    order.push(lead);
  }
  for (const key of byPart.keys()) {
    if (!order.includes(key)) {
      order.push(key);
    }
  }
  // A part drawn only for its table comes after the nearest part the catalogue puts before it.
  for (const key of PART_ORDER) {
    if (extras[key] === undefined || extras[key] === null || order.includes(key)) {
      continue;
    }
    const before = PART_ORDER.slice(0, PART_ORDER.indexOf(key))
      .reverse()
      .find((candidate) => order.includes(candidate));
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, key);
  }
  if (order.length === 0) {
    return null;
  }
  const titled = order.length > 1;

  return (
    <div className="file-parts">
      {order.map((key) => {
        const partFields = byPart.get(key) ?? [];
        const named = key === lead ? identifiers : [];
        const extra = key === 'general' ? null : (extras[key] ?? null);
        return (
          <div className="file-part" key={key} data-part={key}>
            {titled && key !== 'general' ? (
              <h3 className="file-part-title">{PART_LABELS[key]}</h3>
            ) : null}
            {named.length > 0 || partFields.length > 0 ? (
              <dl className="file-fields">
                {named.map((identifier) => (
                  <IdentifierCell key={identifier.idType} identifier={identifier} />
                ))}
                {partFields.map((field) => (
                  <FieldCell
                    key={field.fieldPath}
                    field={field}
                    section={section}
                    entityId={context.file.entityId}
                    history={context.histories[field.fieldPath]}
                  />
                ))}
              </dl>
            ) : null}
            {extra}
          </div>
        );
      })}
    </div>
  );
}

/** Somebody's number, with the words for its kind, in full. */
function IdentifierText({ identifier }: { identifier: IdentifierView | null }): ReactElement {
  if (identifier === null) {
    return <>·</>;
  }
  return (
    <span className="file-identifier" data-role="identifier" data-id-type={identifier.idType}>
      <span className="file-identifier-label">{identifier.labelAr}</span>{' '}
      <Ltr>{shortMask(identifier.display)}</Ltr>
    </span>
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
          <Link href={`/customers/${entity.entityId}`}>{entity.name ?? 'بلا اسم'}</Link>
        </span>
      ))}
    </>
  );
}

/** One manager's own verify, which stays on the page like a section's does. */
function ManagerVerify({
  manager,
  context,
}: {
  manager: ManagerView;
  context: SectionContext;
}): ReactElement {
  const fields = (
    <>
      <HiddenFields
        file={context.file}
        bundle={context.managerBundles[manager.entityId] ?? context.bundle}
        checks={['MANAGER_AUTHORITY']}
        person={manager.entityId}
      />
      <SubmitButton variant="ghost" data-role="check-manager">
        تحقق
      </SubmitButton>
    </>
  );
  return context.sectionAction === undefined ? (
    <form action={context.action}>{fields}</form>
  ) : (
    <SectionVerifyForm action={context.sectionAction}>{fields}</SectionVerifyForm>
  );
}

function yesNo(value: boolean | null): string {
  return value === null ? '·' : value ? 'نعم' : 'لا';
}

/** A person's details under their name: nationality and the kind of party the registry says. */
function PersonNote({ parts }: { parts: (string | null)[] }): ReactElement | null {
  const words = parts.filter((part): part is string => part !== null && part !== '');
  return words.length === 0 ? null : (
    <span className="file-cell-note" data-role="person-note">
      {words.join(' · ')}
    </span>
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
    <div className="file-people">
      <Table label="المدراء المفوضون">
        <thead>
          <tr>
            <Th>الاسم</Th>
            <Th>الهوية</Th>
            <Th>المنصب</Th>
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
                  <Link href={`/customers/${manager.entityId}`}>
                    {manager.name ?? 'مدير بلا اسم'}
                  </Link>
                  <PersonNote parts={[manager.nationality, manager.managerType]} />
                  {manager.alsoManages.length > 0 ? (
                    <span className="file-cell-note" data-role="also-manages">
                      يدير أيضاً: <LinkList entities={manager.alsoManages} />
                    </span>
                  ) : null}
                  {manager.isCustomer ? (
                    <span className="file-cell-note">
                      <Link href={`/customers/${manager.entityId}`}>عميل لديك كعامل حر</Link>
                    </span>
                  ) : null}
                </td>
                <td>
                  <IdentifierText identifier={manager.identifier} />
                </td>
                <td>
                  {manager.positions.join('، ') || '·'}
                  {manager.licensed !== null ? (
                    <span className="file-cell-note" data-role="licensed">
                      <Tag tone="outline">{manager.licensed ? 'مدير مرخّص' : 'غير مرخّص'}</Tag>
                    </span>
                  ) : null}
                </td>
                <td>
                  {methods.join('، ') || '·'}
                  {manager.permissions && manager.permissions.length > 0 ? (
                    <details className="file-details" data-role="permissions">
                      <summary>{permissionsCountAr(manager.permissions.length)}</summary>
                      <ul>
                        {manager.permissions.map((permission, index) => (
                          <li key={`${permission.name ?? ''}-${index}`} data-role="permission">
                            <strong>{permission.name}</strong>
                            {permission.method ? ` · ${permission.method}` : ''}
                            {permission.canIssuePoa !== null
                              ? ` · يصدر توكيلاً: ${yesNo(permission.canIssuePoa)}`
                              : ''}
                            {permission.canDelegate !== null
                              ? ` · يفوّض غيره: ${yesNo(permission.canDelegate)}`
                              : ''}
                            {permission.condition ? ` · الشرط: ${permission.condition}` : ''}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </td>
                <td>
                  <span className="file-cell-status">
                    {manager.permissions !== null ? (
                      <StateTag state="VERIFIED">مُتحقق</StateTag>
                    ) : manager.checkable ? (
                      <>
                        <StateTag state="PENDING">بانتظار التحقق</StateTag>
                        {canCheck ? <ManagerVerify manager={manager} context={context} /> : null}
                      </>
                    ) : (
                      <StateTag state="NOT_APPLICABLE">لا يتوفر تحقق لهذه الهوية</StateTag>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

function sharesAr(n: number): string {
  return n === 1
    ? 'حصة واحدة'
    : n === 2
      ? 'حصتان'
      : n >= 3 && n <= 10
        ? `${n} حصص`
        : `${count(n)} حصة`;
}

function PartnersTable({ partners }: { partners: PartnerView[] }): ReactElement {
  return (
    <div className="file-people">
      <Table label="الشركاء">
        <thead>
          <tr>
            <Th>الشريك</Th>
            <Th>الهوية</Th>
            <Th>الحصص</Th>
            <Th>الأرباح والخسائر</Th>
            <Th>الحالة</Th>
          </tr>
        </thead>
        <tbody>
          {partners.map((partner) => (
            <tr key={partner.entityId} data-role="partner">
              <td>
                <Link href={`/customers/${partner.entityId}`}>{partner.name ?? 'بلا اسم'}</Link>
                <PersonNote parts={[partner.partyType, partner.nationality]} />
                {partner.roles.length > 0 ? (
                  <span className="file-cell-note" data-role="partner-roles">
                    الصفة: {partner.roles.join('، ')}
                  </span>
                ) : null}
                {partner.guardian !== null ? (
                  <span className="file-cell-note" data-role="guardian">
                    الولي: {partner.guardian.name ?? 'بلا اسم'}
                    {partner.guardian.isFather ? ' (الأب)' : ''}
                    {partner.guardian.identifier !== null ? (
                      <>
                        {' · '}
                        <IdentifierText identifier={partner.guardian.identifier} />
                      </>
                    ) : null}
                  </span>
                ) : null}
                {partner.alsoOwns.length > 0 ? (
                  <span className="file-cell-note">
                    شريك أيضاً في: <LinkList entities={partner.alsoOwns} />
                  </span>
                ) : null}
              </td>
              <td>
                <IdentifierText identifier={partner.identifier} />
                {partner.licenseNumber !== null ? (
                  <span className="file-cell-note">
                    رقم الترخيص <Ltr>{partner.licenseNumber}</Ltr>
                  </span>
                ) : null}
              </td>
              <td data-role="partner-shares">
                {partner.shares !== null ? sharesAr(partner.shares) : '·'}
                {partner.cashShares !== null || partner.inKindShares !== null ? (
                  <span className="file-cell-note">
                    {partner.cashShares !== null ? (
                      <>
                        نقدية <Ltr>{count(partner.cashShares)}</Ltr>
                      </>
                    ) : null}
                    {partner.cashShares !== null && partner.inKindShares !== null ? ' · ' : null}
                    {partner.inKindShares !== null ? (
                      <>
                        عينية <Ltr>{count(partner.inKindShares)}</Ltr>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </td>
              <td data-role="partner-distribution">
                {partner.profitPct === null && partner.lossPct === null ? (
                  '·'
                ) : (
                  <>
                    {partner.profitPct !== null ? (
                      <span className="file-cell-line">
                        الأرباح <Ltr>{`${partner.profitPct}%`}</Ltr>
                      </span>
                    ) : null}
                    {partner.lossPct !== null ? (
                      <span className="file-cell-line">
                        الخسائر <Ltr>{`${partner.lossPct}%`}</Ltr>
                      </span>
                    ) : null}
                  </>
                )}
              </td>
              <td>
                {partner.kind === 'PERSON' ? (
                  <StateTag state="VERIFIED">مُتحقق</StateTag>
                ) : partner.hasOwnFile ? (
                  <Link href={`/customers/${partner.entityId}`}>
                    <StateTag state="VERIFIED">مُتحقق</StateTag>
                  </Link>
                ) : (
                  <StateTag state="CONFLICT">كيان مالك · يحتاج KYB منفصل</StateTag>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function LiquidatorsTable({ liquidators }: { liquidators: LiquidatorView[] }): ReactElement {
  return (
    <div className="file-people">
      <Table label="المصفّون">
        <thead>
          <tr>
            <Th>المصفّي</Th>
            <Th>الهوية</Th>
            <Th>الصفة</Th>
            <Th>المنصب</Th>
          </tr>
        </thead>
        <tbody>
          {liquidators.map((liquidator) => (
            <tr key={liquidator.entityId} data-role="liquidator">
              <td>
                <Link href={`/customers/${liquidator.entityId}`}>
                  {liquidator.name ?? 'بلا اسم'}
                </Link>
                <PersonNote parts={[liquidator.nationality]} />
              </td>
              <td>
                <IdentifierText identifier={liquidator.identifier} />
              </td>
              <td>{liquidator.liquidatorType ?? '·'}</td>
              <td>{liquidator.positions.join('، ') || '·'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** The main registration a branch belongs to, and the branches registered under a business. */
function RegistryLinks({
  mainRegistry,
  branches,
}: {
  mainRegistry: RegistryLinkView | null;
  branches: RegistryLinkView[];
}): ReactElement | null {
  if (mainRegistry === null && branches.length === 0) {
    return null;
  }
  const entry = (link: RegistryLinkView): ReactElement => (
    <>
      {link.hasOwnFile ? (
        <Link href={`/customers/${link.entityId}`}>{link.name ?? 'منشأة'}</Link>
      ) : (
        (link.name ?? 'منشأة لم يُتحقق منها بعد')
      )}
      {link.identifier !== null ? (
        <>
          {' · '}
          <IdentifierText identifier={link.identifier} />
        </>
      ) : null}
    </>
  );
  return (
    <dl className="file-fields file-registry-links">
      {mainRegistry !== null ? (
        <div className="file-field file-field-wide" data-role="main-registry">
          <dt>السجل الرئيسي لهذا الفرع</dt>
          <dd>{entry(mainRegistry)}</dd>
        </div>
      ) : null}
      {branches.length > 0 ? (
        <div className="file-field file-field-wide" data-role="branches">
          <dt>الفروع المسجلة</dt>
          <dd>
            <ul className="file-list">
              {branches.map((branch) => (
                <li key={branch.entityId}>{entry(branch)}</li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** «مطابق 92%» or «تطابق جزئي 70%», from a score of 0 to 1 or a percentage. */
function matchWords(
  score: number | null,
  threshold: number,
): { pct: number; words: string } | null {
  if (score === null) {
    return null;
  }
  const pct = Math.round(score <= 1 ? score * 100 : score);
  return { pct, words: pct >= threshold ? 'مطابق' : 'تطابق جزئي' };
}

const ACCOUNT_STATUS_WORDS: Readonly<Record<string, string>> = {
  ACTIVE: 'نشط',
  BLOCKED: 'محظور',
  INACTIVE: 'غير نشط',
  CLOSED: 'مغلق',
  DORMANT: 'راكد',
  IN_LIQUIDATION: 'تحت التصفية',
};

const OWNERSHIP_WORDS: Readonly<Record<string, string>> = {
  MATCH: 'مطابق',
  PARTIAL: 'تطابق جزئي',
  NO_MATCH: 'غير مطابق',
};

/** The other accounts presented for this customer, each with what its own check said. */
function OtherAccounts({
  accounts,
  threshold,
}: {
  accounts: AccountView[];
  threshold: number;
}): ReactElement {
  return (
    <div className="file-other-accounts" data-role="accounts">
      <h3 className="file-part-title">حسابات أخرى مقدَّمة</h3>
      <Table label="حسابات أخرى مقدَّمة">
        <thead>
          <tr>
            <Th>الآيبان</Th>
            <Th>البنك</Th>
            <Th>حالة الحساب</Th>
            <Th>صاحب الحساب</Th>
            <Th>المطابقة</Th>
            <Th>آخر تحقق</Th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const match = matchWords(account.matchScore, threshold);
            return (
              <tr key={account.entityId} data-role="account">
                <td>
                  <Ltr>{account.iban ?? 'آيبان'}</Ltr>
                  {account.sharedWith.length > 0 ? (
                    <span className="file-cell-note">مقدَّم أيضاً لعميل آخر</span>
                  ) : null}
                </td>
                <td>
                  {account.bank ?? '·'}
                  {account.swiftCode !== null || account.bankCode !== null ? (
                    <span className="file-cell-note">
                      {account.swiftCode !== null ? <Ltr>{account.swiftCode}</Ltr> : null}
                      {account.swiftCode !== null && account.bankCode !== null ? ' · ' : null}
                      {account.bankCode !== null ? (
                        <>
                          رمز البنك <Ltr>{account.bankCode}</Ltr>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                </td>
                <td>
                  {account.status === null
                    ? '·'
                    : (ACCOUNT_STATUS_WORDS[account.status] ?? account.status)}
                </td>
                <td>{account.holderName === null ? '·' : <Ltr>{account.holderName}</Ltr>}</td>
                <td>
                  {account.ownership === null
                    ? '·'
                    : (OWNERSHIP_WORDS[account.ownership] ?? account.ownership)}
                  {match !== null ? (
                    <span className="file-cell-note">
                      مطابقة الاسم <Ltr>{`${match.pct}%`}</Ltr>
                    </span>
                  ) : null}
                </td>
                <td>
                  {account.checkedAt === null ? '·' : <Ltr>{isoDate(account.checkedAt)}</Ltr>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
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
  // The account checked last, which the bank facts of this section describe.
  const account = file.accounts[0];
  const fields = section.fields.filter((field) => !MATCH_SCORE_FIELDS.has(field.fieldPath));
  const score = section.fields.find((field) => MATCH_SCORE_FIELDS.has(field.fieldPath));
  const match = matchWords(
    typeof score?.value === 'number' ? score.value : null,
    file.nameMatchThresholdPct,
  );

  if (account === undefined && fields.length === 0) {
    return null;
  }
  return (
    <>
      <dl className="file-fields">
        {account?.iban ? (
          <div className="file-field" data-field="iban">
            <dt>الآيبان</dt>
            <dd>
              <Ltr>{account.iban}</Ltr>
            </dd>
          </div>
        ) : null}
        {fields.map((field) => (
          <FieldCell
            key={field.fieldPath}
            field={field}
            section={section}
            entityId={file.entityId}
            history={context.histories[field.fieldPath]}
          />
        ))}
        {score !== undefined && match !== null ? (
          <FieldCell
            field={{ ...score, labelAr: 'مطابقة الاسم' }}
            section={section}
            entityId={file.entityId}
            history={undefined}
            alert={match.pct < file.nameMatchThresholdPct}
            valueOverride={
              <>
                {`${match.words} `}
                <Ltr>{`${match.pct}%`}</Ltr>
              </>
            }
          />
        ) : null}
      </dl>
      {file.accounts.length > 1 ? (
        <OtherAccounts accounts={file.accounts.slice(1)} threshold={file.nameMatchThresholdPct} />
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

  const extras: Partial<Record<FieldPart, ReactNode>> = {};
  let body: ReactNode = null;
  if (section.section === 'BANKING') {
    body = <BankFields section={section} context={context} />;
  } else {
    if (section.section === 'MANAGERS' && file.managers.length > 0) {
      extras.managers = <ManagersTable managers={file.managers} context={context} />;
    }
    if (section.section === 'REGISTRY') {
      if (file.mainRegistry !== null || file.branches.length > 0) {
        extras.registration = (
          <RegistryLinks mainRegistry={file.mainRegistry} branches={file.branches} />
        );
      }
      if (file.liquidators.length > 0) {
        extras.liquidation = <LiquidatorsTable liquidators={file.liquidators} />;
      }
    }
    // The partners belong with the articles; a sole establishment has none, and its owner
    // reads with its registration instead.
    const partnersHere =
      section.section === 'CONTRACT' ||
      (section.section === 'REGISTRY' &&
        !file.sections.some((entry) => entry.section === 'CONTRACT'));
    if (partnersHere && file.partners.length > 0) {
      extras.partners = <PartnersTable partners={file.partners} />;
    }
    body = (
      <>
        <SectionParts
          section={section}
          context={context}
          identityPart={
            section.section === 'FREELANCE'
              ? 'certificate'
              : section.section === 'REGISTRY'
                ? file.entityType === 'BUSINESS'
                  ? 'registration'
                  : 'person'
                : undefined
          }
          extras={extras}
        />
        {section.section === 'ADDRESS' && shared !== undefined && section.fields.length > 0 ? (
          <p className="file-note" data-role="address-note">
            العنوان مطابق لعنوان <LinkList entities={shared.entities} /> ·{' '}
            <a href="#intersections">انظر التقاطعات</a>
          </p>
        ) : null}
      </>
    );
  }
  // Nothing verified in the section yet: said once, under whatever is already known of it (its
  // number, the partners the registry named).
  const unverified =
    section.section === 'BANKING'
      ? file.accounts.length === 0 && section.fields.length === 0
      : section.section === 'MANAGERS'
        ? file.managers.length === 0 && section.fields.length === 0
        : section.fields.length === 0;
  const known =
    section.section !== 'BANKING' &&
    ((section.identifiers ?? []).length > 0 || Object.keys(extras).length > 0);

  return (
    <Card as="section" labelledBy={titleId} role="file-section">
      <SectionLive
        titleAr={section.titleAr}
        running={running}
        attributes={{
          'data-section': section.section,
          'data-state': section.state,
          'data-requirement': section.requirement,
        }}
        head={
          // Keyed: an element handed over as a prop is drawn beside the body in a list.
          <div key="head" className="file-section-head">
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
        }
      >
        {section.state === 'NOT_APPLICABLE' ? (
          <p className="file-empty" data-role="section-empty">
            {emptyText(section, file)}
          </p>
        ) : (
          <>
            {unverified && !known ? null : body}
            {unverified ? (
              <p className="file-empty" data-role="section-empty">
                {emptyText(section, file)}
              </p>
            ) : null}
          </>
        )}
        {section.section === 'BANKING' &&
        section.checks.some((check) => check.availability === 'AVAILABLE') ? (
          <IbanField file={file} />
        ) : null}
      </SectionLive>
    </Card>
  );
}
