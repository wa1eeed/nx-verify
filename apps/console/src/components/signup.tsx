import Link from 'next/link';
import type { ReactElement } from 'react';
import { Brand } from './brand';
import { SubmitButton } from './ui/submit-button';

/**
 * Registering a company (ADR-154).
 *
 * A short KYB form, and then a code to the address before anything is created. What it asks
 * for is what an account needs and nothing more: a platform whose whole purpose is reading
 * facts from official sources has no business asking a person to type facts it is about to go
 * and find out.
 *
 * The unified number is on this form because it identifies the establishment being registered,
 * and it is sealed the moment it is stored: there is no workspace yet to hold a per tenant key,
 * so it is encrypted under a key derived from the platform's root and opened once, when the
 * workspace is made. Rule 4 has no exception for a registration form.
 */

const SIGNUP_REFUSALS: Record<string, string> = {
  invalid: 'راجع الحقول: الرقم الموحد عشرة أرقام، والجوال سعودي، وكلمة المرور 12 حرفاً فأكثر.',
  'too-soon': 'أُرسل رمز قبل قليل. انتظر دقيقة ثم أعد المحاولة.',
  mail: 'تعذّر إرسال الرمز الآن. حاول بعد قليل.',
  failed: 'لم يكتمل التسجيل. حاول مرة أخرى.',
};

const CODE_REFUSALS: Record<string, string> = {
  code: 'الرمز غير صحيح أو انتهت مدته.',
  failed: 'لم يكتمل التسجيل. ابدأ من جديد.',
};

/** Activities as a buyer describes their own, not a coded list: we are not the authority. */
const ACTIVITIES: readonly string[] = [
  'تمويل أو خدمات مالية',
  'تجارة جملة أو تجزئة',
  'مقاولات وإنشاء',
  'تقنية وبرمجيات',
  'لوجستيات ونقل',
  'عقار وإدارة أملاك',
  'خدمات مهنية واستشارات',
  'أخرى',
];

export function SignupForm({
  refused,
  action,
}: {
  refused?: string | undefined;
  action: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  const notice =
    refused === undefined ? null : (SIGNUP_REFUSALS[refused] ?? SIGNUP_REFUSALS['failed']);

  return (
    <div className="auth-frame" data-surface="signup">
      <Brand href="/" />
      <main id="main" className="card stack" data-role="signup" style={{ gap: 'var(--s-4)' }}>
        <div>
          <h1 style={{ margin: 0 }}>أنشئ حساب منشأتك</h1>
          <p className="faint" style={{ margin: 0 }}>
            دقيقتان، ثم رمز إلى بريدك لإثباته. لا يُنشأ الحساب قبل ذلك.
          </p>
        </div>

        {notice === null || notice === undefined ? null : (
          <p className="notice notice-refused" data-role="signup-refused" style={{ margin: 0 }}>
            {notice}
          </p>
        )}

        <form action={action} className="stack" style={{ gap: 'var(--s-3)' }}>
          <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '220px' }}>
              <span className="stat-label">اسم المنشأة</span>
              <input name="legal_name" required maxLength={120} autoComplete="organization" />
            </label>
            <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '180px' }}>
              <span className="stat-label">الرقم الموحد</span>
              <input
                name="unified_number"
                dir="ltr"
                inputMode="numeric"
                required
                placeholder="7001234567"
                style={{ width: '16ch' }}
              />
            </label>
          </div>

          <label className="stack" style={{ gap: 'var(--s-1)' }}>
            <span className="stat-label">نوع النشاط</span>
            <select name="activity" defaultValue={ACTIVITIES[0]} required>
              {ACTIVITIES.map((activity) => (
                <option key={activity} value={activity}>
                  {activity}
                </option>
              ))}
            </select>
          </label>

          <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '200px' }}>
              <span className="stat-label">اسم مسؤول الحساب</span>
              <input name="contact_name" required maxLength={120} autoComplete="name" />
            </label>
            <label className="stack" style={{ gap: 'var(--s-1)', minWidth: '180px' }}>
              <span className="stat-label">رقم الجوال</span>
              <input
                name="phone"
                dir="ltr"
                inputMode="tel"
                required
                placeholder="05xxxxxxxx"
                autoComplete="tel"
                style={{ width: '16ch' }}
              />
            </label>
          </div>

          <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '220px' }}>
              <span className="stat-label">بريد العمل</span>
              <input
                name="email"
                type="email"
                dir="ltr"
                required
                autoComplete="email"
                placeholder="you@example.sa"
              />
            </label>
            <label className="stack" style={{ gap: 'var(--s-1)', flex: 1, minWidth: '200px' }}>
              <span className="stat-label">كلمة المرور</span>
              <input
                name="password"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
            </label>
          </div>

          <span className="stat-hint">
            كلمة المرور 12 حرفاً على الأقل. لا نرسل كلمات مرور بالبريد، فأنت من يختارها.
          </span>

          <SubmitButton variant="primary" data-role="signup-submit" pendingLabel="جارٍ الإرسال">
            أرسل رمز التحقق
          </SubmitButton>
        </form>

        <p className="faint" style={{ margin: 0 }}>
          لديك حساب؟ <Link href="/login">سجّل الدخول</Link>
        </p>
      </main>
    </div>
  );
}

export function SignupCodeForm({
  refused,
  action,
}: {
  refused?: string | undefined;
  action: (formData: FormData) => void | Promise<void>;
}): ReactElement {
  const notice = refused === undefined ? null : (CODE_REFUSALS[refused] ?? CODE_REFUSALS['failed']);

  return (
    <div className="auth-frame" data-surface="signup-code">
      <Brand href="/" />
      <main id="main" className="card stack" data-role="signup-code" style={{ gap: 'var(--s-4)' }}>
        <div>
          <h1 style={{ margin: 0 }}>أدخل الرمز</h1>
          <p className="faint" style={{ margin: 0 }}>
            أرسلنا ستة أرقام إلى بريدك. ينتهي بعد نصف ساعة.
          </p>
        </div>

        {notice === null || notice === undefined ? null : (
          <p className="notice notice-refused" data-role="code-refused" style={{ margin: 0 }}>
            {notice}
          </p>
        )}

        <form action={action} className="stack" style={{ gap: 'var(--s-3)' }}>
          <label className="stack" style={{ gap: 'var(--s-1)' }}>
            <span className="stat-label">الرمز</span>
            <input
              name="code"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              style={{ width: '10ch' }}
            />
          </label>
          <SubmitButton variant="primary" data-role="code-submit" pendingLabel="جارٍ الإنشاء">
            أنشئ الحساب
          </SubmitButton>
        </form>

        <p className="faint" style={{ margin: 0 }}>
          لم يصلك شيء؟ <Link href="/signup">ابدأ من جديد</Link>
        </p>
      </main>
    </div>
  );
}
