import type { ReactElement } from 'react';
import type { ModuleSource, TenantModuleView } from '@nx-verify/core';
import { Card } from '../ui/card';
import { SubmitButton } from '../ui/submit-button';
import { Table, Th } from '../ui/table';
import { Tag } from '../ui/tag';
import { dateAr } from '../format';

/**
 * What one subscriber was sold, module by module (ADR-137).
 *
 * The screen answers two questions, and the second is the one a settings page usually cannot:
 * is this module on for them, and why. «Why» matters because nothing is copied onto a
 * subscriber at onboarding. They inherit their plan and the module's own default until
 * somebody decides otherwise, so a year later the difference between a deliberate choice and
 * a default that has since changed is still readable.
 *
 * Switching one off takes its whole section out of every customer file they open, and refuses
 * its products on the API with it. So the note under the title says that plainly rather than
 * leaving somebody to discover it.
 */

const SOURCE_TAGS: Readonly<Record<ModuleSource, { label: string; tone: 'neutral' | 'accent' }>> = {
  core: { label: 'أساسي', tone: 'neutral' },
  switch: { label: 'قرار خاص بهذا المشترك', tone: 'accent' },
  plan: { label: 'من الباقة', tone: 'neutral' },
  default: { label: 'الافتراضي', tone: 'neutral' },
};

export function SubscriberModules({
  tenantId,
  modules,
  canManage,
  setModule,
}: {
  tenantId: string;
  modules: readonly TenantModuleView[];
  canManage: boolean;
  setModule: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  return (
    <Card variant="flush" role="subscriber-modules" labelledBy="subscriber-modules-title">
      <div className="admin-card-head">
        <h2 className="card-title admin-card-title" id="subscriber-modules-title">
          وحدات التحقق
        </h2>
        <div className="admin-head-actions">
          <Tag tone="accent-2">
            {`مفعّل ${modules.filter((module) => module.enabled).length} من ${modules.length}`}
          </Tag>
        </div>
      </div>

      <p className="admin-card-note">
        الوحدة المطفأة يختفي قسمها من ملفات عملاء هذا المشترك، ولا يُحسب ناقصاً عليه، وتُرفض منتجاته
        على الواجهة البرمجية كذلك. وما لم يُقرَّر له شيء يرثه من باقته ومن الافتراضي.
      </p>

      <div className="admin-table">
        <Table label="وحدات هذا المشترك">
          <thead>
            <tr>
              <Th>الوحدة</Th>
              <Th>الحالة</Th>
              <Th>مصدر القرار</Th>
              <Th>
                <span className="visually-hidden">إجراء</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => (
              <tr key={module.code} data-role="subscriber-module" data-module={module.code}>
                <td>
                  <span className="admin-offer-title">{module.nameAr}</span>
                  <span className="admin-offer-terms"> · {module.summaryAr}</span>
                </td>
                <td>
                  <Tag tone={module.enabled ? 'accent-2' : 'neutral'}>
                    {module.enabled ? 'مفعّل' : 'معطّل'}
                  </Tag>
                </td>
                <td>
                  <Tag tone={SOURCE_TAGS[module.source].tone}>
                    {SOURCE_TAGS[module.source].label}
                  </Tag>
                  {module.decidedAt === null ? null : (
                    <span className="admin-offer-terms"> · {dateAr(module.decidedAt)}</span>
                  )}
                </td>
                <td>
                  {module.core ? (
                    <span className="muted">أساس كل ملف عميل</span>
                  ) : canManage ? (
                    <form action={setModule} className="row admin-inline-form">
                      <input type="hidden" name="tenant_id" value={tenantId} />
                      <input type="hidden" name="module_code" value={module.code} />
                      <SubmitButton
                        name="enabled"
                        value={module.enabled ? 'false' : 'true'}
                        variant={module.enabled ? 'secondary' : 'primary'}
                        data-role="set-module"
                        pendingLabel="جارٍ الحفظ"
                      >
                        {module.enabled ? 'تعطيل' : 'تفعيل'}
                      </SubmitButton>
                      {module.decided === null ? null : (
                        <SubmitButton
                          name="enabled"
                          value=""
                          variant="ghost"
                          data-role="clear-module"
                        >
                          رفع القرار
                        </SubmitButton>
                      )}
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
    </Card>
  );
}
