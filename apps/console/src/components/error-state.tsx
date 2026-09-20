'use client';

import type { ReactElement } from 'react';
import { Brand } from './brand';
import { Button } from './ui/button';
import { Card, CardTitle } from './ui/card';
import { Ltr } from './ui/ltr';

/**
 * Who is reading the failure, which is what decides the sentence (ADR-187).
 *
 * A member of a workspace is told their account is untouched and pointed at our support,
 * because both are things they can act on. A visitor with no session has no account to be
 * reassured about. And the reader of a shared link is neither: they are outside the company
 * that sent it, they have never heard of us, and «تواصل مع الدعم» would send them to a
 * support desk that has no idea who they are. The person who can help them is the one who
 * sent the link.
 */
export type ErrorAudience = 'member' | 'visitor' | 'recipient';

const WORDING: Record<ErrorAudience, { title: string; body: string }> = {
  member: {
    title: 'تعذّر عرض هذه الصفحة',
    body: 'لم تكتمل قراءة البيانات، ولم يتغيّر شيء في حسابك. أعد المحاولة، وإن تكرر الخطأ فأرسل الرمز أدناه إلى الدعم.',
  },
  visitor: {
    title: 'تعذّر عرض هذه الصفحة',
    body: 'لم تكتمل قراءة هذه الصفحة. أعد المحاولة، وإن تكرر الخطأ فأرسل الرمز أدناه إلى الدعم.',
  },
  recipient: {
    title: 'تعذّر عرض هذا الملف',
    body: 'لم تكتمل قراءة بيانات هذا الرابط. أعد المحاولة بعد قليل، وإن تكرر فأبلغ من أرسل إليك الرابط ومعه الرمز أدناه.',
  },
};

/**
 * A screen that could not be drawn (README, states: the reason and a retry).
 *
 * It says what did not happen and what did not change, offers the retry, and gives the code
 * support needs. It never shows the error's own message: that is written for us, and it can
 * carry what a person on this screen must not see (rule 4).
 */
export function ErrorState({
  digest,
  onRetry,
  audience = 'member',
}: {
  digest?: string | undefined;
  onRetry: () => void;
  audience?: ErrorAudience | undefined;
}): ReactElement {
  const said = WORDING[audience];

  return (
    <Card label={said.title}>
      <div role="alert" className="stack" style={{ gap: 'var(--s-3)' }}>
        <CardTitle as="h1">{said.title}</CardTitle>
        <p style={{ margin: 0 }}>{said.body}</p>
        {digest === undefined ? null : (
          <p className="faint" style={{ margin: 0 }}>
            الرمز: <Ltr>{digest}</Ltr>
          </p>
        )}
        <div>
          <Button variant="primary" icon="refresh-cw" onClick={onRetry}>
            إعادة المحاولة
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * The same failure where there is no frame around it to fall back into (ADR-187).
 *
 * A boundary renders in place of its segment's children, so it inherits whatever layout sits
 * above it. Two of them have none worth the name: the landing page's layout is a fragment,
 * and the boundary at the root of the application stands in for a frame that may be the very
 * thing that failed. Bare, both would be a card floating on the ground with nothing saying
 * whose screen this is, and a reader who cannot attribute a page cannot act on it.
 */
export function FramedErrorState({
  digest,
  onRetry,
  audience = 'visitor',
}: {
  digest?: string | undefined;
  onRetry: () => void;
  audience?: ErrorAudience | undefined;
}): ReactElement {
  return (
    <div className="auth-frame">
      <Brand />
      <main id="main">
        <ErrorState digest={digest} onRetry={onRetry} audience={audience} />
      </main>
    </div>
  );
}
