import Link from 'next/link';
import type { ReactElement } from 'react';

/**
 * The product's name, written once (PLAN.md, decision 9).
 *
 * Every frame, the document title and the sign in pages read it from here, so a rename is
 * one line and no screen.
 */
export const PRODUCT_NAME = 'NX Trust';

/** The mark and the name (README, shared frame template): a 30px accent circle and the word. */
export function Brand({
  href,
  suffix,
}: {
  href?: string | undefined;
  /** What follows the name on a surface that is not the subscriber's, such as «أدمن». */
  suffix?: string | undefined;
}): ReactElement {
  const content = (
    <>
      <span className="frame-brand-mark" aria-hidden="true" />
      <span>
        {PRODUCT_NAME}
        {suffix === undefined ? null : ` · ${suffix}`}
      </span>
    </>
  );

  return href === undefined ? (
    <div className="frame-brand">{content}</div>
  ) : (
    <Link className="frame-brand" href={href}>
      {content}
    </Link>
  );
}
