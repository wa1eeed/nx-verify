import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Button,
  ButtonLink,
  Card,
  CardTitle,
  Checkbox,
  Dialog,
  Field,
  ICONS,
  ICON_STROKE,
  Icon,
  IconButton,
  Input,
  Ltr,
  Radio,
  STATE_TONES,
  Segmented,
  StateTag,
  Tag,
  Table,
  Th,
} from '../src/components/ui';

/**
 * Handoff phase 1: the component layer.
 *
 * Each component is asserted against the Organic class it shells, because the sheet, not
 * the component, owns how a thing looks. The design check from the handoff runs here too, so
 * a raw colour or radius in the console fails the suite and not only a script somebody has
 * to remember to run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const consoleRoot = join(here, '..');
const repoRoot = join(consoleRoot, '..', '..');

const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element);

describe('Button', () => {
  it('is secondary unless somebody chooses the primary', () => {
    expect(html(<Button>حفظ كمسودة</Button>)).toContain('class="btn btn-secondary"');
    expect(html(<Button variant="primary">تحقق من الكل</Button>)).toContain(
      'class="btn btn-primary"',
    );
    expect(html(<Button variant="ghost">عرض</Button>)).toContain('class="btn btn-ghost"');
  });

  it('never submits a form by accident', () => {
    expect(html(<Button>تحقق</Button>)).toContain('type="button"');
    expect(html(<Button type="submit">تحقق</Button>)).toContain('type="submit"');
  });

  it('keeps the prototype order: leading icon before the words, trailing icon after', () => {
    const leading = html(<Button icon="plus">تحقق جديد</Button>);
    expect(leading.indexOf('<svg')).toBeLessThan(leading.indexOf('تحقق جديد'));

    const trailing = html(<Button iconEnd="arrow-left">متابعة</Button>);
    expect(trailing.indexOf('<svg')).toBeGreaterThan(trailing.indexOf('متابعة'));
  });

  it('draws its icons at the system stroke and hides them from screen readers', () => {
    const markup = html(<Button icon="download">تصدير التقرير</Button>);
    expect(markup).toContain(`stroke-width="${ICON_STROKE}"`);
    expect(markup).toContain('aria-hidden="true"');
  });

  it('cannot be pressed twice while its submission is under way', () => {
    const markup = html(
      <Button variant="primary" pending>
        تحقق من الكل
      </Button>,
    );
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
  });

  it('spans the width when asked, as under the balance', () => {
    expect(html(<Button block>شراء رصيد</Button>)).toContain('class="btn btn-secondary btn-block"');
  });

  it('as a link goes somewhere and submits nothing', () => {
    const markup = html(
      <ButtonLink href="/verifications/new" variant="primary" icon="plus">
        تحقق جديد
      </ButtonLink>,
    );
    expect(markup).toMatch(/^<a href="\/verifications\/new" class="btn btn-primary">/);
    expect(markup).not.toContain('<button');
  });

  it('as an icon alone carries its words for screen readers', () => {
    const markup = html(<IconButton icon="x" label="إغلاق" />);
    expect(markup).toContain('class="btn btn-ghost btn-icon"');
    expect(markup).toContain('aria-label="إغلاق"');
  });
});

describe('Icon', () => {
  it('offers every icon the handoff names, at one stroke', () => {
    const handoff = [
      'layout-dashboard',
      'users',
      'badge-check',
      'wallet',
      'settings',
      'plus',
      'download',
      'refresh-cw',
      'arrow-left',
      'check',
      'alert-triangle',
      'clock',
      'info',
      'building-2',
      'tag',
      'sliders-horizontal',
      'bar-chart-3',
      'shield',
    ];
    for (const name of handoff) {
      expect(Object.keys(ICONS)).toContain(name);
    }
    expect(ICON_STROKE).toBe(2.75);
  });

  it('is named for screen readers only when it stands alone', () => {
    expect(html(<Icon name="info" label="معلومة" />)).toContain('aria-label="معلومة"');
    expect(html(<Icon name="info" />)).toContain('aria-hidden="true"');
  });

  it('is imported by no screen directly, so the stroke cannot drift', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/\.(ts|tsx)$/.test(name) && !path.endsWith(join('ui', 'icon.tsx'))) {
          if (readFileSync(path, 'utf8').includes("from 'lucide-react'")) offenders.push(path);
        }
      }
    };
    walk(join(consoleRoot, 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('Tag', () => {
  it('shells the sheet tag classes by tone', () => {
    expect(html(<Tag tone="accent-2">مُتحقق</Tag>)).toBe(
      '<span class="tag tag-accent-2">مُتحقق</span>',
    );
    expect(html(<Tag>غير مطبّق</Tag>)).toContain('class="tag tag-neutral"');
    expect(html(<Tag tone="outline">تنبيهات مفتوحة · 4</Tag>)).toContain('class="tag tag-outline"');
  });

  it('keeps expired neutral and a change or conflict in the accent, never the same', () => {
    expect(STATE_TONES.EXPIRED).toBe('neutral');
    expect(STATE_TONES.CHANGED).toBe('accent');
    expect(STATE_TONES.CONFLICT).toBe('accent');
    expect(STATE_TONES.EXPIRED).not.toBe(STATE_TONES.CHANGED);
  });

  it('follows the README tags: verified sage, in progress neutral, a mismatch the accent', () => {
    expect(html(<StateTag state="VERIFIED">مُتحقق</StateTag>)).toContain('tag-accent-2');
    expect(html(<StateTag state="PROCESSING">قيد المعالجة</StateTag>)).toContain('tag-neutral');
    expect(html(<StateTag state="MISMATCH">اسم غير مطابق</StateTag>)).toContain('tag-accent');
  });
});

describe('Input and Field', () => {
  it('types identifiers left to right without restyling itself', () => {
    const markup = html(<Input name="unn" ltr inputMode="numeric" />);
    expect(markup).toContain('class="input input-ltr"');
    expect(markup).toContain('dir="ltr"');
    expect(html(<Input name="name" />)).toContain('class="input"');
  });

  it('ties the label, the hint and the error to the control', () => {
    const markup = html(
      <Field id="unn" label="رقم السجل التجاري" hint="عشرة أرقام" error="الرقم غير صحيح">
        {(control) => <Input {...control} name="unn" ltr />}
      </Field>,
    );
    expect(markup).toContain('<label for="unn">رقم السجل التجاري</label>');
    expect(markup).toContain('id="unn"');
    expect(markup).toContain('aria-describedby="unn-error unn-hint"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('<p class="field-error" id="unn-error" role="alert">');
    expect(markup).toContain('<p class="field-hint" id="unn-hint">');
  });

  it('leaves a field that is fine unmarked', () => {
    const markup = html(
      <Field id="iban" label="الآيبان">
        {(control) => <Input {...control} name="iban" ltr />}
      </Field>,
    );
    expect(markup).not.toContain('aria-invalid');
    expect(markup).not.toContain('aria-describedby');
  });
});

describe('Choices', () => {
  it('draws the checkbox over a native input that submits with its form', () => {
    const markup = html(
      <Checkbox name="checks" value="CR_FULL" defaultChecked>
        السجل التجاري
      </Checkbox>,
    );
    expect(markup).toMatch(/^<label class="check"><input [^>]*type="checkbox"/);
    expect(markup).toMatch(/<input [^>]*name="checks"[^>]*value="CR_FULL"/);
    expect(markup).toContain('checked=""');
    expect(markup).toContain('<span class="box" aria-hidden="true">');
  });

  it('draws the radio with its dot', () => {
    const markup = html(
      <Radio name="kind" value="company">
        شركة
      </Radio>,
    );
    expect(markup).toContain('<label class="radio">');
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('<span class="dot" aria-hidden="true"></span>');
  });

  it('groups the segments as one named choice with the default chosen', () => {
    const markup = html(
      <Segmented
        name="kind"
        label="نوع الكيان"
        defaultValue="company"
        options={[
          { value: 'company', label: 'شركة' },
          { value: 'establishment', label: 'مؤسسة' },
          { value: 'freelancer', label: 'عامل حر' },
        ]}
      />,
    );
    expect(markup).toContain('<div class="seg" role="radiogroup" aria-label="نوع الكيان">');
    expect(markup.match(/class="seg-opt"/g)).toHaveLength(3);
    expect(markup.match(/checked=""/g)).toHaveLength(1);
    const chosen = /<input [^>]*checked=""[^>]*>/.exec(markup)?.[0] ?? '';
    expect(chosen).toContain('value="company"');
  });
});

describe('Card', () => {
  it('is a 28px panel by default and a 26px figure when it is a stat', () => {
    expect(html(<Card>x</Card>)).toBe('<section class="card card-panel">x</section>');
    expect(
      html(
        <Card variant="stat" tone="accent-2" as="div">
          x
        </Card>,
      ),
    ).toBe('<div class="card card-stat card-tone-accent-2">x</div>');
  });

  it('titles itself with a heading, so a screen reader can move between sections', () => {
    expect(html(<CardTitle>البيانات الأساسية</CardTitle>)).toBe(
      '<h3 class="card-title">البيانات الأساسية</h3>',
    );
  });
});

describe('Table', () => {
  it('scrolls on its own and scopes every header to its column', () => {
    const markup = html(
      <Table label="أحدث عمليات التحقق">
        <thead>
          <tr>
            <Th>العميل</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <Ltr>1010234567</Ltr>
            </td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(markup).toMatch(/^<div class="table-scroll"><table class="table" aria-label=/);
    expect(markup).toContain('<th scope="col">العميل</th>');
    expect(markup).toContain('<bdi dir="ltr" class="ltr">1010234567</bdi>');
  });
});

describe('Dialog', () => {
  it('is a native dialog named by its title, closed until opened', () => {
    const markup = html(
      <Dialog
        open={false}
        onClose={() => undefined}
        title="شراء رصيد"
        actions={<Button>إلغاء</Button>}
      >
        نص
      </Dialog>,
    );
    expect(markup).toMatch(/^<dialog class="dialog-backdrop" aria-labelledby="([^"]+)">/);
    const id = /aria-labelledby="([^"]+)"/.exec(markup)?.[1];
    expect(markup).toContain(`<h2 class="dialog-title" id="${id}">شراء رصيد</h2>`);
    expect(markup).not.toContain(' open=');
    expect(markup).toContain('<div class="dialog-actions">');
  });
});

describe('The dark ground of the administration panel', () => {
  it('gives every tinted tag and card its own dark fill, so no words vanish on it', () => {
    const product = readFileSync(join(consoleRoot, 'src', 'styles', 'product.css'), 'utf8');
    const tinted = [
      'tag-accent',
      'tag-accent-2',
      'tag-neutral',
      'tag-critical',
      'card-tone-accent',
      'card-tone-accent-2',
      'card-tone-attention',
    ];
    for (const name of tinted) {
      expect(product).toMatch(new RegExp(`\\[data-theme='dark'\\] \\.${name} \\{\\s*background:`));
    }
  });
});

describe('The design check from the handoff', () => {
  it('finds no raw colour, radius, shadow or font in the console', () => {
    const run = spawnSync(process.execPath, [join(repoRoot, 'verify', 'check-design.mjs')], {
      cwd: consoleRoot,
      encoding: 'utf8',
    });
    expect(run.stdout).toContain('لا مخالفات توكنات');
    expect(run.status).toBe(0);
  });

  it('keeps the token sheet as delivered, with the product block only appended after it', () => {
    const delivered = readFileSync(
      join(repoRoot, 'design_handoff_verification_platform', 'design-system', 'styles.css'),
      'utf8',
    );
    const sheet = readFileSync(join(consoleRoot, 'src', 'styles', 'organic.css'), 'utf8');
    expect(sheet.startsWith(delivered)).toBe(true);
    expect(sheet.slice(delivered.length)).toContain('NX Trust product tokens');
  });
});
