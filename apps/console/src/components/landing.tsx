import Link from 'next/link';
import type { ReactElement } from 'react';
import { Brand, PRODUCT_NAME } from './brand';

/**
 * The one screen somebody sees before they have an account (ADR-154).
 *
 * It is built from the product's own tokens rather than a marketing theme of its own, because
 * a landing page that looks like a different product is a promise the product does not keep:
 * whoever signs up should recognise what they signed up for on the first screen after.
 *
 * Three things it refuses to do, each because of how this kind of page usually goes wrong.
 *
 * **It names no data source.** Rule 5 is not a rule about API responses, it is a rule about
 * what this platform sells: our answer, with the authority behind it. A landing page that
 * lists the companies we buy from is selling their product, not ours.
 *
 * **It claims no customers and no numbers it cannot show.** No logo wall, no «trusted by 400
 * companies», no invented uptime. A verification platform that exaggerates on its own front
 * page is telling you exactly how much its other numbers are worth.
 *
 * **It shows the product rather than adjectives.** The panel beside the headline is a
 * customer file in miniature, with a real field, its authority and its date, because that is
 * the whole idea and a sentence about it is weaker than the thing.
 */

interface Service {
  title: string;
  body: string;
  mark: string;
}

/**
 * What the platform verifies, in the words a buyer uses.
 *
 * Named by the fact established, not by the service that answers: «a commercial registration,
 * current today» is what somebody is buying. Which authority answers is ours to route.
 */
const SERVICES: readonly Service[] = [
  {
    mark: '□',
    title: 'السجل التجاري',
    body: 'الاسم والحالة والنشاط ورأس المال وتاريخ الانتهاء، من المصدر الرسمي، بختم زمني. تعرف أن السجل نشط اليوم، لا أنه كان نشطاً حين صُوّرت الورقة.',
  },
  {
    mark: '◎',
    title: 'المدراء والمفوضون',
    body: 'من يملك حق التوقيع نيابة عن المنشأة، وبأي صلاحية وحدود. العقد الذي يوقّعه غير المفوَّض عقدٌ قابل للطعن.',
  },
  {
    mark: '⌂',
    title: 'العنوان الوطني',
    body: 'العنوان المسجّل رسمياً للمنشأة، لا ما كُتب في نموذج. ويكشف تقاطع عنوان واحد بين عدة عملاء.',
  },
  {
    mark: '≡',
    title: 'ملكية الآيبان',
    body: 'أن الحساب البنكي يخصّ المنشأة نفسها لا شخصاً آخر. الفرق بين تحويل يصل وتحويل يُسترد.',
  },
  {
    mark: '◇',
    title: 'عقد التأسيس والملكية',
    body: 'الشركاء ونسب الملكية وهيكل الحوكمة، لتعرف من وراء المنشأة فعلاً قبل أن تتعامل معها.',
  },
  {
    mark: '☰',
    title: 'العمل الحر والعقارات والدخل',
    body: 'وثيقة العمل الحر، والصكوك العقارية، والدخل الشهري: وحدات تُفعَّل حين تحتاجها وحدها.',
  },
];

interface Differentiator {
  title: string;
  body: string;
}

/** Why this rather than a folder of PDFs, which is what it actually replaces. */
const WHY: readonly Differentiator[] = [
  {
    title: 'كل حقل يحمل جهته وتاريخه',
    body: 'لا حقل في هذه المنصة بلا الجهة التي أصدرته واللحظة التي رُصد فيها. المراجع بعد سنتين لا يسأل «هل هذا صحيح» بل «متى عرفتم، وعمّن».',
  },
  {
    title: 'المعرفة لا تُستبدل، تُضاف',
    body: 'حين يتغيّر السجل لا نكتب فوق القديم: نضيف الجديد ونحتفظ بالأول. فتاريخ العميل كاملٌ ومقروء، لا لقطةٌ واحدة لا تعرف ما قبلها.',
  },
  {
    title: 'التغيّر يصلك، ولا تبحث عنه',
    body: 'المراقبة تتابع من تختاره بالوتيرة التي تختارها وبسقف إنفاق لا تتجاوزه، وتخبرك حين تقول الجهة الرسمية شيئاً جديداً.',
  },
  {
    title: 'قرارٌ له سبب مكتوب',
    body: 'قواعد القبول والرفض والمراجعة تراها وتعدّلها وتحاكيها على بياناتك قبل تشغيلها. لا صندوق أسود يقول «مرفوض».',
  },
  {
    title: 'ملف يُشارك برابط، لا بمرفق',
    body: 'تشارك ما تختاره من ملف العميل مع بنك أو جهة، لمدة تنتهي، بمعرّفات مقنّعة، وتسحبه متى شئت. لا نسخة PDF تعيش في بريد أحدهم للأبد.',
  },
  {
    title: 'تدفع بالاستخدام',
    body: 'رصيد تشتريه وتستهلكه بعمليات التحقق، بأسعار معروضة لكل خدمة قبل تشغيلها. لا اشتراك سنوي على رفٍّ لا تستعمله.',
  },
];

/** What happens between «ابدأ» and a verified customer file, honestly. */
const STEPS: readonly Differentiator[] = [
  {
    title: 'سجّل منشأتك',
    body: 'نموذج قصير، ثم رمز إلى بريدك لإثباته. دقيقتان.',
  },
  {
    title: 'اختر خدمات التحقق',
    body: 'فعّل ما تحتاجه من وحدات، واترك الباقي. تُغيّرها متى شئت.',
  },
  {
    title: 'اشحن رصيدك',
    body: 'تحويل بنكي، ونؤكّده يدوياً ثم يظهر الرصيد في محفظتك.',
  },
  {
    title: 'تحقّق',
    body: 'من الشاشة أو من الـAPI. النتيجة ملف عميل حيّ، لا تقرير ميت.',
  },
];

