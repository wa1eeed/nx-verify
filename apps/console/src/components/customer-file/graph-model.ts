import type { CustomerFile, Intersection, IntersectionKind, LinkedEntity } from '@nx-verify/core';
import type { IconName } from '../ui/icon';

/**
 * The intersections of a customer file, laid out as a map (ADR-123).
 *
 * Three rings, each a step of the explanation: the customer in the middle, then the kinds of
 * thing they share (managers, partners, a bank account, an address), then the other customers
 * who share them. So the drawing says how two customers meet, not only that they do. Every
 * link of one kind meets at one node, so three shared managers are one «مدير مشترك» with the
 * three names in its details rather than three nodes fighting for room. A customer reached
 * through two kinds sits once, and the second link bends across to it: customers tied to
 * this one more than once are the pattern worth seeing.
 *
 * Labels sit outside their node, away from the middle, so the rings stay clear. Pure and
 * deterministic, so the drawing is tested without a browser.
 */

export type LinkTone = 'critical' | 'attention' | 'info';
export type LabelAnchor = 'start' | 'middle' | 'end';

export interface GraphLabel {
  x: number;
  y: number;
  anchor: LabelAnchor;
}

export interface GraphHub {
  key: string;
  kind: IntersectionKind;
  labelAr: string;
  /** Who or what the links run through: the managers' names, the masked account. */
  through: string[];
  /** Each link of this kind, in words. */
  lines: string[];
  icon: IconName;
  tone: LinkTone;
  /** What these links add to the file's risk score, zero when they add nothing. */
  weight: number;
  /** The file of the one person the links run through, when there is exactly one. */
  href: string | null;
  x: number;
  y: number;
  label: GraphLabel;
  /** Where the points it adds sit: towards the middle, clear of the label outside. */
  badge: { x: number; y: number };
  entityKeys: string[];
  /** Customers sharing it beyond the ones drawn. */
  hidden: number;
  order: number;
}

export interface GraphEntity {
  key: string;
  name: string;
  short: string;
  typeAr: string;
  href: string;
  person: boolean;
  x: number;
  y: number;
  label: GraphLabel;
  hubKeys: string[];
  order: number;
}

export interface GraphEdge {
  key: string;
  hubKey: string;
  entityKey: string | null;
  path: string;
  tone: LinkTone;
  width: number;
  /** A second link to a customer drawn under another kind. */
  cross: boolean;
  order: number;
}

export interface RelationGraphModel {
  centre: { x: number; y: number; words: string[]; name: string };
  hubs: GraphHub[];
  entities: GraphEntity[];
  edges: GraphEdge[];
  totals: { entities: number; links: number; weight: number; clustered: number };
  strongest: GraphHub | null;
}

export const GRAPH_SIZE = { width: 400, height: 360 };
export const GRAPH_CENTRE = { x: 200, y: 180 };
export const HUB_RING = 80;
export const ENTITY_RING = 136;
const HUB_LABEL_RING = HUB_RING + 29;
const ENTITY_LABEL_RING = ENTITY_RING + 21;
const MAX_PER_HUB = 5;
const BADGE_OFFSET = 27;

const KINDS: Readonly<
  Record<IntersectionKind, { labelAr: string; icon: IconName; tone: LinkTone }>
> = {
  SHARED_ACCOUNT: { labelAr: 'حساب بنكي مشترك', icon: 'landmark', tone: 'critical' },
  SHARED_ADDRESS: { labelAr: 'عنوان وطني مشترك', icon: 'map-pin', tone: 'attention' },
  SHARED_MANAGER: { labelAr: 'مدير مشترك', icon: 'user-round', tone: 'info' },
  SHARED_PARTNER: { labelAr: 'شريك مشترك', icon: 'handshake', tone: 'info' },
  MANAGER_IS_CUSTOMER: { labelAr: 'مدير عميل لديك', icon: 'user-round', tone: 'info' },
  MANAGES: { labelAr: 'مدير في', icon: 'briefcase', tone: 'info' },
  PARTNER_IN: { labelAr: 'شريك في', icon: 'handshake', tone: 'info' },
};

/** The order kinds take round the ring: what weighs most first, at the top. */
const KIND_ORDER: readonly IntersectionKind[] = [
  'SHARED_ACCOUNT',
  'SHARED_ADDRESS',
  'SHARED_MANAGER',
  'SHARED_PARTNER',
  'MANAGER_IS_CUSTOMER',
  'MANAGES',
  'PARTNER_IN',
];

const TYPES_AR: Readonly<Record<string, string>> = {
  BUSINESS: 'منشأة',
  PERSON: 'فرد',
  FREELANCER: 'عامل حر',
  BANK_ACCOUNT: 'حساب بنكي',
  PROPERTY: 'عقار',
};

