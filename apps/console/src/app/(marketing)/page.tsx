import type { ReactElement } from 'react';
import { Landing } from '../../components/landing';

/**
 * The front door.
 *
 * Static: it reads no database and says nothing about any subscriber, so there is nothing to
 * render per request and every visitor can be served the same bytes.
 */
export default function LandingPage(): ReactElement {
  return <Landing />;
}
