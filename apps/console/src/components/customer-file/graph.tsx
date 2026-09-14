'use client';

import Link from 'next/link';
import {
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type SVGProps,
} from 'react';
import { Icon } from '../ui/icon';
import { Ltr } from '../ui/ltr';
import {
  ENTITY_RING,
  GRAPH_CENTRE,
  GRAPH_SIZE,
  HUB_RING,
  litKeys,
  type GraphEntity,
  type GraphHub,
  type RelationGraphModel,
} from './graph-model';

/**
 * The intersections map of a customer file (README, screen 03, «التقاطعات المكتشفة»; ADR-123).
 *
 * The customer in the middle, the kinds of thing they share on the ring around them, and the
 * customers who share them on the outer ring. A light sweeps the rings as the map looks for
 * links, and small dots travel each link towards the customer, the way the shared thing leads
 * back to them. A kind that raises the risk score is drawn in amber or red, its link thicker,
 * with the points it adds beside it, and the heaviest one breathes.
 *
 * Point at or choose anything to follow it: the rest of the map steps back, and the panel under
 * the map says what the link is, who it runs through, what it adds to the score, and who is on
 * the other end, with their files a click away. A customer tied to this one more than once
 * carries a gold mark. Every node is reachable with Tab and chosen with Enter; Escape lets go.
 * For a person who asked for less motion the map is still, and the list under it says the same
 * in words.
 *
 * The layout is worked out on the server (graph-model.ts), so the browser receives the map's
 * points and words, not the customer file they came from.
 */

type Focus = { type: 'hub' | 'entity'; key: string };

const TONE_WORDS = { critical: 'يرفع المخاطر', attention: 'يستحق النظر', info: 'للعلم' } as const;

function stagger(order: number, base: number, step: number): CSSProperties {
  return { '--rg-delay': `${base + order * step}ms` } as CSSProperties;
}

function same(left: Focus | null, right: Focus): boolean {
  return left !== null && left.type === right.type && left.key === right.key;
}

/** The sweep's inner edge, clear of the customer's disc and its pulse. */
const SWEEP_INNER = 58;

/** Twelve thin slices of the ring, bright at the leading edge and fading behind it. */
const SWEEP = Array.from({ length: 12 }, (_, index) => {
  const to = -index * 4;
  const from = to - 4.4;
  const point = (radius: number, degrees: number): string => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    const x = Math.round((GRAPH_CENTRE.x + radius * Math.cos(radians)) * 10) / 10;
    const y = Math.round((GRAPH_CENTRE.y + radius * Math.sin(radians)) * 10) / 10;
    return `${x} ${y}`;
  };
  return {
    d: [
      `M ${point(SWEEP_INNER, from)}`,
      `L ${point(ENTITY_RING, from)}`,
      `A ${ENTITY_RING} ${ENTITY_RING} 0 0 1 ${point(ENTITY_RING, to)}`,
      `L ${point(SWEEP_INNER, to)}`,
      `A ${SWEEP_INNER} ${SWEEP_INNER} 0 0 0 ${point(SWEEP_INNER, from)}`,
      'Z',
    ].join(' '),
    opacity: Math.round((0.2 - index * 0.016) * 1000) / 1000,
  };
});

