import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Intersection, LinkedEntity } from '@nx-verify/core';
import { RelationGraph } from '../src/components/customer-file/graph';
import {
  ENTITY_RING,
  GRAPH_CENTRE,
  HUB_RING,
  entityOffset,
  labelAt,
  litKeys,
  relationGraphModel,
  shortThrough,
} from '../src/components/customer-file/graph-model';

/**
 * The intersections map of a customer file (ADR-123): how two customers meet, drawn in rings.
 *
 * The layout is a pure function of the file, so these assert the map itself: one node for each
 * kind of shared thing, the points each kind adds to the score, customers spread so no kind is
 * left bare and never under a label, the second links of a customer tied more than once, and
 * what following a node lights.
 */

const business = (id: string, name: string): LinkedEntity => ({
  entityId: id,
  name,
  entityType: 'BUSINESS',
});

const A = business('a', 'شركة أفق للتجارة');
const B = business('b', 'مؤسسة بنيان');
const C = business('c', 'شركة رمال الشرق');
const D = business('d', 'شركة ضياء');

const INTERSECTIONS: Intersection[] = [
  {
    kind: 'SHARED_MANAGER',
    textAr: 'محمد يدير أيضاً 3 منشآت أخرى من عملائك',
    via: { entityId: 'm1', name: 'محمد', entityType: 'PERSON' },
    entities: [A, B, C],
  },
  {
    kind: 'SHARED_MANAGER',
    textAr: 'سارة تدير أيضاً منشأة أخرى من عملائك',
    via: { entityId: 'm2', name: 'سارة', entityType: 'PERSON' },
    entities: [D],
  },
  {
    kind: 'SHARED_ACCOUNT',
    textAr: 'الحساب البنكي نفسه مقدَّم أيضاً إلى عميلين آخرين',
    via: { entityId: 'acc', name: '••••••••••••••••7519', entityType: 'BANK_ACCOUNT' },
    entities: [A, B],
  },
  {
    kind: 'SHARED_ADDRESS',
    textAr: 'العنوان الوطني نفسه مسجل باسم منشأة أخرى من عملائك',
    via: null,
    entities: [C],
  },
];

const FILE = {
  displayName: 'شركة اختبار للتجارة',
  intersections: INTERSECTIONS,
  assessment: {
    riskReasons: [
      { key: 'shared_account', weight: 60 },
      { key: 'manager_many_companies', weight: 30 },
      { key: 'shared_address', weight: 14 },
    ],
  },
};

const distance = (point: { x: number; y: number }): number =>
  Math.hypot(point.x - GRAPH_CENTRE.x, point.y - GRAPH_CENTRE.y);

