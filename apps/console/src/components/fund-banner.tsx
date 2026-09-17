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
 */
export function FundBanner({
  availableHalalas,
  href = '/billing/invoices',
}: {
  availableHalalas: number;
  href?: string;
}): ReactElement | null {
  if (availableHalalas > 0) {
    return null;
  }

  return (
    <aside className="notice notice-refused" data-role="fund-banner" style={{ margin: 0 }}>
      <strong>رصيدك صفر، ولا تعمل أي عملية تحقق بدونه.</strong> اشترِ رصيداً بالتحويل البنكي: تطلبه
      من هنا، نؤكّد التحويل يدوياً، ثم يظهر الرصيد في محفظتك وتبدأ.{' '}
      <Link href={href} data-role="fund-link">
        اشترِ رصيداً وشاهد بيانات التحويل
      </Link>
    </aside>
  );
}

/** The same thing, once there is a balance but it is nearly gone. */
export function LowBanner({
  availableHalalas,
  href = '/billing/invoices',
}: {
  availableHalalas: number;
  href?: string;
}): ReactElement | null {
  if (availableHalalas <= 0) {
    return null;
  }

  return (
    <aside className="notice notice-done" data-role="low-banner" style={{ margin: 0 }}>
      رصيدك المتبقي{' '}
      <bdi dir="ltr" className="mono">
        {riyals(availableHalalas)}
      </bdi>{' '}
      ريال.{' '}
      <Link href={href} data-role="fund-link">
        اشحن قبل أن ينفد
      </Link>
    </aside>
  );
}