export function RelationGraph({ model }: { model: RelationGraphModel }): ReactElement | null {
  const [selected, setSelected] = useState<Focus | null>(null);
  const [pointed, setPointed] = useState<Focus | null>(null);

  if (model.hubs.length === 0) {
    return null;
  }

  const focus = pointed ?? selected;
  const lit = litKeys(model, focus);
  const state = (key: string): 'lit' | 'dim' | undefined =>
    lit === null ? undefined : lit.has(key) ? 'lit' : 'dim';

  const choose = (next: Focus): void =>
    setSelected((current) => (same(current, next) ? null : next));
  const handlers = (next: Focus): SVGProps<SVGGElement> => ({
    tabIndex: 0,
    role: 'button',
    'aria-pressed': same(selected, next),
    onMouseEnter: () => setPointed(next),
    onMouseLeave: () => setPointed(null),
    onFocus: () => setPointed(next),
    onBlur: () => setPointed(null),
    onClick: () => choose(next),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose(next);
      } else if (event.key === 'Escape') {
        setSelected(null);
      }
    },
  });

  return (
    <div className="rg" data-role="relation-graph" data-focused={focus === null ? undefined : ''}>
      <dl className="rg-totals" data-role="relation-totals">
        <div>
          <dt>كيانات مرتبطة</dt>
          <dd>
            <Ltr>{model.totals.entities}</Ltr>
          </dd>
        </div>
        <div>
          <dt>روابط مكتشفة</dt>
          <dd>
            <Ltr>{model.totals.links}</Ltr>
          </dd>
        </div>
        <div data-tone={model.totals.weight >= 30 ? 'attention' : undefined}>
          <dt>أثرها على المخاطر</dt>
          <dd>
            <Ltr>{model.totals.weight > 0 ? `+${model.totals.weight}` : '0'}</Ltr>
          </dd>
        </div>
      </dl>

      <div className="rg-stage">
        <svg
          className="rg-map"
          viewBox={`0 0 ${GRAPH_SIZE.width} ${GRAPH_SIZE.height}`}
          role="group"
          aria-label={`خريطة تقاطعات ${model.centre.name}: ${model.totals.links} روابط مع ${model.totals.entities} كيانات`}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <circle className="rg-orbit" cx={GRAPH_CENTRE.x} cy={GRAPH_CENTRE.y} r={HUB_RING} />
          <circle
            className="rg-orbit rg-orbit-outer"
            cx={GRAPH_CENTRE.x}
            cy={GRAPH_CENTRE.y}
            r={ENTITY_RING}
          />
          <g
            className="rg-sweep"
            aria-hidden="true"
            style={{ transformOrigin: `${GRAPH_CENTRE.x}px ${GRAPH_CENTRE.y}px` }}
          >
            {SWEEP.map((slice) => (
              <path key={slice.d} d={slice.d} opacity={slice.opacity} />
            ))}
          </g>

          {model.edges.map((edge) => (
            <g
              key={edge.key}
              className="rg-edge"
              data-tone={edge.tone}
              data-cross={edge.cross ? '' : undefined}
              data-state={state(edge.key)}
              style={stagger(edge.order, edge.entityKey === null ? 120 : 520, 50)}
            >
              <path
                className="rg-edge-line"
                d={edge.path}
                pathLength={1}
                strokeWidth={edge.width}
              />
              <path className="rg-edge-flow" d={edge.path} pathLength={1} />
            </g>
          ))}

          <g className="rg-centre">
            <circle className="rg-pulse" cx={GRAPH_CENTRE.x} cy={GRAPH_CENTRE.y} r={32} />
            <circle
              className="rg-pulse rg-pulse-late"
              cx={GRAPH_CENTRE.x}
              cy={GRAPH_CENTRE.y}
              r={32}
            />
            <circle className="rg-centre-disc" cx={GRAPH_CENTRE.x} cy={GRAPH_CENTRE.y} r={34} />
            <text className="rg-centre-label" x={GRAPH_CENTRE.x} y={GRAPH_CENTRE.y}>
              {model.centre.words.map((word, index) => (
                <tspan
                  key={`${word}-${index}`}
                  x={GRAPH_CENTRE.x}
                  dy={index === 0 ? (model.centre.words.length > 1 ? -6 : 0) : 14}
                >
                  {word}
                </tspan>
              ))}
            </text>
          </g>

          {model.hubs.map((hub) => (
            <HubNode
              key={hub.key}
              hub={hub}
              strongest={model.strongest?.key === hub.key && hub.weight > 0}
              state={state(hub.key)}
              handlers={handlers({ type: 'hub', key: hub.key })}
            />
          ))}

          {model.entities.map((entity) => (
            <EntityNode
              key={entity.key}
              entity={entity}
              state={state(entity.key)}
              handlers={handlers({ type: 'entity', key: entity.key })}
            />
          ))}
        </svg>
        {pointed === null ? null : <Glance model={model} focus={pointed} />}
      </div>

      <div className="rg-legend" role="group" aria-label="أنواع الروابط">
        {model.hubs.map((hub) => {
          const next: Focus = { type: 'hub', key: hub.key };
          return (
            <button
              key={hub.key}
              type="button"
              className="rg-legend-item"
              data-tone={hub.tone}
              aria-pressed={same(selected, next)}
              onClick={() => choose(next)}
              onMouseEnter={() => setPointed(next)}
              onMouseLeave={() => setPointed(null)}
            >
              <span className="rg-legend-dot" aria-hidden="true" />
              {hub.labelAr}
              <span className="rg-legend-count">
                <Ltr>{hub.entityKeys.length + hub.hidden}</Ltr>
              </span>
            </button>
          );
        })}
      </div>

      <Details model={model} focus={selected} />
    </div>
  );
}