/** The words a node has room for: the name without its legal form, two words at most. */
export function nodeWords(name: string | null): string[] {
  if (name === null || name.trim() === '') {
    return ['بلا اسم'];
  }
  const words = name
    .split(/\s+/)
    .filter((word) => word !== '' && word !== 'شركة' && word !== 'مؤسسة');
  return (words.length === 0 ? [name.trim()] : words).slice(0, 2);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function onRing(radius: number, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: round(GRAPH_CENTRE.x + radius * Math.cos(radians)),
    y: round(GRAPH_CENTRE.y + radius * Math.sin(radians)),
  };
}

/**
 * Where the n-th customer of a kind sits, in degrees from the kind's own direction: to either
 * side in turn and never straight out, because straight out is where the kind's label is.
 */
export function entityOffset(position: number, sector: number): number {
  const half = sector / 2;
  const first = Math.min(20, half * 0.45);
  const step = Math.min(20, (half * 0.9 - first) / 2);
  const side = position % 2 === 0 ? 1 : -1;
  return round(side * (first + Math.floor(position / 2) * step));
}

/** A masked account number, shortened to what a label has room for. */
export function shortThrough(name: string): string {
  const digits = /(\d{4})\s*$/.exec(name);
  return /^[•*\s\d]+$/.test(name) && digits !== null ? `••••${digits[1]}` : name;
}

/**
 * A label outside its node, on the far side from the middle. The text is right to left, so
 * a label to the right of the middle is anchored at its end and one to the left at its start,
 * which in both cases lets it grow away from the rings.
 */
export function labelAt(radius: number, degrees: number): GraphLabel {
  const point = onRing(radius, degrees);
  const cos = Math.cos((degrees * Math.PI) / 180);
  return { ...point, anchor: cos > 0.3 ? 'end' : cos < -0.3 ? 'start' : 'middle' };
}

function weightOf(
  kind: IntersectionKind,
  intersections: readonly Intersection[],
  reasons: readonly { key: string; weight: number }[],
): number {
  const weightFor = (key: string): number =>
    reasons.find((reason) => reason.key === key)?.weight ?? 0;
  if (kind === 'SHARED_ACCOUNT') return weightFor('shared_account');
  if (kind === 'SHARED_ADDRESS') return weightFor('shared_address');
  if (kind === 'SHARED_MANAGER') {
    // One reason for each manager with three or more other businesses here.
    const many = intersections.filter((entry) => entry.entities.length >= 3).length;
    return many === 0 ? 0 : weightFor('manager_many_companies') * many;
  }
  return 0;
}

