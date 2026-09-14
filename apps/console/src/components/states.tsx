import type { ReactElement } from 'react';

/**
 * A screen on its way (README, states: skeletons with the cards' own radii).
 *
 * Still shapes, not a spinner and no motion: the frame is already there, and what is coming
 * is drawn where it will land, so nothing jumps when it arrives.
 */
export function LoadingState(): ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }} aria-busy="true" data-role="loading">
      <span className="visually-hidden" role="status">
        جارٍ التحميل
      </span>
      <div className="skeleton skeleton-title" />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-stat" />
        <div className="skeleton skeleton-stat" />
        <div className="skeleton skeleton-stat" />
        <div className="skeleton skeleton-stat" />
      </div>
      <div className="skeleton skeleton-panel" />
    </div>
  );
}