function HubNode({
  hub,
  strongest,
  state,
  handlers,
}: {
  hub: GraphHub;
  strongest: boolean;
  state: 'lit' | 'dim' | undefined;
  handlers: SVGProps<SVGGElement>;
}): ReactElement {
  return (
    <g
      {...handlers}
      className="rg-node rg-hub"
      data-tone={hub.tone}
      data-state={state}
      data-strongest={strongest ? '' : undefined}
      aria-label={`${hub.labelAr}. ${hub.lines.join('. ')}`}
      style={stagger(hub.order, 260, 90)}
    >
      {strongest ? <circle className="rg-hub-halo" cx={hub.x} cy={hub.y} r={23} /> : null}
      <circle className="rg-hub-disc" cx={hub.x} cy={hub.y} r={17} />
      <g transform={`translate(${hub.x - 8} ${hub.y - 8})`} className="rg-hub-icon">
        <Icon name={hub.icon} size={16} />
      </g>
      {hub.weight > 0 ? (
        <g className="rg-weight">
          <rect x={hub.badge.x - 15} y={hub.badge.y - 7.5} width={30} height={15} rx={7.5} />
          <text x={hub.badge.x} y={hub.badge.y}>
            +{hub.weight}
          </text>
        </g>
      ) : null}
      <text
        className="rg-label rg-hub-label"
        x={hub.label.x}
        y={hub.label.y}
        textAnchor={hub.label.anchor}
      >
        {hub.labelAr}
      </text>
    </g>
  );
}

function EntityNode({
  entity,
  state,
  handlers,
}: {
  entity: GraphEntity;
  state: 'lit' | 'dim' | undefined;
  handlers: SVGProps<SVGGElement>;
}): ReactElement {
  return (
    <g
      {...handlers}
      className="rg-node rg-entity"
      data-person={entity.person ? '' : undefined}
      data-state={state}
      aria-label={`${entity.name}، ${entity.typeAr}`}
      style={stagger(entity.order, 680, 55)}
    >
      <circle className="rg-entity-disc" cx={entity.x} cy={entity.y} r={12} />
      <text className="rg-entity-initial" x={entity.x} y={entity.y}>
        {entity.short.slice(0, 1)}
      </text>
      {entity.hubKeys.length > 1 ? (
        <circle className="rg-entity-cluster" cx={entity.x + 9} cy={entity.y - 9} r={4.5} />
      ) : null}
      <text
        className="rg-label rg-entity-label"
        x={entity.label.x}
        y={entity.label.y}
        textAnchor={entity.label.anchor}
      >
        {entity.short}
      </text>
    </g>
  );
}

/**
 * A quick look beside what the pointer or the keyboard is on: what it is, who it runs through
 * or what it is tied by, and what it adds to the score. It follows the pointer's focus only;
 * choosing pins the full details under the map, with the links to the files.
 */
function Glance({
  model,
  focus,
}: {
  model: RelationGraphModel;
  focus: Focus;
}): ReactElement | null {
  const hub =
    focus.type === 'hub' ? model.hubs.find((entry) => entry.key === focus.key) : undefined;
  const entity =
    focus.type === 'entity' ? model.entities.find((entry) => entry.key === focus.key) : undefined;
  const at = hub ?? entity;
  if (at === undefined) {
    return null;
  }
  const left = (at.x / GRAPH_SIZE.width) * 100;
  const top = (at.y / GRAPH_SIZE.height) * 100;
  const style = { left: `${left}%`, top: `${top}%` } as CSSProperties;

  return (
    <div
      className="rg-glance"
      style={style}
      data-align={left < 30 ? 'right' : left > 70 ? 'left' : 'centre'}
      data-side={top < 45 ? 'below' : 'above'}
      data-tone={hub?.tone}
      aria-hidden="true"
    >
      {hub !== undefined ? (
        <>
          <p className="rg-glance-head">
            <span className="rg-details-dot" />
            <strong>{hub.labelAr}</strong>
            {hub.weight > 0 ? (
              <span className="rg-glance-weight">
                <Ltr>+{hub.weight}</Ltr>
              </span>
            ) : null}
          </p>
          {hub.through.length > 0 ? (
            <p className="rg-glance-line">
              {hub.through.map((name, index) => (
                <span key={name}>
                  {index > 0 ? '، ' : ''}
                  {name.startsWith('••••') ? <Ltr>{name}</Ltr> : name}
                </span>
              ))}
            </p>
          ) : null}
          <p className="rg-glance-line">
            يربطه بـ <Ltr>{hub.entityKeys.length + hub.hidden}</Ltr> من عملائك ·{' '}
            {TONE_WORDS[hub.tone]}
          </p>
        </>
      ) : entity !== undefined ? (
        <>
          <p className="rg-glance-head">
            <strong>{entity.name}</strong>
          </p>
          <p className="rg-glance-line">
            {entity.typeAr} · عبر <Ltr>{entity.hubKeys.length}</Ltr>{' '}
            {entity.hubKeys.length === 1 ? 'رابط' : 'روابط'}
          </p>
          <p className="rg-glance-kinds">
            {entity.hubKeys.map((key) => {
              const via = model.hubs.find((entry) => entry.key === key);
              return via === undefined ? null : (
                <span key={key} className="rg-glance-kind" data-tone={via.tone}>
                  {via.labelAr}
                </span>
              );
            })}
          </p>
        </>
      ) : null}
    </div>
  );
}

