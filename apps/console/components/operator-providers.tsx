import type { ReactElement } from 'react';

/**
 * The operator's view of who serves whom.
 *
 * This is the only screen in the product that names a provider, and it is the only one a
 * subscriber cannot open. Everything on it is configuration: which provider, under whose
 * account, in what order, and whether it is switched on.
 */

export interface OperatorBindingRow {
  tenantId: string;
  tenantName: string;
  slug: string;
  provider: string;
  mode: 'MANAGED' | 'BYOC';
  priority: number;
  endpoints: string[] | null;
  healthStatus: string;
  activated: boolean;
}

export interface CatalogRow {
  code: string;
  nameAr: string;
  endpoints: string[];
  status: 'active' | 'suspended';
}

const HEALTH_LABELS: Record<string, string> = {
  healthy: 'سليم',
  degraded: 'متعثّر',
  down: 'متوقف',
  unknown: 'لم يُفحص',
};

export function OperatorProviders({
  catalog,
  bindings,
}: {
  catalog: CatalogRow[];
  bindings: OperatorBindingRow[];
}): ReactElement {
  const byTenant = new Map<string, OperatorBindingRow[]>();
  for (const binding of bindings) {
    byTenant.set(binding.tenantId, [...(byTenant.get(binding.tenantId) ?? []), binding]);
  }

  return (
    <div className="stack">
      <h1>المزودون</h1>

      <p className="muted" data-role="operator-notice">
        هذي الشاشة للمشغّل. المشترك لا يرى اسم أي مزوّد، لا هنا ولا في أي استجابة، وهذا ما تفرضه
        القاعدة 5.
      </p>

      <section className="card stack" data-role="catalog">
        <strong>الكتالوج</strong>
        <table>
          <thead>
            <tr>
              <th>المزوّد</th>
              <th>الخدمات</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((entry) => (
              <tr key={entry.code} data-status={entry.status}>
                <td>{entry.nameAr}</td>
                <td className="muted">{entry.endpoints.join('، ')}</td>
                <td>{entry.status === 'active' ? 'مفعّل' : 'موقوف'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {catalog.length === 0 ? <p className="muted">لا مزودين في الكتالوج بعد.</p> : null}
      </section>

      <section className="card stack" data-role="bindings">
        <strong>الربط لكل مشترك</strong>
        <p className="muted">
          الأقل رقماً يُستدعى أولاً. المزوّد المربوط غير المفعّل جاهز ولا يُستدعى، وهو الجواب على
          سؤال «ماذا لو انقطع مزودكم».
        </p>
        <table>
          <thead>
            <tr>
              <th>المشترك</th>
              <th>المزوّد</th>
              <th>الحساب</th>
              <th>الأولوية</th>
              <th>الخدمات</th>
              <th>الصحة</th>
              <th>مفعّل</th>
            </tr>
          </thead>
          <tbody>
            {bindings.map((binding) => (
              <tr
                key={`${binding.tenantId}-${binding.provider}`}
                data-mode={binding.mode}
                data-activated={binding.activated ? 'true' : 'false'}
              >
                <td>
                  {binding.tenantName}
                  <span className="muted">
                    {' '}
                    <bdi dir="ltr" className="mono">
                      {binding.slug}
                    </bdi>
                  </span>
                </td>
                <td>{binding.provider}</td>
                <td>{binding.mode === 'MANAGED' ? 'حسابنا' : 'حساب المشترك'}</td>
                <td>
                  <bdi dir="ltr" className="mono">
                    {binding.priority}
                  </bdi>
                </td>
                <td className="muted">
                  {binding.endpoints === null ? 'كل الخدمات' : binding.endpoints.join('، ')}
                </td>
                <td>{HEALTH_LABELS[binding.healthStatus] ?? binding.healthStatus}</td>
                <td>{binding.activated ? 'نعم' : 'لا'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {bindings.length === 0 ? <p className="muted">لا ربط بعد.</p> : null}
      </section>

      <div className="row">
        <button type="submit" className="btn-primary">
          حفظ الربط
        </button>
      </div>
    </div>
  );
}
