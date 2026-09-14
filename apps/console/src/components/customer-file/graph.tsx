import type { ReactElement } from 'react';
import type { CustomerFile, Intersection, LinkedEntity } from '@nx-verify/core';

/**
 * The links a file reveals, drawn (README, screen 03, «التقاطعات المكتشفة»).
 *
 * The customer in the middle in the accent. People on one side in sage, other businesses on
 * the other: the ones that are customers here in the accent's light step, the rest neutral.
 * A link that matters more (the same account, the same address, a manager across three or
 * more businesses) is drawn in the accent and thicker. The text boxes under the drawing say
 * the same thing in words, so the drawing is decoration for anyone who cannot see it.
 */

interface GraphNode {
  key: string;
  label: string;
  kind: 'person' | 'customer' | 'other';
  x: number;
  y: number;
  strong: boolean;
}

const CENTRE = { x: 160, y: 95 };
const PEOPLE_SLOTS = [
  { x: 62, y: 48 },
  { x: 62, y: 142 },
];
const BUSINESS_SLOTS = [
  { x: 258, y: 48 },
  { x: 258, y: 142 },
];

function shortName(name: string | null): string[] {
  if (name === null || name.trim() === '') {
    return ['بلا', 'اسم'];
  }
  const words = name
    .split(/\s+/)
    .filter((word) => word !== '' && word !== 'شركة' && word !== 'مؤسسة');
  return words.slice(0, 2);
}

function strongLink(intersection: Intersection): boolean {
  return (
    intersection.kind === 'SHARED_ACCOUNT' ||
    intersection.kind === 'SHARED_ADDRESS' ||
    (intersection.kind === 'SHARED_MANAGER' && intersection.entities.length >= 3)
  );
}

export function RelationGraph({ file }: { file: CustomerFile }): ReactElement | null {
  const people = new Map<string, { entity: LinkedEntity; strong: boolean }>();
  const businesses = new Map<string, { entity: LinkedEntity; strong: boolean }>();

  for (const intersection of file.intersections) {
    const strong = strongLink(intersection);
    const via = intersection.via;
    if (via !== null && (via.entityType === 'PERSON' || via.entityType === 'FREELANCER')) {
      const known = people.get(via.entityId);
      people.set(via.entityId, { entity: via, strong: strong || (known?.strong ?? false) });
    }
    for (const entity of intersection.entities) {
      const target =
        entity.entityType === 'PERSON' || intersection.kind === 'MANAGER_IS_CUSTOMER'
          ? people
          : businesses;
      const known = target.get(entity.entityId);
      target.set(entity.entityId, { entity, strong: strong || (known?.strong ?? false) });
    }
  }

  const nodes: GraphNode[] = [
    ...[...people.values()].slice(0, PEOPLE_SLOTS.length).map((entry, index) => ({
      key: entry.entity.entityId,
      label: shortName(entry.entity.name).join(' '),
      kind: 'person' as const,
      x: PEOPLE_SLOTS[index]?.x ?? 0,
      y: PEOPLE_SLOTS[index]?.y ?? 0,
      strong: entry.strong,
    })),
    ...[...businesses.values()].slice(0, BUSINESS_SLOTS.length).map((entry, index) => ({
      key: entry.entity.entityId,
      label: shortName(entry.entity.name).join(' '),
      kind:
        entry.entity.entityType === 'BUSINESS' || entry.entity.entityType === 'FREELANCER'
          ? ('customer' as const)
          : ('other' as const),
      x: BUSINESS_SLOTS[index]?.x ?? 0,
      y: BUSINESS_SLOTS[index]?.y ?? 0,
      strong: entry.strong,
    })),
  ];

  if (nodes.length === 0) {
    return null;
  }

  const centreLabel = shortName(file.displayName);

  return (
    <svg
      className="relation-graph"
      viewBox="0 0 320 190"
      role="img"
      aria-label={`روابط ${file.displayName ?? 'العميل'} مع ${nodes.length} من السجلات`}
      data-role="relation-graph"
    >
      {nodes.map((node) => (
        <line
          key={`edge-${node.key}`}
          className={node.strong ? 'graph-edge graph-edge-strong' : 'graph-edge'}
          x1={CENTRE.x}
          y1={CENTRE.y}
          x2={node.x}
          y2={node.y}
        />
      ))}
      <circle className="graph-self" cx={CENTRE.x} cy={CENTRE.y} r={30} />
      <text className="graph-label graph-label-self" x={CENTRE.x} y={CENTRE.y}>
        {centreLabel.map((word, index) => (
          <tspan
            key={word + index}
            x={CENTRE.x}
            dy={index === 0 ? (centreLabel.length > 1 ? -6 : 0) : 12}
          >
            {word}
          </tspan>
        ))}
      </text>
      {nodes.map((node) => {
        const words = node.label.split(' ');
        return (
          <g key={node.key}>
            <circle className={`graph-node graph-${node.kind}`} cx={node.x} cy={node.y} r={25} />
            <text className="graph-label" x={node.x} y={node.y}>
              {words.map((word, index) => (
                <tspan
                  key={word + index}
                  x={node.x}
                  dy={index === 0 ? (words.length > 1 ? -6 : 0) : 12}
                >
                  {word}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
