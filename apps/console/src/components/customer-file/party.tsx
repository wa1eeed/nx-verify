import Link from 'next/link';
import type { ReactElement } from 'react';
import {
  PARTY_ROLE_LABELS,
  type CustomerFile,
  type PartyCompany,
  type PartyRoleView,
  type PartyRoles,
} from '@nx-verify/core';
import type { FieldHistoryView } from '../field-card';
import { count, isoDate } from '../format';
import { Card, CardTitle } from '../ui/card';
import { Ltr } from '../ui/ltr';
import { SubmitButton } from '../ui/submit-button';
import { StateTag, Tag, type TagTone } from '../ui/tag';
import { Table, Th } from '../ui/table';
import { ExportFileButton, FileWatcher } from './actions';
import { IntersectionsCard, TimelineCard, type TimelineEntry } from './aside';
import { FileHeader } from './header';
import { SectionCard, type Action } from './section';
import { SectionLive, SectionVerifyForm, type SectionCheckAction } from './section-live';
import { permissionsCountAr } from './values';

/**
 * The file of a related party: a manager, a partner, a liquidator, a guardian (the owner's ask).
 *
 * Shaped for a person rather than for a company. Nobody verified this person in their own
 * right, so the file carries no KYB indicators and no sections of a company: their own
 * particulars as the registry gave them, with their number in full; every role they hold in
 * this subscriber's companies, with their positions, powers and shares there, and a way to
 * verify their powers in each company without leaving the file; what about those companies
 * deserves a look; the links to the subscriber's other customers; and the record of the
 * verifications that named them.
 */

export interface PartyFileView {
  file: CustomerFile;
  roles: PartyRoles;
  histories: Readonly<Record<string, FieldHistoryView[]>>;
  refusals: Readonly<Record<string, string | null>>;
  /** Per company, the checks queued or running on it. */
  running: Readonly<Record<string, readonly string[]>>;
  /** Per company, the key a manager check from this file is made under (rule 7). */
  bundles: Readonly<Record<string, string>>;
  timeline: TimelineEntry[];
  now: Date;
}

const STANDING: Readonly<
  Record<PartyCompany['standing'], { tone: TagTone; words: (company: PartyCompany) => string }>
> = {
  ACTIVE: { tone: 'accent-2', words: (company) => company.statusText ?? 'فعّال' },
  INACTIVE: { tone: 'accent', words: (company) => company.statusText ?? 'غير فعّال' },
  LIQUIDATION: { tone: 'accent', words: () => 'تحت التصفية' },
  UNKNOWN: { tone: 'neutral', words: () => 'لم يُتحقق من سجلها' },
};

function yesNo(value: boolean | null): string {
  return value === null ? '·' : value ? 'نعم' : 'لا';
}

/** What a role says in this company, in a line or two. */
function RoleDetails({ role }: { role: PartyRoleView }): ReactElement {
  const lines: ReactElement[] = [];
  if (role.positions.length > 0) {
    lines.push(<span key="positions">{role.positions.join('، ')}</span>);
  }
  if (role.typeText !== null) {
    lines.push(
      <span key="type" className="file-cell-note">
        {role.typeText}
      </span>,
    );
  }
  if (role.licensed !== null) {
    lines.push(
      <span key="licensed" className="file-cell-note">
        <Tag tone="outline">{role.licensed ? 'مدير مرخّص' : 'غير مرخّص'}</Tag>
      </span>,
    );
  }
  if (role.partnerRoles.length > 0) {
    lines.push(<span key="roles">الصفة: {role.partnerRoles.join('، ')}</span>);
  }
  if (role.shares !== null) {
    lines.push(
      <span key="shares" className="file-cell-line">
        <Ltr>{count(role.shares)}</Ltr> حصة
        {role.cashShares !== null || role.inKindShares !== null ? (
          <>
            {' · '}
            {role.cashShares !== null ? (
              <>
                نقدية <Ltr>{count(role.cashShares)}</Ltr>
              </>
            ) : null}
            {role.cashShares !== null && role.inKindShares !== null ? ' · ' : null}
            {role.inKindShares !== null ? (
              <>
                عينية <Ltr>{count(role.inKindShares)}</Ltr>
              </>
            ) : null}
          </>
        ) : null}
      </span>,
    );
  }
  if (role.profitPct !== null || role.lossPct !== null) {
    lines.push(
      <span key="distribution" className="file-cell-line">
        {role.profitPct !== null ? (
          <>
            الأرباح <Ltr>{`${role.profitPct}%`}</Ltr>
          </>
        ) : null}
        {role.profitPct !== null && role.lossPct !== null ? ' · ' : null}
        {role.lossPct !== null ? (
          <>
            الخسائر <Ltr>{`${role.lossPct}%`}</Ltr>
          </>
        ) : null}
      </span>,
    );
  }
  if (role.licenseNumber !== null) {
    lines.push(
      <span key="license" className="file-cell-note">
        رقم الترخيص <Ltr>{role.licenseNumber}</Ltr>
      </span>,
    );
  }
  if (role.ward !== null) {
    lines.push(
      <span key="ward">
        ولي عن الشريك {role.ward}
        {role.isFather ? ' (الأب)' : ''}
      </span>,
    );
  }
  return lines.length === 0 ? <>·</> : <span className="party-role-details">{lines}</span>;
}