function Details({
  model,
  focus,
}: {
  model: RelationGraphModel;
  focus: Focus | null;
}): ReactElement {
  const hub =
    focus?.type === 'hub' ? model.hubs.find((entry) => entry.key === focus.key) : undefined;
  const entity =
    focus?.type === 'entity' ? model.entities.find((entry) => entry.key === focus.key) : undefined;

  return (
    <div className="rg-details" aria-live="polite" data-role="relation-details">
      {hub !== undefined ? (
        <>
          <p className="rg-details-head" data-tone={hub.tone}>
            <span className="rg-details-dot" aria-hidden="true" />
            <strong>{hub.labelAr}</strong>
            <span className="rg-details-tone">{TONE_WORDS[hub.tone]}</span>
            {hub.weight > 0 ? (
              <span className="rg-details-weight">
                <Ltr>+{hub.weight}</Ltr> على درجة المخاطر
              </span>
            ) : null}
          </p>
          {hub.lines.map((line) => (
            <p key={line} className="rg-details-text">
              {line}
            </p>
          ))}
          <ul className="rg-details-list">
            {hub.entityKeys.map((key) => {
              const other = model.entities.find((entry) => entry.key === key);
              return other === undefined ? null : (
                <li key={key}>
                  <Link href={other.href}>{other.name}</Link>
                  <span>
                    {other.typeAr}
                    {other.hubKeys.length > 1 ? ' · أكثر من رابط' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
          {hub.hidden > 0 ? (
            <p className="rg-details-hint">
              و<Ltr>{hub.hidden}</Ltr> غيرهم في القائمة تحت الخريطة.
            </p>
          ) : null}
          {hub.href !== null ? (
            <Link className="rg-details-link" href={hub.href}>
              فتح ملف {hub.through[0] ?? 'الطرف المشترك'}
            </Link>
          ) : null}
        </>
      ) : entity !== undefined ? (
        <>
          <p className="rg-details-head">
            <strong>{entity.name}</strong>
            <span className="rg-details-tone">{entity.typeAr}</span>
            {entity.hubKeys.length > 1 ? (
              <span className="rg-details-cluster">
                مرتبط بهذا العميل عبر <Ltr>{entity.hubKeys.length}</Ltr> روابط
              </span>
            ) : null}
          </p>
          <p className="rg-details-text">
            يلتقي بهذا العميل عبر:{' '}
            {entity.hubKeys
              .map((key) => model.hubs.find((entry) => entry.key === key)?.labelAr)
              .filter((label): label is string => label !== undefined)
              .join('، ')}
          </p>
          <Link className="rg-details-link" href={entity.href}>
            فتح الملف
          </Link>
        </>
      ) : (
        <>
          <p className="rg-details-hint">
            مرّر على عنصر لتلقي نظرة عليه، واختره لتثبت تفاصيله هنا.
          </p>
          {model.strongest !== null ? (
            <p className="rg-details-strongest" data-tone={model.strongest.tone}>
              <span className="rg-details-dot" aria-hidden="true" />
              <span>أقوى رابط: {model.strongest.lines[0] ?? model.strongest.labelAr}</span>
              {model.strongest.weight > 0 ? (
                <span className="rg-details-weight">
                  <Ltr>+{model.strongest.weight}</Ltr>
                </span>
              ) : null}
            </p>
          ) : null}
          {model.totals.clustered > 0 ? (
            <p className="rg-details-text">
              <Ltr>{model.totals.clustered}</Ltr> من الكيانات مرتبطة بهذا العميل بأكثر من رابط،
              وعليها علامة ذهبية.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
