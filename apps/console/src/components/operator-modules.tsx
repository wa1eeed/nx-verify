import type { ReactElement } from 'react';
import type { ModuleView } from '@nx-verify/core';
import { Card } from './ui/card';
import { Ltr } from './ui/ltr';
import { Table, Th } from './ui/table';
import { Tag } from './ui/tag';
import { PageHeader } from './page-header';
import { count } from './format';

/**
 * The modules the platform sells (ADR-137).
 *
 * A module is the unit a subscriber is given or refused: a named group of verification
 * products that fills one section of a customer file. This screen is the catalogue of them,
 * and it exists so the owner can answer three questions without opening a database: what does
 * each module add to a customer file, what does it sell, and how far the plans have drifted
 * from what people actually buy.
 *
 * That last figure is the useful one. A module switched by hand for thirty subscribers is a
 * module that belongs in a plan, and a plan nobody takes as written is a plan to redraw.
 *
 * Switching a module for one subscriber is done on that subscriber's own page, because it is
 * a decision about them and it belongs beside their plan and their prices.
 */

export interface ModulesView {
  modules: readonly ModuleView[];
}

export function OperatorModules({ view }: { view: ModulesView }): ReactElement {
  const drifted = view.modules.filter((module) => module.switchedOn + module.switchedOff > 0);

  return (
    <div className="admin-screen" data-role="operator-modules">
      <PageHeader
        title="الموديولات"
        subtitle="ما تبيعه المنصة كوحدات: ما يضيفه كل موديول لملف العميل، وما يحتويه من خدمات، وكم مشتركاً خرج عن باقته فيه."
      />

      <section className="admin-tiles">
        <Card role="modules-count" labelledBy="modules-count-title">
          <h2 className="card-title admin-offer-title" id="modules-count-title">
            موديولات
          </h2>
          <p className="admin-figure">
            <Ltr>{count(view.modules.length)}</Ltr>
          </p>
          <p className="admin-card-note">
            {`منها ${count(view.modules.filter((module) => !module.defaultOn).length)} إضافية لا تُمنح إلا بقرار.`}
          </p>
        </Card>
        <Card role="modules-drift" labelledBy="modules-drift-title">
          <h2 className="card-title admin-offer-title" id="modules-drift-title">
            خرجت عن الباقات
          </h2>
          <p className="admin-figure">
            <Ltr>{count(drifted.length)}</Ltr>
          </p>
          <p className="admin-card-note">
            موديولات قُرِّر فيها لمشترك أو أكثر خلاف باقته. كثرتها تعني أن الباقات لم تعد تصف السوق.
          </p>
        </Card>
      </section>

      {view.modules.map((module) => (
        <Card
          key={module.code}
          variant="flush"
          role="module"
          labelledBy={`module-${module.code}`}
          data-module={module.code}
        >
          <div className="admin-card-head">
            <h2 className="card-title admin-card-title" id={`module-${module.code}`}>
              {module.nameAr}
            </h2>
            <div className="admin-head-actions">
              <Tag tone="neutral">
                <Ltr>{module.code}</Ltr>
              </Tag>
              {module.core ? (
                <Tag tone="accent-2">أساسي، لا يُطفأ</Tag>
              ) : module.defaultOn ? (
                <Tag tone="accent">مفعّل افتراضياً</Tag>
              ) : (
                <Tag tone="neutral">إضافي، بقرار</Tag>
              )}
              {module.status === 'retired' ? <Tag tone="critical">متقاعد</Tag> : null}
            </div>
          </div>

          <p className="admin-card-note">
            {module.summaryAr}
            {module.section === null
              ? ' · لا يرسم قسماً في ملف العميل.'
              : ` · يرسم قسم «${module.nameAr}» في ملف العميل.`}
          </p>

          <div className="admin-table">
            <Table label={`خدمات ${module.nameAr}`}>
              <thead>
                <tr>
                  <Th>الخدمة</Th>
                  <Th>أين تظهر</Th>
                  <Th>حالتها</Th>
                </tr>
              </thead>
              <tbody>
                {module.products.map((product) => (
                  <tr key={product.productCode} data-role="module-product">
                    <td>
                      {product.nameAr}
                      <span className="admin-offer-terms">
                        {' · '}
                        <Ltr>{product.productCode}</Ltr>
                      </span>
                    </td>
                    <td>{product.inFile ? 'ملف العميل والواجهة البرمجية' : 'الواجهة البرمجية'}</td>
                    <td>
                      {product.availability === 'AVAILABLE' ? (
                        <Tag tone="accent-2">متاحة</Tag>
                      ) : (
                        <Tag tone="accent">قريباً</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <p className="admin-card-note" data-role="module-decisions">
            {module.switchedOn + module.switchedOff === 0
              ? 'لم يخرج أحد عن باقته في هذا الموديول.'
              : `فُعّل بقرار خاص لـ ${count(module.switchedOn)}، وعُطّل بقرار خاص لـ ${count(module.switchedOff)}.`}
          </p>
        </Card>
      ))}
    </div>
  );
}
