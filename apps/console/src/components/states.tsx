import type { ReactElement } from 'react';

/**
 * A screen on its way (README, states: skeletons with the cards' own radii).
 *
 * The shapes of the screen that is coming, drawn where its parts will land, so nothing jumps
 * when they arrive: the figures and panels of an overview, the tabs and rows of a list, the
 * head and sections of a file, the fields of a form. A soft light passes over them while the
 * data is read, the one motion the system allows beyond colour (ADR-120), and it stands still
 * for a person who asked for less motion.
 *
 * Inside the frame, the frame's data loader says what is being fetched, so these shapes stay
 * quiet (`announce={false}`); anywhere else they tell a screen reader the screen is loading.
 */

export type LoadingShape = 'overview' | 'list' | 'file' | 'form';

const ROWS = [0, 1, 2, 3, 4, 5, 6];

export function LoadingState({
  shape = 'overview',
  announce = true,
}: {
  shape?: LoadingShape | undefined;
  /** Say «جارٍ التحميل» to a screen reader, when nothing else on the page says it. */
  announce?: boolean | undefined;
}): ReactElement {
  return (
    <div
      className="stack skeleton-screen"
      style={{ gap: 'var(--s-5)' }}
      aria-busy="true"
      data-role="loading"
      data-shape={shape}
    >
      {announce ? (
        <span className="visually-hidden" role="status">
          جارٍ التحميل
        </span>
      ) : null}
      {shape === 'list' || shape === 'file' ? <SkeletonTabs /> : null}
      {shape === 'file' ? (
        <div className="skeleton skeleton-head" />
      ) : (
        <div className="skeleton skeleton-title" />
      )}
      {shape === 'overview' ? (
        <div className="skeleton-grid">
          <div className="skeleton skeleton-stat" />
          <div className="skeleton skeleton-stat" />
          <div className="skeleton skeleton-stat" />
          <div className="skeleton skeleton-stat" />
        </div>
      ) : null}
      {shape === 'file' ? (
        <div className="skeleton-sections">
          <div className="skeleton skeleton-panel" />
          <div className="skeleton skeleton-panel" />
        </div>
      ) : (
        <div className="skeleton skeleton-panel">
          {shape === 'overview'
            ? null
            : ROWS.slice(0, shape === 'form' ? 4 : ROWS.length).map((row) => (
                <span key={row} className="skeleton-line" />
              ))}
        </div>
      )}
    </div>
  );
}

function SkeletonTabs(): ReactElement {
  return (
    <div className="skeleton-tabs">
      <span className="skeleton skeleton-tab" />
      <span className="skeleton skeleton-tab" />
      <span className="skeleton skeleton-tab" />
    </div>
  );
}
