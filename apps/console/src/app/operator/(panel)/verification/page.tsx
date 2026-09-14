import type { ReactElement } from 'react';
import {
  getPlatformSettings,
  listOperatorAudit,
  listSettableSections,
  operatorCan,
} from '@nx-verify/core';
import { PageHeader } from '../../../../components/page-header';
import { SectionTabs } from '../../../../components/section-tabs';
import { INTEGRATION_TABS } from '../../../../components/operator-shell';
import { VerificationSettings } from '../../../../components/admin-pricing/settings';
import { lastChangeAr, noticeAr } from '../../../../components/admin-pricing/model';
import { Notice, SubmitButton } from '../../../../components/ui';
import { currentOperator, operatorQuery } from '../../../../lib/operator';
import { operatorNameOf } from '../../../../lib/operator-names';
import { savePricingAction } from '../pricing/actions';

/** Never prerendered, and refuses to render without a sign in. */
export const dynamic = 'force-dynamic';

const SETTINGS_FORM = 'settings-form';

/**
 * How verification behaves for every subscriber (handoff screen 05, «إعدادات التحقق»), opened
 * from the navigation, with the connection to the data source in the tabs beside it.
 *
 * The same card the prices screen draws, saved the same way: the fields belong to the form in
 * the head, and the one primary button there saves them.
 */
export default async function VerificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const operator = await currentOperator();
  const params = Object.fromEntries(
    Object.entries(await searchParams).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const editable = operatorCan(operator.role, 'settings');

  const data = await operatorQuery(async (db) => ({
    settings: await getPlatformSettings(db),
    sections: await listSettableSections(db),
    lastChange: (await listOperatorAudit(db, { targetPrefixes: ['settings:'], limit: 1 }))[0],
  }));
  const notice = noticeAr(params, (code) => code);

  return (
    <div className="admin-screen" data-role="verification-settings-screen">
      <SectionTabs
        tabs={INTEGRATION_TABS}
        current="/operator/verification"
        label="أقسام إعدادات التحقق"
      />
      <PageHeader
        title="إعدادات التحقق"
        subtitle={lastChangeAr(
          data.lastChange === undefined
            ? null
            : { byName: operatorNameOf(data.lastChange), at: data.lastChange.at },
          'لم يُعدَّل أي إعداد بعد',
        )}
        action={
          editable ? (
            <form id={SETTINGS_FORM} action={savePricingAction} className="admin-head-actions">
              <input type="hidden" name="return_to" value="verification" />
              <SubmitButton variant="primary" pendingLabel="جارٍ الحفظ" data-role="save-settings">
                حفظ التغييرات
              </SubmitButton>
            </form>
          ) : undefined
        }
      />
      {notice === null ? null : (
        <Notice tone={notice.tone} role="settings-notice">
          {notice.text}
        </Notice>
      )}
      <VerificationSettings
        settings={data.settings}
        sections={data.sections}
        formId={SETTINGS_FORM}
        editable={editable}
      />
    </div>
  );
}
