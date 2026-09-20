'use client';

import type { ReactElement } from 'react';
import { ErrorState } from '../../components/error-state';

/**
 * The one failure on this platform that a stranger reads (ADR-187).
 *
 * A shared profile is the page a subscriber sends to a bank or a partner, and the reader of
 * that link is the only person who reaches this application with no account, no session and
 * no reason to know what it is. A bad link is already answered: `resolveShare` refuses it and
 * the page is a 404. But everything after that answer is live work, and a database that is
 * unreachable for a second, or a key that cannot decrypt an identifier, threw past every
 * boundary this application had and landed on the framework's default page: an English
 * sentence, unstyled, naming the framework, to a reader who does not read English, has
 * nothing to press and no idea that pressing reload would be worth anything.
 *
 * The wording is for that reader and not for us. It offers no support address, because our
 * support desk has never heard of them, and points them back at the person who sent the link,
 * who is the one who can send another or ask us about it.
 *
 * It never repeats the error's own message. On this page above all others: the work that
 * fails here is decrypting identifiers, and a thrown message can carry one (rule 4).
 */
export default function SharedProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  return <ErrorState audience="recipient" digest={error.digest} onRetry={reset} />;
}
