import type { ReactElement, ReactNode } from 'react';
import { PRODUCT_NAME } from '../components/brand';
/*
 * The one face the platform uses (ADR-125), served by us.
 *
 * Two subsets and four weights, not the package's whole set: the platform writes Arabic, and
 * writes identifiers, IBANs and product codes in Latin. The rest of the world's alphabets are
 * faces nobody here renders, and shipping them is a deployment carrying files it will never
 * serve.
 *
 * Self hosted rather than fetched from a font service, so the content policy names no origin
 * but ours and no employee's browser announces itself to a third party to read a screen
 * (ADR-139).
 */
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource/ibm-plex-sans-arabic/latin-400.css';
import '@fontsource/ibm-plex-sans-arabic/latin-500.css';
import '@fontsource/ibm-plex-sans-arabic/latin-600.css';
import '@fontsource/ibm-plex-sans-arabic/latin-700.css';
// The order is the cascade: the old console classes first, so the system's base type, links
// and focus ring win over them, then the Organic sheet, then what the product adds to it.
import '../styles/legacy.css';
import '../styles/organic.css';
import '../styles/product.css';
// Tailwind's theme and utilities, in cascade layers everything above outranks (ADR-119).
import '../styles/tailwind.css';
import { DirectionProvider } from '../components/shadcn/direction';
import { NavigationProgress } from '../components/navigation-progress';

export const metadata = {
  title: PRODUCT_NAME,
  description: 'منصة تحقق وامتثال',
};

/**
 * The document.
 *
 * Full RTL, set at the root rather than patched per component, and the one face the design
 * names: IBM Plex Sans Arabic for everything, titles in its bold (ADR-125, the owner's choice
 * of the face government platforms use, in place of Baloo Bhaijaan 2 for headings). It is
 * imported above and served by us, so the document asks nobody else for anything.
 *
 * The progress bar sits here, above every group, because a move from the sign in page to the
 * frame is as much a wait as a move inside it (unit C4).
 *
 * The furniture lives one level down, in separate groups. A person who is signed in gets the
 * frame; a person who is not gets a bare page, because navigation to screens they cannot open
 * and a sign out button for a session they do not have are both lies.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <DirectionProvider direction="rtl">
          <NavigationProgress />
          {children}
        </DirectionProvider>
      </body>
    </html>
  );
}
