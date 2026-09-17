import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { PRODUCT_NAME } from '../../components/brand';

/**
 * The frame for somebody who has no account yet (ADR-154).
 *
 * The one surface in this platform that **is** meant to be found: every other public page is
 * addressed to one reader and tells search engines to stay away. This one is the front door.
 */
export const metadata: Metadata = {
  title: `${PRODUCT_NAME} · تحقّق من المنشآت من المصدر الرسمي`,
  description:
    'بنية تحقق للسوق السعودي: السجل التجاري، والمفوضون بالتوقيع، والعنوان الوطني، وملكية الآيبان. كل حقل بجهته وتاريخ رصده.',
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: ReactNode }): ReactElement {
  return <>{children}</>;
}