export function Landing(): ReactElement {
  return (
    <div className="landing" data-role="landing">
      <header className="landing-bar">
        <Brand href="/" />
        <nav className="landing-bar-actions">
          <Link className="btn btn-ghost" href="/login" data-role="landing-sign-in">
            تسجيل الدخول
          </Link>
          <Link className="btn btn-primary" href="/signup" data-role="landing-sign-up">
            أنشئ حساباً
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="landing-section landing-hero">
          <div>
            <h1>تحقّق من منشأة قبل أن تتعامل معها، من المصدر الرسمي.</h1>
            <p className="landing-lede">
              {PRODUCT_NAME} تسحب حقائق المنشآت من الجهات الرسمية وتبني منها ملفاً حيّاً: السجل
              التجاري، ومن يملك حق التوقيع، والعنوان الوطني، وملكية الآيبان. كل حقل بجهته وتاريخ
              رصده، وكل تغيّر يصلك.
            </p>
            <div className="landing-cta">
              <Link className="btn btn-primary" href="/signup" data-role="hero-sign-up">
                ابدأ الآن
              </Link>
              <Link className="btn btn-secondary" href="#services">
                اعرف ما نتحقق منه
              </Link>
            </div>
            <p className="stat-hint" style={{ marginBlockStart: 'var(--space-4)' }}>
              بلا اشتراك سنوي. تشحن رصيداً وتدفع بالعملية.
            </p>
          </div>

          {/*
            The product in miniature, because showing beats describing. The values are
            illustrative and the screen says so: a made up figure presented as real on the
            front page of a verification platform would be the wrong first impression.
          */}
          <aside className="landing-proof" aria-label="مثال على ملف عميل">
            <div className="landing-proof-row">
              <span>حالة السجل التجاري</span>
              <strong>نشط</strong>
            </div>
            <div className="landing-proof-meta">وزارة التجارة · رُصد اليوم</div>
            <div className="landing-proof-row">
              <span>صلاحية التوقيع</span>
              <strong>مفوَّض منفرداً</strong>
            </div>
            <div className="landing-proof-meta">وزارة التجارة · رُصد اليوم</div>
            <div className="landing-proof-row">
              <span>ملكية الآيبان</span>
              <strong>مطابقة</strong>
            </div>
            <div className="landing-proof-meta">الجهة المصرفية · رُصد اليوم</div>
            <p className="stat-hint" style={{ margin: 0 }}>
              مثال توضيحي لشكل الملف، لا بيانات منشأة حقيقية.
            </p>
          </aside>
        </section>

        <section className="landing-band">
          <div className="landing-section" id="services">
            <div className="landing-head">
              <h2>ما الذي نتحقق منه</h2>
              <p>
                كل خدمة تجيب سؤالاً واحداً عن المنشأة، وتُفعَّل وحدها. تختار ما يخصّ عملك ولا تدفع
                عن الباقي.
              </p>
            </div>
            <div className="landing-grid">
              {SERVICES.map((service) => (
                <article className="landing-card" key={service.title} data-role="service">
                  <span className="landing-card-mark" aria-hidden="true">
                    {service.mark}
                  </span>
                  <h3>{service.title}</h3>
                  <p>{service.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-head">
            <h2>لماذا هذا وليس ملف PDF</h2>
            <p>
              ما تستبدله هذه المنصة هو مجلدٌ من الصور والمسوحات، وأمرٌ لموظف بأن يتأكد. الفرق ليس في
              السرعة وحدها.
            </p>
          </div>
          <div className="landing-grid">
            {WHY.map((item) => (
              <article className="landing-card" key={item.title} data-role="why">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-band">
          <div className="landing-section">
            <div className="landing-head">
              <h2>كيف تبدأ</h2>
              <p>أربع خطوات، ولا مكالمة مبيعات بينها.</p>
            </div>
            <div className="landing-steps">
              {STEPS.map((step) => (
                <article className="landing-step" key={step.title} data-role="step">
                  <h3 style={{ margin: 0, fontSize: '16px' }}>{step.title}</h3>
                  <p style={{ margin: 0, color: 'var(--color-neutral-700)', lineHeight: 1.7 }}>
                    {step.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-head" style={{ marginBlockEnd: 'var(--space-4)' }}>
            <h2>للمطوّرين</h2>
            <p>
              كل ما تفعله الشاشة يفعله الـAPI: نداء واحد يعيد جواباً لا مقبضاً، مع
              <span dir="ltr"> Idempotency-Key</span> يُحترم، ورمز خطأ خاص بنا يقول إن كان يستحق
              إعادة المحاولة، ورابط دليل مختوم مع كل نتيجة. و<span dir="ltr"> Webhooks </span>
              موقّعة بإعادة محاولة حين يتغيّر شيء.
            </p>
          </div>
          <div className="landing-cta">
            <Link className="btn btn-primary" href="/signup">
              أنشئ حساباً وجرّب في بيئة الاختبار
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-section landing-foot">
        <p style={{ margin: 0 }}>
          {PRODUCT_NAME} · بنية تحقق وتأهيل للسوق السعودي. المعرّفات مشفّرة ومقنّعة، والوصول مسجَّل،
          وبيانات كل مشترك معزولة عن غيره.
        </p>
      </footer>
    </div>
  );
}
