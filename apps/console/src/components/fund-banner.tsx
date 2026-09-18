import Link from 'next/link';
import type { ReactElement } from 'react';
import { riyals } from './format';

/**
 * The one thing a new subscriber has to do before the platform does anything (ADR-154).
 *
 * A workspace starts with no balance, and that is the gate that makes self service
 * registration safe: nothing runs until somebody has paid. So the screen has to say so, on the
 * screen where they would go looking, rather than leaving them to discover it as a refusal in
 * the middle of their first verification.
 *
 * A banner rather than a dialog. A dialog interrupts and is dismissed and never seen again; a
 * banner stays until the thing it is about is done, which is exactly how long this matters.
 *
 * **There are two kinds of credit and it must count both.** A transfer either tops up the
 * wallet in riyals or buys a bundle of operations, and a bundle grants operations without
 * moving the wallet at all. Reading the wallet alone told somebody who had just paid for a
 * bundle, and been confirmed, that they still had nothing: the purchase looked lost. The rule
 * is «can this workspace run a verification», and either kind of credit answers yes.
 */
export function FundBanner({
  availableHalalas,
  bundleOperations,
  href = '/billing',
}: {
  availableHalalas: number;
  /**
   * Operations left on live bundles. Credit too, and it never touches the wallet.
   *
   * Required, with no default. An optional zero let a new caller silently reproduce the exact
   * bug the comment above warns about, which is how it reappeared on the balance screen.
   */
  bundleOperations: number;
  href?: string;
}): ReactElement | null {
  if (availableHalalas > 0 || bundleOperations > 0) {
    return null;
  }

  return (
    <aside className="notice notice-refused" data-role="fund-banner" style={{ margin: 0 }}>
      <strong>رصيدك صفر، ولا تعمل أي عملية تحقق بدونه.</strong> اشترِ رصيداً بالتحويل البنكي: تطلبه
      من هنا، نؤكّد التحويل يدوياً، ثم يظهر الرصيد في محفظتك وتبدأ.{' '}
      <Link href={href} data-role="fund-link">
        اشترِ رصيداً
      </Link>
    </aside>
  );
}

/** The same thing, once there is a balance but it is nearly gone. */
export function LowBanner({
  availableHalalas,
  bundleOperations,
  href = '/billing',
}: {
  availableHalalas: number;
  /** Required for the same reason it is on FundBanner: an optional zero hides the bug. */
  bundleOperations: number;
  href?: string;
}): ReactElement | null {
  if (availableHalalas <= 0 && bundleOperations <= 0) {
    return null;
  }

  return (
    <aside className="notice notice-done" data-role="low-banner" style={{ margin: 0 }}>
      {availableHalalas > 0 ? (
        <>
          رصيدك المتبقي{' '}
          <bdi dir="ltr" className="mono">
            {riyals(availableHalalas)}
          </bdi>{' '}
          ريال
        </>
      ) : null}
      {availableHalalas > 0 && bundleOperations > 0 ? '، و' : null}
      {bundleOperations > 0 ? (
        <>
          <bdi dir="ltr" className="mono">
            {bundleOperations}
          </bdi>{' '}
          عملية في حزمك
        </>
      ) : null}
      .{' '}
      <Link href={href} data-role="fund-link">
        اشحن قبل أن ينفد
      </Link>
    </aside>
  );
}
