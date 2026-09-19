import type { ReactElement } from 'react';
import { checkEvidence, findSeal, type SealRecord } from '@nx-verify/core';
import { NoAccess } from '../../../../components/no-access';
import { EmptyState, PageHeader, Panel } from '../../../../components/page-header';
import { SectionTabs } from '../../../../components/section-tabs';
import { dateTime } from '../../../../components/format';
import { Button, Field, Input, Ltr, Notice, Tag } from '../../../../components/ui';
import { actingUser, query } from '../../../../lib/context';
import { getKeys } from '../../../../lib/keys';
import { VERIFICATION_TABS, visible } from '../../../../components/nav';

/**
 * Checking a sealed document somebody hands back to us.
 *
 * A verification platform whose evidence cannot be checked is selling a page. The seal has
 * always been checkable from the outside, through the code printed on the document, and that
 * public page says only that a fingerprint was sealed at a time. This screen is the inside of
 * the same question, for the workspace that issued the document: is this ours, when did we
 * seal it, is our own record of it intact, and is the fingerprint on the paper in front of you
 * the one we signed.
 *
 * It answers about this workspace's documents only. A document sealed for another subscriber
 * reads the same as a reference we never issued, because saying which would tell this reader
 * that some other workspace holds a document with this number.
 */

export const dynamic = 'force-dynamic';

const FINGERPRINT = /^[0-9a-f]{64}$/i;

type CheckView =
  | { state: 'idle' }
  | { state: 'bad-fingerprint' }
  | { state: 'unknown' }
  | {
      state: 'found';
      seal: SealRecord;
      signatureValid: boolean;
      /** Whether the reader typed the fingerprint from their copy. */
      compared: boolean;
      hashMatches: boolean;
      expired: boolean;
    };

