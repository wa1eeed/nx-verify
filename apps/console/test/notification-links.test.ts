import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMessage, type WebhookEventType } from '@nx-verify/core';
import {
  EVENT_LABELS_AR,
  EVENT_SEVERITY,
  EVENT_TYPES,
  SEVERITY_LABELS_AR,
} from '../src/components/events';

/**
 * Where an alert sends somebody, and what every event is called (ADR-165).
 *
 * Five of the nine templates linked to `/registry`, `/onboarding` and `/queue`, none of which
 * the console has ever had. Three others were right, so it was checked once and then drifted
 * as the routes were renamed. A link in an email is the one part of this product nobody sees
 * until a customer follows it.
 */

const consoleRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Every route the app router actually serves, from the directories on disk. */
function routes(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string, url: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) {
        if (entry === 'page.tsx') {
          found.add(url === '' ? '/' : url);
        }
        continue;
      }
      // (app) and (auth) are route groups: they organise files and not addresses.
      const segment = entry.startsWith('(') && entry.endsWith(')') ? '' : `/${entry}`;
      walk(full, `${url}${segment}`);
    }
  };
  walk(join(consoleRoot, 'src', 'app'), '');
  return found;
}

describe('the links in an alert', () => {
  it('points every template at a screen this console actually has', () => {
    const served = routes();
    const broken: string[] = [];

    for (const event of EVENT_TYPES) {
      const message = renderMessage(event, 'https://trust.example.sa');
      for (const url of message.body.match(/https:\/\/trust\.example\.sa\S*/g) ?? []) {
        const path = url.replace('https://trust.example.sa', '') || '/';
        // A dynamic segment cannot be matched from a constant, and none of these have one.
        if (!served.has(path)) {
          broken.push(`${event} → ${path}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it('names and rates every event, so none renders as its own code', () => {
    for (const event of EVENT_TYPES) {
      expect(EVENT_LABELS_AR[event]).toBeTruthy();
      expect(EVENT_LABELS_AR[event]).not.toBe(event);
      expect(SEVERITY_LABELS_AR[EVENT_SEVERITY[event]]).toBeTruthy();
    }
  });

  it('offers every event it can send, and sends every event it offers', () => {
    // A list a screen reads and a union the dispatcher reads drift apart silently; this is
    // the only place that notices.
    const offered = [...EVENT_TYPES].sort();
    const named = (Object.keys(EVENT_LABELS_AR) as WebhookEventType[]).sort();
    expect(offered).toEqual(named);
  });
});