export function relationGraphModel(
  file: Pick<CustomerFile, 'displayName' | 'intersections'> & {
    assessment: { riskReasons: readonly { key: string; weight: number }[] };
  },
): RelationGraphModel {
  const byKind = new Map<IntersectionKind, Intersection[]>();
  for (const intersection of file.intersections) {
    byKind.set(intersection.kind, [...(byKind.get(intersection.kind) ?? []), intersection]);
  }
  const kinds = KIND_ORDER.filter((kind) => byKind.has(kind));
  const count = kinds.length;
  const start = -90 + (count % 2 === 0 && count > 0 ? 180 / count : 0);
  const sector = count === 0 ? 360 : 360 / count;

  const hubs: GraphHub[] = [];
  const angles = new Map<IntersectionKind, number>();
  const members = new Map<string, { entity: LinkedEntity; kinds: IntersectionKind[] }>();

  // The kinds, evenly round the ring, and every kind each customer is reached through.
  kinds.forEach((kind, index) => {
    const group = byKind.get(kind) ?? [];
    const meta = KINDS[kind];
    const angle = start + index * sector;
    angles.set(kind, angle);
    const weight = weightOf(kind, group, file.assessment.riskReasons);
    const vias = group.flatMap((entry) => (entry.via === null ? [] : [entry.via]));
    const people = vias.filter((via) => via.entityType !== 'BANK_ACCOUNT');
    const at = onRing(HUB_RING, angle);
    const radians = (angle * Math.PI) / 180;
    hubs.push({
      key: kind,
      kind,
      labelAr: meta.labelAr,
      through: [
        ...new Set(
          vias
            .map((via) => via.name)
            .filter((name): name is string => name !== null)
            .map(shortThrough),
        ),
      ],
      lines: group.map((entry) => entry.textAr),
      icon: meta.icon,
      tone: weight >= 30 && meta.tone === 'info' ? 'attention' : meta.tone,
      weight,
      href: people.length === 1 && people[0] ? `/customers/${people[0].entityId}` : null,
      ...at,
      label: labelAt(HUB_LABEL_RING, angle),
      // Beside the node along the ring: the label is outside it and the link inside.
      badge: {
        x: round(at.x - Math.sin(radians) * BADGE_OFFSET),
        y: round(at.y + Math.cos(radians) * BADGE_OFFSET),
      },
      entityKeys: [],
      hidden: 0,
      order: index,
    });
    for (const entity of group.flatMap((entry) => entry.entities)) {
      const member = members.get(entity.entityId) ?? { entity, kinds: [] };
      if (!member.kinds.includes(kind)) {
        member.kinds.push(kind);
      }
      members.set(entity.entityId, member);
    }
  });

  // Each customer sits under the kind with the fewest customers so far, so every kind keeps
  // some of its own on the outer ring and no side of the map is left bare.
  const homes = new Map<IntersectionKind, LinkedEntity[]>();
  for (const member of members.values()) {
    const home = [...member.kinds].sort(
      (left, right) =>
        (homes.get(left)?.length ?? 0) - (homes.get(right)?.length ?? 0) ||
        KIND_ORDER.indexOf(left) - KIND_ORDER.indexOf(right),
    )[0];
    if (home !== undefined) {
      homes.set(home, [...(homes.get(home) ?? []), member.entity]);
    }
  }

  const entities = new Map<string, GraphEntity>();
  const edges: GraphEdge[] = hubs.map((hub, index) => ({
    key: `inner:${hub.key}`,
    hubKey: hub.key,
    entityKey: null,
    path: `M ${GRAPH_CENTRE.x} ${GRAPH_CENTRE.y} L ${hub.x} ${hub.y}`,
    tone: hub.tone,
    width: round(1.6 + Math.min(hub.weight, 60) / 20),
    cross: false,
    order: index,
  }));

  for (const hub of hubs) {
    const angle = angles.get(hub.kind) ?? 0;
    const drawn = (homes.get(hub.kind) ?? []).slice(0, MAX_PER_HUB);
    drawn.forEach((entity, position) => {
      const at = angle + entityOffset(position, sector);
      entities.set(entity.entityId, {
        key: entity.entityId,
        name: entity.name ?? 'بلا اسم',
        short: nodeWords(entity.name)[0] ?? 'بلا اسم',
        typeAr: TYPES_AR[entity.entityType] ?? 'عميل',
        href: `/customers/${entity.entityId}`,
        person: entity.entityType === 'PERSON' || entity.entityType === 'FREELANCER',
        ...onRing(ENTITY_RING, at),
        label: labelAt(ENTITY_LABEL_RING, at),
        hubKeys: [hub.key],
        order: entities.size,
      });
      hub.entityKeys.push(entity.entityId);
    });
  }

  // The other links of a customer drawn elsewhere: bent through the space between the rings.
  for (const hub of hubs) {
    const angle = angles.get(hub.kind) ?? 0;
    const bend = onRing((HUB_RING + ENTITY_RING) / 2 + 20, angle);
    for (const [entityId, member] of members) {
      const node = entities.get(entityId);
      if (!member.kinds.includes(hub.kind)) {
        continue;
      }
      if (node === undefined) {
        hub.hidden += 1;
        continue;
      }
      const home = node.hubKeys[0] === hub.key;
      if (!home) {
        node.hubKeys.push(hub.key);
        hub.entityKeys.push(node.key);
      }
      edges.push({
        key: `outer:${hub.key}:${node.key}`,
        hubKey: hub.key,
        entityKey: node.key,
        path: home
          ? `M ${hub.x} ${hub.y} L ${node.x} ${node.y}`
          : `M ${hub.x} ${hub.y} Q ${bend.x} ${bend.y} ${node.x} ${node.y}`,
        tone: hub.tone,
        width: home ? 1.2 : 1.4,
        cross: !home,
        order: edges.length,
      });
    }
  }

  const nodes = [...entities.values()];
  const strongest =
    [...hubs].sort(
      (left, right) =>
        right.weight - left.weight ||
        right.entityKeys.length + right.hidden - (left.entityKeys.length + left.hidden),
    )[0] ?? null;

  return {
    centre: {
      ...GRAPH_CENTRE,
      words: nodeWords(file.displayName),
      name: file.displayName ?? 'العميل',
    },
    hubs,
    entities: nodes,
    edges,
    totals: {
      entities: new Set(
        file.intersections.flatMap((entry) => entry.entities.map((entity) => entity.entityId)),
      ).size,
      links: file.intersections.length,
      weight: hubs.reduce((sum, hub) => sum + hub.weight, 0),
      clustered: nodes.filter((node) => node.hubKeys.length > 1).length,
    },
    strongest,
  };
}

/** What a focus lights: the kind or customer itself, and everything one step from it. */
export function litKeys(
  model: RelationGraphModel,
  focus: { type: 'hub' | 'entity'; key: string } | null,
): Set<string> | null {
  if (focus === null) {
    return null;
  }
  const lit = new Set<string>(['centre']);
  if (focus.type === 'hub') {
    const hub = model.hubs.find((entry) => entry.key === focus.key);
    if (hub !== undefined) {
      lit.add(hub.key);
      lit.add(`inner:${hub.key}`);
      for (const entityKey of hub.entityKeys) {
        lit.add(entityKey);
        lit.add(`outer:${hub.key}:${entityKey}`);
      }
    }
  } else {
    const entity = model.entities.find((entry) => entry.key === focus.key);
    if (entity !== undefined) {
      lit.add(entity.key);
      for (const hubKey of entity.hubKeys) {
        lit.add(hubKey);
        lit.add(`inner:${hubKey}`);
        lit.add(`outer:${hubKey}:${entity.key}`);
      }
    }
  }
  return lit;
}