describe('the intersections map', () => {
  const model = relationGraphModel(FILE);

  it('meets every link of a kind at one node, the heaviest kind first', () => {
    expect(model.hubs.map((hub) => hub.kind)).toEqual([
      'SHARED_ACCOUNT',
      'SHARED_ADDRESS',
      'SHARED_MANAGER',
    ]);
    const managers = model.hubs.find((hub) => hub.kind === 'SHARED_MANAGER');
    expect(managers?.lines).toHaveLength(2);
    expect(managers?.through).toEqual(['محمد', 'سارة']);
    // Two people: no single file to open from the kind.
    expect(managers?.href).toBeNull();
    for (const hub of model.hubs) {
      expect(Math.round(distance(hub))).toBe(HUB_RING);
    }
  });

  it('says what each kind adds to the risk score, and totals the map', () => {
    const weights = Object.fromEntries(model.hubs.map((hub) => [hub.kind, hub.weight]));
    // A manager over three or more other businesses counts; the one with a single other does not.
    expect(weights).toEqual({ SHARED_ACCOUNT: 60, SHARED_ADDRESS: 14, SHARED_MANAGER: 30 });
    expect(model.hubs.find((hub) => hub.kind === 'SHARED_MANAGER')?.tone).toBe('attention');
    expect(model.hubs.find((hub) => hub.kind === 'SHARED_ACCOUNT')?.tone).toBe('critical');
    expect(model.totals).toEqual({ entities: 4, links: 4, weight: 104, clustered: 3 });
    expect(model.strongest?.kind).toBe('SHARED_ACCOUNT');
  });

  it('leaves no kind bare, and draws each customer once with its other links bent across', () => {
    for (const hub of model.hubs) {
      const home = model.entities.filter((entity) => entity.hubKeys[0] === hub.key);
      expect(home.length, hub.kind).toBeGreaterThan(0);
    }
    expect(model.entities).toHaveLength(4);
    for (const entity of model.entities) {
      expect(Math.round(distance(entity))).toBe(ENTITY_RING);
    }
    const tied = model.entities.find((entity) => entity.key === 'a');
    expect(tied?.hubKeys).toHaveLength(2);
    const second = model.edges.filter((edge) => edge.entityKey === 'a' && edge.cross);
    expect(second).toHaveLength(1);
    expect(second[0]?.path).toContain(' Q ');
  });

  it('keeps customers off the line where their kind is named', () => {
    expect(entityOffset(0, 90)).toBe(20);
    expect(entityOffset(1, 90)).toBe(-20);
    for (let position = 0; position < 5; position += 1) {
      expect(Math.abs(entityOffset(position, 90))).toBeGreaterThanOrEqual(20);
      expect(Math.abs(entityOffset(position, 90))).toBeLessThan(45);
    }
    // Right to left text: a label on the right grows rightwards from its end.
    expect(labelAt(100, 0).anchor).toBe('end');
    expect(labelAt(100, 180).anchor).toBe('start');
    expect(labelAt(100, -90).anchor).toBe('middle');
  });

  it('shortens a masked account to its last four digits, and leaves a name alone', () => {
    expect(shortThrough('••••••••••••••••7519')).toBe('••••7519');
    expect(shortThrough('محمد أحمد')).toBe('محمد أحمد');
    expect(model.hubs.find((hub) => hub.kind === 'SHARED_ACCOUNT')?.through).toEqual(['••••7519']);
  });

  it('lights what a node touches, one step away, and nothing else', () => {
    const account = litKeys(model, { type: 'hub', key: 'SHARED_ACCOUNT' });
    expect(account?.has('a')).toBe(true);
    expect(account?.has('b')).toBe(true);
    expect(account?.has('d')).toBe(false);
    expect(account?.has('inner:SHARED_ACCOUNT')).toBe(true);

    const customer = litKeys(model, { type: 'entity', key: 'c' });
    expect(customer?.has('SHARED_ADDRESS')).toBe(true);
    expect(customer?.has('SHARED_MANAGER')).toBe(true);
    expect(customer?.has('SHARED_ACCOUNT')).toBe(false);
    expect(litKeys(model, null)).toBeNull();
  });

  it('counts the customers of a kind beyond the ones it has room for', () => {
    const many = Array.from({ length: 8 }, (_, index) => business(`x${index}`, `شركة ${index}`));
    const crowded = relationGraphModel({
      ...FILE,
      intersections: [{ ...INTERSECTIONS[3], entities: many } as Intersection],
    });
    expect(crowded.entities).toHaveLength(5);
    expect(crowded.hubs[0]?.hidden).toBe(3);
  });
});

describe('the map on screen', () => {
  const html = renderToStaticMarkup(<RelationGraph model={relationGraphModel(FILE)} />);

  it('can be walked with a keyboard: every node is a button in the tab order', () => {
    const nodes = html.match(/<g[^>]*class="rg-node[^"]*"[^>]*>/g) ?? [];
    expect(nodes).toHaveLength(7);
    for (const node of nodes) {
      expect(node).toContain('tabindex="0"');
      expect(node).toContain('role="button"');
      expect(node).toMatch(/aria-label="[^"]+"/);
    }
  });

  it('shows the totals, a chip for each kind with its count, and where to start', () => {
    expect(html).toContain('data-role="relation-totals"');
    expect(html).toContain('<bdi dir="ltr" class="ltr">+104</bdi>');
    expect(html.match(/class="rg-legend-item"/g)).toHaveLength(3);
    expect(html).toContain('أقوى رابط: الحساب البنكي نفسه مقدَّم أيضاً إلى عميلين آخرين');
    expect(html).toContain('data-role="relation-details"');
    expect(html).not.toContain(String.fromCharCode(0x2014));
  });

  it('draws nothing for a file with no intersections', () => {
    expect(
      renderToStaticMarkup(
        <RelationGraph model={relationGraphModel({ ...FILE, intersections: [] })} />,
      ),
    ).toBe('');
  });
});
