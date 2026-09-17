import type { ReactElement } from 'react';
import { PageHeader, Panel } from './page-header';
import { SubmitButton } from './ui/submit-button';

/**
 * The first screen after an account is made (ADR-154).
 *
 * It asks one question, which is the question a new subscriber can actually answer: which of
 * these do you need. Everything else about the platform can wait until they have used it once.
 *
 * Switching an add-on on costs nothing, and that is why a subscriber is allowed to do it
 * themselves: a module decides which sections their customer files draw and which products
 * their calls may use, and every one of those spends from a wallet somebody has to fund. Turn
 * everything on with no balance and you have bought exactly nothing.
 *
 * The core module is shown, switched on, and not offered as a choice, because it is not one:
 * every customer file is built on it.
 */

export interface WelcomeModuleView {
  code: string;
  nameAr: string;
  summaryAr: string;
  core: boolean;
  enabled: boolean;
  products: { code: string; nameAr: string }[];
}

export function Welcome({
  modules,
  legalName,
  toggleAction,
  doneHref = '/billing',
}: {
  modules: WelcomeModuleView[];
  legalName: string;
  toggleAction: (formData: FormData) => void | Promise<void>;
  doneHref?: string;
}): ReactElement {
  const chosen = modules.filter((module) => module.enabled).length;

  return (
    <section className="stack" data-role="welcome" style={{ gap: 'var(--s-5)' }}>
      <PageHeader
        title={`أهلاً، ${legalName}`}
        subtitle="اختر خدمات التحقق التي تحتاجها. تُغيّرها متى شئت، ولا تُحاسَب إلا على ما تشغّله فعلاً."
      />

      <p className="card muted" data-role="welcome-notice">
        تفعيل خدمة لا يكلّف شيئاً بذاته: التكلفة عند تشغيل تحقق. الخطوة التالية بعد الاختيار هي شحن
        رصيدك، وبدونه لا تعمل أي عملية.
      </p>

      <Panel title="خدمات التحقق" aside={`${chosen} مفعّلة`}>
        <div className="panel-body stack" style={{ gap: 'var(--s-3)' }}>
          {modules.map((module) => (
            <article
              key={module.code}
              className="stack channel-card"
              data-role="welcome-module"
              data-item={module.code}
              data-enabled={module.enabled ? 'true' : 'false'}
              style={{ gap: 'var(--s-2)' }}
            >
              <div
                className="row"
                style={{ gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'baseline' }}
              >
                <strong>{module.nameAr}</strong>
                {module.core ? (
                  <span className="badge" data-role="core-module">
                    أساسي · مفعّل دائماً
                  </span>
                ) : (
                  <span className="badge" data-enabled={module.enabled ? 'true' : 'false'}>
                    {module.enabled ? 'مفعّل' : 'غير مفعّل'}
                  </span>
                )}
                {module.core ? null : (
                  <form action={toggleAction} style={{ marginInlineStart: 'auto' }}>
                    <input type="hidden" name="module_code" value={module.code} />
                    <input type="hidden" name="enabled" value={module.enabled ? 'false' : 'true'} />
                    <SubmitButton
                      variant={module.enabled ? 'ghost' : 'secondary'}
                      data-role={module.enabled ? 'disable-module' : 'enable-module'}
                      pendingLabel="جارٍ الحفظ"
                    >
                      {module.enabled ? 'عطّل' : 'فعّل'}
                    </SubmitButton>
                  </form>
                )}
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {module.summaryAr}
              </p>
              {module.products.length === 0 ? null : (
                <p className="stat-hint" style={{ margin: 0 }}>
                  يشمل: {module.products.map((product) => product.nameAr).join('، ')}
                </p>
              )}
            </article>
          ))}
        </div>
      </Panel>

      <div className="row" style={{ gap: 'var(--s-3)' }}>
        <a className="btn btn-primary" href={doneHref} data-role="welcome-done">
          تابع إلى شحن الرصيد
        </a>
      </div>
    </section>
  );
}
