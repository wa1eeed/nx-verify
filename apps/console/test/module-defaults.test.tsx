import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModuleView } from '@nx-verify/core';
import { OperatorModules } from '../src/components/operator-modules';
import { moduleNoticeAr } from '../src/app/operator/(panel)/pricing/modules/notice';

/**
 * The platform default on the modules catalogue.
 *
 * The screen could read `modules.default_on` and nothing could write it, so the answer for
 * every subscriber whose plan is silent came from the seed file. A module is rows (rule 8) and
 * this was the one column of it with no way in.
 *
 * What is asserted here is mostly the sentence, because the sentence is where this control can
 * mislead. A default reads as «what new subscribers start with», and it is not: nothing is
 * copied onto a workspace at onboarding, so the column keeps answering and a change to it moves
 * every subscriber who is inheriting, the moment it is saved.
 */

const noop = async (): Promise<void> => {};

const moduleView = (over: Partial<ModuleView> = {}): ModuleView => ({
  code: 'PROPERTY',
  nameAr: 'العقار',
  nameEn: 'Property',
  summaryAr: 'الصك العقاري: رقمه ومالكه ووصف العقار.',
  section: 'PROPERTY',
  position: 7,
  core: false,
  defaultOn: false,
  status: 'active',
  products: [
    {
      productCode: 'PROPERTY_DEED',
      nameAr: 'الصك العقاري',
      availability: 'AVAILABLE',
      inFile: false,
    },
  ],
  switchedOn: 0,
  switchedOff: 0,
  inheritingDefault: 12,
  ...over,
});

const render = (modules: ModuleView[], canEdit: boolean): string =>
  renderToStaticMarkup(
    <OperatorModules view={{ modules, canEdit }} setDefault={canEdit ? noop : undefined} />,
  );

describe('the platform default on the modules catalogue', () => {
  it('says how many subscribers take the module from the default, and that a change moves them now', () => {
    const html = render([moduleView()], true);
    expect(html).toContain('data-role="module-default"');
    expect(html).toContain('يأخذها اليوم من الافتراضي');
    // The correction that stops this reading as a setting for future subscribers only.
    expect(html).toContain('يغيّر إجابتهم في الحال');
    expect(html).toContain('لا يُنسخ شيء على مساحة العمل عند إنشائها');
  });

  it('offers the flip the module is not already on, and only that one', () => {
    expect(render([moduleView()], true)).toContain('اجعلها افتراضية');
    expect(render([moduleView({ defaultOn: true })], true)).toContain('اجعلها بقرار');
  });

  it('offers no control at all on the module every customer file is drawn from', () => {
    // Core is on for everybody and the table refuses any other default, so a button here could
    // only ever be refused.
    const html = render([moduleView({ code: 'REGISTRY', core: true, defaultOn: true })], true);
    expect(html).not.toContain('data-role="module-default"');
  });

  it('shows the catalogue and no control to a role that may look and not change', () => {
    const html = render([moduleView()], false);
    expect(html).toContain('العقار');
    expect(html).toContain('يأخذها اليوم من الافتراضي');
    expect(html).not.toContain('اجعلها افتراضية');
  });
});

describe('what the screen says after a change to a default', () => {
  it('names the module and how many subscribers moved with it', () => {
    expect(moduleNoticeAr({ saved: 'on', name: 'العقار', moved: '12' })?.text).toContain(
      'صارت «العقار» تُمنح افتراضياً',
    );
    expect(moduleNoticeAr({ saved: 'off', name: 'العقار', moved: '12' })?.text).toContain(
      'لا تُمنح إلا بقرار',
    );
    expect(moduleNoticeAr({ saved: 'on', name: 'العقار', moved: '12' })?.text).toContain('12');
  });

  it('does not claim it moved somebody when it moved nobody', () => {
    const notice = moduleNoticeAr({ saved: 'on', name: 'العقار', moved: '0' });
    expect(notice?.text).toContain('لم تتغيّر إجابة أحد');
  });

  it('says plainly when a press changed nothing, rather than reporting a save', () => {
    expect(moduleNoticeAr({ saved: 'unchanged', name: 'العقار' })?.text).toContain(
      'كانت على هذا الافتراضي أصلاً',
    );
  });

  it('gives each refusal its own reason', () => {
    expect(moduleNoticeAr({ refused: 'role' })).toMatchObject({ tone: 'refused' });
    expect(moduleNoticeAr({ refused: 'core' })?.text).toContain('أساس كل ملف عميل');
    expect(moduleNoticeAr({ refused: 'unknown' })?.text).toContain('لا توجد وحدة بهذا الرمز');
  });

  it('says nothing when nothing just happened', () => {
    expect(moduleNoticeAr({})).toBeNull();
  });
});
