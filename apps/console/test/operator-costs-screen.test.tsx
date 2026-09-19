import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperatorCosts, type CostsView } from '../src/components/operator-costs';

/**
 * What each provider call costs us (ADR-166).
 *
 * The screen the panel was missing. Every margin it shows is arithmetic on this table, and it
 * could only be read. These check the two things a bare list of numbers would not have said.
 */

const noop = async (): Promise<void> => {};

function view(over: Partial<CostsView> = {}): CostsView {
  return {
    costs: [
      {
        provider: 'wathq',
        providerNameAr: 'واثق',
        endpoint: 'corporate_full',
        billedHalalas: 10_00,
        vatBps: 1500,
        effectiveHalalas: 10_00,
        usedByProducts: 9,
      },
      {
        provider: 'wathq',
        providerNameAr: 'واثق',
        endpoint: 'retired_call',
        billedHalalas: 4_00,
        vatBps: 1500,
        effectiveHalalas: 4_00,
        usedByProducts: 0,
      },
    ],
    unpriced: [
      { provider: 'wathq', providerNameAr: 'واثق', endpoint: 'national_address', usedByProducts: 3 },
    ],
    vatRegistered: false,
    canEdit: true,
    notice: null,
    ...over,
  };
}

describe('the provider cost screen', () => {
  const render = (over: Partial<CostsView> = {}) =>
    renderToStaticMarkup(<OperatorCosts view={view(over)} saveAction={noop} />);

  it('puts the calls with no cost before the table, not after it', () => {
    const html = render();
    // A product whose cost is unknown has a margin the platform is inventing, and a reader who
    // never scrolls past the priced rows would not see it.
    expect(html.indexOf('data-role="unpriced-calls"')).toBeLessThan(
      html.indexOf('data-role="cost-table"'),
    );
    expect(html).toContain('national_address');
  });

  it('shows how many products each rate touches', () => {
    // Raising one endpoint by a riyal is a different decision at one product and at nine.
    const html = render();
    expect(html).toContain('9');
    expect(html).toContain('منتج');
  });

  it('says the provider tax is ours while the platform is unregistered', () => {
    const html = render();
    expect(html).toContain('تكلفةٌ علينا بالكامل');
    expect(html).toContain('ضريبته لا تُسترد اليوم');
  });

  it('says the tax is reclaimable once the platform is registered', () => {
    const html = render({
      vatRegistered: true,
      costs: [
        {
          provider: 'wathq',
          providerNameAr: 'واثق',
          endpoint: 'corporate_full',
          billedHalalas: 11_50,
          vatBps: 1500,
          effectiveHalalas: 10_00,
          usedByProducts: 9,
        },
      ],
    });
    expect(html).toContain('تُسترد');
    expect(html).not.toContain('ضريبته لا تُسترد اليوم');
  });

  it('offers nothing to press for a role that may not price', () => {
    const html = render({ canEdit: false });
    expect(html).not.toContain('سجّلها');
    expect(html).not.toContain('type="submit"');
  });

  it('says what an empty cost book means rather than showing an empty table', () => {
    const html = render({ costs: [], unpriced: [] });
    expect(html).toContain('data-role="empty-state"');
    expect(html).toContain('محسوبٌ على صفر');
  });
});