function RolePowers({
  role,
  file,
  context,
}: {
  role: PartyRoleView;
  file: CustomerFile;
  context: {
    action: SectionCheckAction | undefined;
    refusal: string | null;
    running: boolean;
    bundle: string;
  };
}): ReactElement {
  if (role.role !== 'MANAGER') {
    return <>·</>;
  }
  if (role.permissions !== null) {
    const methods = [
      ...new Set(
        role.permissions
          .map((permission) => permission.method)
          .filter((method): method is string => method !== null),
      ),
    ];
    return (
      <>
        <StateTag state="VERIFIED">مُتحقق</StateTag>
        {methods.length > 0 ? <span className="file-cell-note">{methods.join('، ')}</span> : null}
        {role.permissions.length > 0 ? (
          <details className="file-details" data-role="permissions">
            <summary>{permissionsCountAr(role.permissions.length)}</summary>
            <ul>
              {role.permissions.map((permission, index) => (
                <li key={`${permission.name ?? ''}-${index}`}>
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
      </>
    );
  }
  if (!role.checkable) {
    return <StateTag state="NOT_APPLICABLE">لا يتوفر تحقق لهذه الهوية</StateTag>;
  }
  // Keyed, because the form's contents cross into a client component as a list and are
  // compared again when the check's answer redraws the file.
  const form = [
    <input key="entity" type="hidden" name="entity_id" value={role.company.entityId} />,
    <input key="kind" type="hidden" name="kind" value="BUSINESS" />,
    <input
      key="customer-kind"
      type="hidden"
      name="customer_kind"
      value={role.company.kind ?? 'COMPANY'}
    />,
    <input key="bundle" type="hidden" name="bundle" value={context.bundle} />,
    <input key="checks" type="hidden" name="checks" value="MANAGER_AUTHORITY" />,
    <input key="person" type="hidden" name="person" value={file.entityId} />,
    <input key="return" type="hidden" name="return_to" value={file.entityId} />,
    <SubmitButton
      key="submit"
      variant="ghost"
      disabled={context.refusal !== null || context.running}
      title={context.refusal ?? undefined}
      data-role="check-role"
    >
      تحقق
    </SubmitButton>,
  ];
  return (
    <span className="file-cell-status">
      <StateTag state={context.running ? 'PROCESSING' : 'PENDING'}>
        {context.running ? 'قيد المعالجة' : 'بانتظار التحقق'}
      </StateTag>
      {context.action === undefined ? null : (
        <SectionVerifyForm action={context.action}>{form}</SectionVerifyForm>
      )}
    </span>
  );
}

/** Every role this party holds in the subscriber's companies. */
export function RolesCard({
  file,
  roles,
  refusals,
  running,
  bundles,
  sectionAction,
}: {
  file: CustomerFile;
  roles: PartyRoles;
  refusals: Readonly<Record<string, string | null>>;
  running: Readonly<Record<string, readonly string[]>>;
  bundles: Readonly<Record<string, string>>;
  sectionAction?: SectionCheckAction | undefined;
}): ReactElement {
  const busy = roles.roles.some(
    (role) =>
      role.role === 'MANAGER' &&
      role.permissions === null &&
      (running[role.company.entityId] ?? []).includes('MANAGER_AUTHORITY'),
  );
  return (
    <Card as="section" labelledBy="party-roles-title" role="party-roles">
      <SectionLive
        titleAr="الصلاحيات"
        running={busy}
        attributes={{ 'data-section': 'ROLES' }}
        head={
          // Keyed: an element handed over as a prop is drawn beside the body in a list.
          <div key="head" className="file-section-head">
            <div className="file-section-title">
              <CardTitle as="h2" id="party-roles-title">
                الأدوار في المنشآت
              </CardTitle>
              <p className="file-section-source">
                كما سجلتها وزارة التجارة في ملف كل منشأة من عملائك
              </p>
            </div>
          </div>
        }
      >
        {roles.roles.length === 0 ? (
          <p className="file-empty" data-role="section-empty">
            لم يُذكر هذا الطرف في أي منشأة من عملائك بعد.
          </p>
        ) : (
          <div className="file-people">
            <Table label="الأدوار في المنشآت">
              <thead>
                <tr>
                  <Th>المنشأة</Th>
                  <Th>الدور والتفاصيل</Th>
                  <Th>الصلاحيات</Th>
                </tr>
              </thead>
              <tbody>
                {roles.companies.map((company) => {
                  const standing = STANDING[company.standing];
                  const held = roles.roles.filter(
                    (role) => role.company.entityId === company.entityId,
                  );
                  const managing = held.find((role) => role.role === 'MANAGER');
                  const seen = held
                    .map((role) => role.observedAt)
                    .filter((at): at is Date => at !== null)
                    .sort((left, right) => right.getTime() - left.getTime())[0];
                  return (
                    <tr
                      key={company.entityId}
                      data-role="party-company-row"
                      data-roles={held.map((role) => role.role).join(' ')}
                    >
                      <td>
                        <Link href={`/customers/${company.entityId}`}>
                          {company.name ?? 'منشأة بلا اسم'}
                        </Link>
                        <span className="file-cell-note">
                          <Tag tone={standing.tone} role="company-standing">
                            {standing.words(company)}
                          </Tag>
                        </span>
                        {seen !== undefined ? (
                          <span className="file-cell-note">
                            آخر رصد <Ltr>{isoDate(seen)}</Ltr>
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className="party-roles">
                          {held.map((role) => (
                            <span key={role.role} className="party-role" data-role="party-role">
                              <Tag tone="brand">{PARTY_ROLE_LABELS[role.role]}</Tag>
                              <RoleDetails role={role} />
                            </span>
                          ))}
                        </span>
                      </td>
                      <td>
                        {managing === undefined ? (
                          '·'
                        ) : (
                          <RolePowers
                            role={managing}
                            file={file}
                            context={{
                              action: sectionAction,
                              refusal: refusals['MANAGER_AUTHORITY'] ?? null,
                              running: (running[company.entityId] ?? []).includes(
                                'MANAGER_AUTHORITY',
                              ),
                              bundle: bundles[company.entityId] ?? '',
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </SectionLive>
    </Card>
  );
}

/** What about this party's companies a reader should look at before relying on them. */
function ConcernsCard({ roles }: { roles: PartyRoles }): ReactElement {
  return (
    <Card
      label="ما يستحق النظر"
      role="party-concerns"
      tone={roles.concerns.length > 0 ? 'attention' : 'surface'}
    >
      <CardTitle>ما يستحق النظر</CardTitle>
      {roles.concerns.length === 0 ? (
        <p className="card-line">لا ملاحظات على المنشآت المرتبطة بهذا الطرف.</p>
      ) : (
        <ul className="reason-list">
          {roles.concerns.map((concern) => (
            <li key={concern.textAr} className="reason-box" data-role="party-concern">
              <span>{concern.textAr}</span>
              <span className="reason-links">
                {concern.entities.map((entity, index) => (
                  <span key={entity.entityId}>
                    {index > 0 ? '، ' : ''}
                    <Link href={`/customers/${entity.entityId}`}>{entity.name ?? 'بلا اسم'}</Link>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** «مدير في 4 · شريك في 3», or what the party is when it holds one role. */
function rolesLine(roles: PartyRoles): string {
  const parts = (['MANAGER', 'PARTNER', 'LIQUIDATOR', 'GUARDIAN'] as const)
    .filter((role) => roles.roleCounts[role] > 0)
    .map((role) => `${PARTY_ROLE_LABELS[role]} في ${roles.roleCounts[role]}`);
  return parts.length === 0 ? 'لا أدوار مسجلة بعد' : parts.join(' · ');
}

function PartyStrip({ roles }: { roles: PartyRoles }): ReactElement {
  const { authority } = roles;
  return (
    <section className="file-strip" aria-label="مؤشرات الطرف" data-role="headline">
      <Card as="div" variant="stat" role="party-companies">
        <p className="strip-label">المنشآت المرتبطة</p>
        <p className="strip-value">
          <Ltr>{roles.companies.length}</Ltr>
        </p>
        <p className="strip-line">{rolesLine(roles)}</p>
      </Card>
      <Card
        as="div"
        variant="stat"
        role="party-authority"
        tone={
          authority.checkable > 0 && authority.verified === authority.checkable
            ? 'accent-2'
            : 'surface'
        }
      >
        <p className="strip-label">الصلاحيات المثبتة</p>
        <p className="strip-value">
          {roles.roleCounts.MANAGER === 0 ? (
            '·'
          ) : (
            <>
              <Ltr>{authority.verified}</Ltr> من <Ltr>{authority.checkable}</Ltr>
            </>
          )}
        </p>
        <p className="strip-line">
          {roles.roleCounts.MANAGER === 0
            ? 'ليس مديراً في أي منشأة من عملائك'
            : authority.checkable === 0
              ? 'لا يتوفر تحقق الصلاحيات لهذه الهوية'
              : 'في المنشآت التي يديرها'}
        </p>
      </Card>
      <Card as="div" variant="stat" role="party-shares">
        <p className="strip-label">الشراكات</p>
        <p className="strip-value">
          <Ltr>{roles.roleCounts.PARTNER}</Ltr>
        </p>
        <p className="strip-line">
          {roles.roleCounts.PARTNER === 0
            ? 'ليس شريكاً في أي منشأة من عملائك'
            : roles.roles.every((role) => role.shares === null)
              ? 'لم تُسجَّل حصصه بعد'
              : `مجموع الحصص ${count(
                  roles.roles.reduce((sum, role) => sum + (role.shares ?? 0), 0),
                )} حصة`}
        </p>
      </Card>
      <Card
        as="div"
        variant="stat"
        role="party-attention"
        tone={roles.concerns.length > 0 ? 'accent' : 'surface'}
      >
        <p className="strip-label">ما يستحق النظر</p>
        <p className="strip-value">
          <Ltr>{roles.concerns.length}</Ltr>
        </p>
        <p className="strip-line">{roles.concerns[0]?.textAr ?? 'لا ملاحظات على منشآته'}</p>
      </Card>
    </section>
  );
}

export function PartyFileScreen({
  view,
  action,
  sectionAction,
  watch,
}: {
  view: PartyFileView;
  action: Action;
  sectionAction?: SectionCheckAction | undefined;
  watch?: ((entityId: string) => Promise<string[]>) | undefined;
}): ReactElement {
  const { file, roles } = view;
  return (
    <div
      className="stack"
      style={{ gap: 'var(--layout-content-gap)' }}
      data-role="customer-file"
      data-file="party"
    >
      {watch === undefined
        ? null
        : Object.entries(view.running)
            .filter(([, checks]) => checks.length > 0)
            .map(([companyId, checks]) => (
              <FileWatcher key={companyId} entityId={companyId} running={checks} watch={watch} />
            ))}
      <FileHeader file={file} actions={<ExportFileButton />} />
      <PartyStrip roles={roles} />
      <div className="file-grid">
        <div className="file-column">
          {file.sections.map((section) => (
            <SectionCard
              key={section.section}
              section={section}
              context={{
                file,
                action,
                sectionAction,
                bundle: '',
                managerBundles: {},
                refusals: view.refusals,
                histories: view.histories,
                running: new Set<string>(),
              }}
            />
          ))}
          <RolesCard
            file={file}
            roles={roles}
            refusals={view.refusals}
            running={view.running}
            bundles={view.bundles}
            sectionAction={sectionAction}
          />
        </div>
        <aside className="file-column" aria-label="ما يستحق النظر والتقاطعات">
          <ConcernsCard roles={roles} />
          <IntersectionsCard file={file} />
          <TimelineCard entries={view.timeline} />
        </aside>
      </div>
    </div>
  );
}