export default async function EvidenceCheckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const actor = await actingUser();
  if (!actor.can('customers.read')) {
    return <NoAccess needs="customers.read" />;
  }

  const params = await searchParams;
  const text = (name: string): string =>
    typeof params[name] === 'string' ? (params[name] as string).trim() : '';
  const reference = text('ref');
  const fingerprint = text('fingerprint');
  const now = new Date();

  const view: CheckView = await (async () => {
    if (reference === '') {
      return { state: 'idle' as const };
    }
    if (fingerprint !== '' && !FINGERPRINT.test(fingerprint)) {
      return { state: 'bad-fingerprint' as const };
    }

    return query(async (tx): Promise<CheckView> => {
      const seal = await findSeal(tx, reference);
      if (seal === null) {
        return { state: 'unknown' };
      }

      // The version that signed this seal, not the version in force now. Re-signing after a
      // rotation would change a fingerprint a customer has already handed to an auditor.
      const signingKey = await getKeys().signingKey(tx.tenantId, seal.keyVersion);
      const check = await checkEvidence(
        tx,
        seal.evidenceId,
        // With no fingerprint typed there is nothing to compare the record against, and
        // `hashMatches` is then our row against itself: the screen says nothing about it.
        { contentHash: fingerprint === '' ? seal.contentHash : fingerprint },
        signingKey,
      );

      return {
        state: 'found',
        seal,
        signatureValid: check.signatureValid,
        compared: fingerprint !== '',
        hashMatches: check.hashMatches,
        expired: seal.expiresAt !== null && seal.expiresAt.getTime() < now.getTime(),
      };
    });
  })();

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <SectionTabs
        tabs={visible(VERIFICATION_TABS, actor.capabilities)}
        current="/verifications/evidence"
        label="أقسام التحقق"
      />
      <PageHeader
        title="فحص مستند مختوم"
        subtitle="الصق مرجع المستند لنقول متى خُتم وهل ما بين يديك هو ما ختمناه."
      />

      <Panel
        title="المرجع"
        role="check-form"
        note="المرجع هو الرمز المطبوع تحت رمز الاستجابة السريعة على المستند، أو معرّف الختم. البصمة اختيارية، وبها وحدها يُقارَن ما بين يديك بما وقّعناه."
      >
        <form className="panel-body stack" method="get" data-role="check-evidence">
          <Field id="ref" label="مرجع المستند" hint="الرمز المطبوع على المستند أو معرّف الختم.">
            {(control) => (
              <Input
                {...control}
                name="ref"
                ltr
                required
                defaultValue={reference}
                autoComplete="off"
              />
            )}
          </Field>
          <Field
            id="fingerprint"
            label="البصمة المطبوعة (اختياري)"
            hint="أربعة وستون حرفاً وأرقاماً كما هي على المستند."
          >
            {(control) => (
              <Input
                {...control}
                name="fingerprint"
                ltr
                defaultValue={fingerprint}
                autoComplete="off"
                invalid={view.state === 'bad-fingerprint'}
              />
            )}
          </Field>
          <div>
            <Button type="submit" variant="primary" data-role="check-submit">
              افحص المستند
            </Button>
          </div>
        </form>
      </Panel>

      {view.state === 'idle' ? (
        <Panel title="النتيجة" role="check-result">
          <EmptyState>الصق مرجع مستند لتظهر نتيجة الفحص هنا.</EmptyState>
        </Panel>
      ) : null}

      {view.state === 'bad-fingerprint' ? (
        <Notice tone="refused" role="check-bad-fingerprint">
          البصمة يجب أن تكون أربعة وستين حرفاً من ٠ إلى ٩ ومن a إلى f. انسخها كاملة من المستند،
          فبصمة ناقصة حرفاً تبدو كأنها مستند مزوَّر.
        </Notice>
      ) : null}

      {view.state === 'unknown' ? (
        <Notice tone="refused" role="check-unknown">
          لا نجد هذا المرجع بين مستندات مساحة عملكم. تأكد من نسخه كاملاً. والمستند المختوم
          لمشترك آخر لا يُفحَص من هنا، وإنما من صفحة التحقق العامة المطبوعة عليه.
        </Notice>
      ) : null}

      {view.state === 'found' ? (
        <Panel
          title="النتيجة"
          role="check-result"
          aside={view.seal.bundle ? 'حزمة تغطي عدة تحققات' : 'تحقق واحد'}
        >
          {view.signatureValid ? (
            <Notice tone="done" role="check-verdict">
              هذا ختمٌ من عندنا، وتوقيعنا عليه سليم.
              {view.compared
                ? view.hashMatches
                  ? ' والبصمة التي كتبتها هي البصمة التي وقّعناها.'
                  : ' لكن البصمة التي كتبتها ليست التي وقّعناها: ما بين يديك ليس هذا المستند.'
                : ''}
            </Notice>
          ) : (
            <Notice tone="refused" role="check-verdict">
              التوقيع على هذا الختم لا يُطابق مفتاح مساحة العمل. لا تعتمد هذا المستند وراجعنا.
            </Notice>
          )}

          <section className="grid" data-role="seal-facts">
            <article className="stat">
              <span className="stat-label">وقت الختم</span>
              <strong className="stat-value">
                <Ltr>{dateTime(view.seal.signedAt)}</Ltr>
              </strong>
            </article>
            <article className="stat">
              <span className="stat-label">الصفحة العامة</span>
              <strong className="stat-value">
                {view.seal.expiresAt === null ? (
                  'لا تنتهي'
                ) : (
                  <Ltr>{dateTime(view.seal.expiresAt)}</Ltr>
                )}
              </strong>
              {view.expired ? (
                <span className="stat-hint">
                  <Tag tone="critical" role="seal-expired">
                    انتهت مدة الصفحة العامة
                  </Tag>
                </span>
              ) : null}
            </article>
            <article className="stat">
              <span className="stat-label">رقم التحقق</span>
              <strong className="stat-value">
                {view.seal.runReference === null ? 'غير مرقَّم' : <Ltr>{view.seal.runReference}</Ltr>}
              </strong>
            </article>
            <article className="stat">
              <span className="stat-label">إصدار مفتاح التوقيع</span>
              <strong className="stat-value">
                <Ltr>{view.seal.keyVersion}</Ltr>
              </strong>
            </article>
          </section>

          <p className="panel-body">
            <span className="stat-label">البصمة عندنا</span>
            <br />
            <bdi dir="ltr" className="mono" data-role="stored-hash">
              {view.seal.contentHash}
            </bdi>
          </p>

          <p className="faint" data-role="check-scope">
            الفحص يقول إن هذا الختم صادر منّا وإن سجلّنا له لم يُمَس. ولا يقول شيئاً عن صحة
            الوقائع بعد لحظة الختم: الوقائع تُقرأ من ملف العميل.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
