import type { ReactElement } from 'react';
import type { UserRole } from '@nx-verify/core';
import { ROLE_LABELS, ROLE_ORDER } from './roles';
import { EmptyState, PageHeader, Panel } from './page-header';
import { SubmitButton } from './ui/submit-button';
import { Ltr } from './ui/ltr';
import { isoDate } from './format';

/**
 * Signing in through your own directory (ADR-153).
 *
 * The form for this has sat on the login screen of every deployment since single sign on was
 * built, and it could never work: nothing in the platform could write an IdP configuration or
 * prove a domain, so `beginSso` always found no domain and refused. It refused quietly, with
 * the same message a wrong password gets, so nobody could tell a broken feature from a wrong
 * address.
 *
 * Two halves, and the order is not optional. A domain routes nobody until it is **proved by
 * DNS**, because a company that could claim a domain it does not own could claim the addresses
 * of a company that does. And the switch that closes the password door is offered last and
 * only once something is proved, because turning it on with a broken configuration locks
 * everybody out of their own workspace.
 */

/**
 * The role an identity provider may put somebody in.
 *
 * Every role, including the two that describe a job rather than a tier: a company on single
 * sign on is exactly the kind of company that has a finance group in its directory, and a
 * list here that lagged behind the one on the users screen would make that group unreachable
 * for the customers most likely to need it.
 */
export type SsoRole = UserRole;

export interface SsoDomainView {
  domain: string;
  verified: boolean;
  proofToken: string | null;
  checkedAt: Date | null;
  lastError: string | null;
}

export interface IdpView {
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  discoveryUrl: string;
  defaultRole: SsoRole | null;
  allowJit: boolean;
  enforceSso: boolean;
}



const OUTCOMES: Record<string, { tone: 'done' | 'refused'; text: string }> = {
  configured: { tone: 'done', text: 'حُفظ إعداد مزوّد الهوية.' },
  claimed: { tone: 'done', text: 'سُجّل النطاق. انشر السجل أدناه في DNS ثم اضغط «تحقق».' },
  verified: { tone: 'done', text: 'أُثبت النطاق. صار الدخول الموحّد يعمل لعناوينه.' },
  'not-found': {
    tone: 'refused',
    text: 'لم يظهر السجل بعد. تغييرات DNS تأخذ دقائق أحياناً ساعات، وجرّب مرة أخرى.',
  },
  removed: { tone: 'done', text: 'أُزيل النطاق.' },
  domain: { tone: 'refused', text: 'اكتب نطاقاً مثل example.sa.' },
  taken: { tone: 'refused', text: 'هذا النطاق مسجّل بالفعل.' },
  secret: { tone: 'refused', text: 'أول حفظ يحتاج سرّ العميل. وبعده يُترك فارغاً ليبقى المخزَّن.' },
  'no-verified-domain': {
    tone: 'refused',
    text: 'لا تُغلق باب كلمة المرور قبل إثبات نطاق واحد على الأقل: ستقفل الجميع خارج مساحة عملهم.',
  },
  failed: { tone: 'refused', text: 'لم يُحفظ التغيير. حاول مرة أخرى.' },
};

export function ssoNotice(
  outcome: string | undefined,
): { tone: 'done' | 'refused'; text: string } | null {
  return outcome === undefined ? null : (OUTCOMES[outcome] ?? null);
}

type Action = (formData: FormData) => void | Promise<void>;

