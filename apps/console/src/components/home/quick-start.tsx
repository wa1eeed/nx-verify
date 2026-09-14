'use client';

import Form from 'next/form';
import { useState, type ReactElement } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * «ابدأ تحققاً جديداً»: a number, and the request screen opens on it (handoff screen 01).
 *
 * The number travels to the next screen in this tab's session storage, not in the address:
 * a national ID in a link is a national ID in the browser's history, in a proxy's log and in
 * whatever the link is pasted into (rule 4). The field has no name, so the form itself sends
 * nothing: it only opens the request screen, which reads the number once and clears it. The
 * router opens it without reloading the page (unit C4), and a browser without script still
 * reaches that screen by a plain GET, with the field empty.
 */

export const HANDOFF_KEY = 'nx-request-number';

export function QuickStart(): ReactElement {
  const [number, setNumber] = useState('');

  function handOver(): void {
    const typed = number.trim();
    try {
      if (typed !== '') {
        window.sessionStorage.setItem(HANDOFF_KEY, typed);
      }
    } catch {
      // Storage refused (a private window): the request screen opens empty.
    }
  }

  return (
    <Form
      className="home-start-form"
      action="/verifications/new"
      onSubmit={handOver}
      data-role="quick-start-form"
    >
      <Input
        ltr
        inputMode="numeric"
        autoComplete="off"
        maxLength={20}
        aria-label="رقم السجل التجاري أو رقم الهوية"
        value={number}
        onChange={(event) => setNumber(event.target.value)}
      />
      <Button type="submit" variant="primary" iconEnd="arrow-left" data-role="quick-start">
        متابعة
      </Button>
    </Form>
  );
}