export function SsoSettings({
  idp,
  domains,
  outcome,
  configureAction,
  claimAction,
  verifyAction,
  removeAction,
}: {
  idp: IdpView | null;
  domains: SsoDomainView[];
  outcome?: string | undefined;
  configureAction: Action;
  claimAction: Action;
  verifyAction: Action;
  removeAction: Action;
}): ReactElement {
  const notice = ssoNotice(outcome);
  const anyVerified = domains.some((domain) => domain.verified);

  return (
    <section className="stack" data-role="sso-settings" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title="الدخول الموحّد"
        subtitle="دخول موظفيك بدليل شركتك، بدل كلمة مرور لكل واحد."
      />

      {notice === null ? null : (
        <p
          className={`notice notice-${notice.tone}`}
          data-role="sso-outcome"
          data-tone={notice.tone}
          style={{ margin: 0 }}
        >
          {notice.text}
        </p>
      )}

      <Panel
        title="النطاقات"
        note="النطاق لا يوجّه أحداً قبل إثباته. من يستطيع ادّعاء نطاق لا يملكه يستطيع ادّعاء عناوين من يملكه."
      >
        <div className="panel-body stack" style={{ gap: 'var(--s-3)' }}>
          <form
            action={claimAction}
            className="row"
            data-role="claim-domain"
            style={{ gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}
          >
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '200px' }}>
              <span className="stat-label">النطاق</span>
              <input name="domain" dir="ltr" required placeholder="example.sa" />
            </label>
            <SubmitButton data-role="claim-submit" pendingLabel="جارٍ التسجيل">
              سجّل النطاق
            </SubmitButton>
          </form>

          {domains.length === 0 ? (
            <EmptyState>لا نطاقات بعد.</EmptyState>
          ) : (
            <div className="stack" style={{ gap: 'var(--s-3)' }}>
              {domains.map((domain) => (
                <article
                  key={domain.domain}
                  className="stack channel-card"
                  data-role="sso-domain"
                  data-item={domain.domain}
                  style={{ gap: 'var(--s-2)' }}
                >
                  <div
                    className="row"
                    style={{ gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'baseline' }}
                  >
                    <Ltr>{domain.domain}</Ltr>
                    <span className="badge" data-verified={domain.verified ? 'true' : 'false'}>
                      {domain.verified ? 'مُثبت' : 'غير مُثبت، ولا يوجّه أحداً'}
                    </span>
                    <form action={removeAction} style={{ marginInlineStart: 'auto' }}>
                      <input type="hidden" name="domain" value={domain.domain} />
                      <SubmitButton
                        variant="ghost"
                        data-role="remove-domain"
                        pendingLabel="جارٍ الإزالة"
                      >
                        إزالة
                      </SubmitButton>
                    </form>
                  </div>

                  {domain.verified || domain.proofToken === null ? null : (
                    <>
                      <p className="stat-hint" style={{ margin: 0 }}>
                        أضف هذا السجل إلى نطاق <Ltr>{domain.domain}</Ltr>، من نوع TXT على الجذر
                        <Ltr>@</Ltr>:
                      </p>
                      <code
                        className="mono"
                        dir="ltr"
                        data-role="proof-record"
                        style={{ wordBreak: 'break-all' }}
                      >
                        nx-verify-domain={domain.proofToken}
                      </code>
                      <div className="row" style={{ gap: 'var(--s-2)', alignItems: 'center' }}>
                        <form action={verifyAction}>
                          <input type="hidden" name="domain" value={domain.domain} />
                          <SubmitButton
                            variant="secondary"
                            data-role="verify-domain"
                            pendingLabel="جارٍ البحث"
                          >
                            تحقق الآن
                          </SubmitButton>
                        </form>
                        {domain.checkedAt === null ? null : (
                          <span className="faint">
                            آخر محاولة <Ltr>{isoDate(domain.checkedAt)}</Ltr>
                            {domain.lastError === null ? null : ' · لم يظهر السجل'}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="مزوّد الهوية"
        note="OIDC. سرّ العميل يُكتب مرة إلى الخزنة المختومة، وتحتفظ القاعدة بمؤشر إليه لا به (القاعدة 10)."
      >
        <form
          action={configureAction}
          className="panel-body stack"
          data-role="configure-idp"
          style={{ gap: 'var(--s-3)' }}
        >
          <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '220px' }}>
              <span className="stat-label">عنوان الاكتشاف</span>
              <input
                name="discovery_url"
                type="url"
                dir="ltr"
                required
                defaultValue={idp?.discoveryUrl ?? ''}
                placeholder="https://login.example.com/.well-known/openid-configuration"
              />
            </label>
          </div>
          <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '200px' }}>
              <span className="stat-label">المُصدِر</span>
              <input
                name="issuer"
                dir="ltr"
                required
                defaultValue={idp?.issuer ?? ''}
                placeholder="https://login.example.com"
              />
            </label>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '180px' }}>
              <span className="stat-label">معرّف العميل</span>
              <input name="client_id" dir="ltr" required defaultValue={idp?.clientId ?? ''} />
            </label>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '180px' }}>
              <span className="stat-label">سرّ العميل</span>
              <input
                name="client_secret"
                type="password"
                dir="ltr"
                autoComplete="off"
                placeholder={idp?.hasSecret ? '••••••••' : ''}
              />
            </label>
          </div>
          <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
            <label className="stack" style={{ gap: 'var(--s-1)' }}>
              <span className="stat-label">دور من لا ينطبق عليه شيء</span>
              <select
                name="default_role"
                defaultValue={idp?.defaultRole ?? ''}
                style={{ width: 'auto' }}
              >
                {/* Refusing them is the right default for a platform that spends money. */}
                <option value="">ارفضه</option>
                {ROLE_ORDER.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <label className="row" style={{ gap: 'var(--s-2)', alignItems: 'center' }}>
              <input type="checkbox" name="allow_jit" defaultChecked={idp?.allowJit ?? true} />
              <span>أنشئ المستخدم عند أول دخول</span>
            </label>
          </div>

          {/*
            Offered only once a domain is proved. Closing the password door with a broken
            configuration locks everybody out of their own workspace, and the way back is us.
          */}
          {anyVerified ? (
            <label className="row" style={{ gap: 'var(--s-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                name="enforce_sso"
                data-role="enforce-sso"
                defaultChecked={idp?.enforceSso ?? false}
              />
              <span>أغلق باب كلمة المرور: الدخول بالدليل وحده</span>
            </label>
          ) : (
            <p className="stat-hint" data-role="enforce-locked" style={{ margin: 0 }}>
              إغلاق باب كلمة المرور يظهر بعد إثبات نطاق واحد على الأقل.
            </p>
          )}

          <div>
            <SubmitButton variant="primary" data-role="configure-submit" pendingLabel="جارٍ الحفظ">
              احفظ الإعداد
            </SubmitButton>
          </div>
        </form>
      </Panel>
    </section>
  );
}
