import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler planning a multi-stop trip, when two of my stops have
 * no reasonable inter-city connection I want that surfaced as a trade-off —
 * inline under the leg and in the global conflict banner — never silently
 * routed around (warn and continue)."
 *
 * Covers `window.classifyLegConnection(options, from, to)` (pure, threshold
 * LONG_LEG_HRS = 8):
 *  - real flight/train on file → flag ("verified-long") only when even the
 *    fastest option overall runs > 8h;
 *  - no real flight/train but some real option (e.g. a drive-only pair) →
 *    "verified-long" when the fastest VERIFIED option runs > 8h — estimated
 *    top-ups are guesses and never rescue the leg;
 *  - everything estimated (unknown pair) → "unverified-long" only when even
 *    the guesses run > 8h, with honest "we don't have route data" wording
 *    that never claims the route is verified bad;
 *  - otherwise null. Boundary is strict: 8.0h exactly → null.
 *
 * And the UI/persistence pipeline: buildLegs stores legs[i].connectionWarning
 * ({kind, reason} | null, recomputed on submit and destination-option switch;
 * in-leg selection never changes it), an inline .leg-connection-warning
 * (role=note, data-connection-warning-kind, ⚠ icon) renders under the flagged
 * leg's still-selectable cards, and #conflictBanner carries one line per
 * flagged leg, coexisting with requirement-conflict warnings.
 *
 * The shipped dataset never triggers the warning naturally (GENERIC_LEG's
 * fastest option is 3.5h; every known CITY_PAIR is reasonable), so UI cases
 * inject a synthetic long Springfield ↔ Shelbyville pair into CITY_PAIRS (or
 * lengthen GENERIC_LEG for the unverified path) after load, before submit.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const STOP_PLACEHOLDER = 'Add another city or country and press Enter';
const NO_RENTAL_REQ = 'No rental car';

// Exact reason the injected drive-only 9.5h pair must produce (branch 2,
// with an estimated top-up present).
const VERIFIED_DRIVE_REASON =
  'No direct flight or train on file for Springfield → Shelbyville — the only verified option is a ' +
  '≈10h drive, and the other options shown are unverified estimates. Consider checking real flight ' +
  'or train schedules, or adding an intermediate stop.';

type SynthOpt = { mode: string; hrs: number; estimated: boolean };
type Warning = { kind: string; reason: string } | null;

function submitBtn(page: Page) {
  return page.getByRole('button', { name: /Build My Trip/i });
}

function readStored(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) as string),
    STORAGE_KEY
  );
}

function banner(page: Page) {
  return page.locator('#conflictBanner');
}

function legBlocks(page: Page) {
  return page.locator('#legsContainer .leg-block');
}

function inlineWarn(page: Page, legIndex: number) {
  return legBlocks(page).nth(legIndex).locator('.leg-connection-warning');
}

/** Calls the exposed pure classifier with a synthetic option array. */
function classify(
  page: Page,
  options: SynthOpt[] | null,
  from = 'A',
  to = 'B'
): Promise<Warning> {
  return page.evaluate(
    ([opts, f, t]) => (window as any).classifyLegConnection(opts, f, t),
    [options, from, to] as const
  );
}

/** Injects a synthetic CITY_PAIRS entry (must run after load, before submit). */
function injectPair(page: Page, pair: Record<string, unknown>) {
  return page.evaluate((p) => {
    (window as any).CITY_PAIRS.push(p);
  }, pair);
}

const LONG_DRIVE_PAIR = {
  a: ['springfield'],
  b: ['shelbyville'],
  drive: { dur: '9h30m', hrs: 9.5, base: 240, detail: 'Long haul' },
};

async function addStop(page: Page, name: string) {
  const input = page.getByPlaceholder(STOP_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
}

/** Fills the whole form in known-destination mode (Jun 1–9, 2027). */
async function fillKnownForm(
  page: Page,
  stops: string[],
  opts: { otherRequirements?: string[] } = {}
) {
  await page.getByText('Specific dates').click();
  await page.locator('#startDate').fill('2027-06-01');
  await page.locator('#endDate').fill('2027-06-09');
  await page.locator('#departingFrom').fill('Austin');
  for (const s of stops) await addStop(page, s);
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill('2 adults');
  for (const req of opts.otherRequirements ?? []) {
    await page.locator(`#otherReqs input[value="${req}"]`).check();
  }
}

/** Fills the form in flexible mode (general window, Apr 2027). */
async function fillFlexibleForm(page: Page, regions: string[]) {
  await page.locator('#monthChips .chip[data-month="Apr"]').click();
  await page.locator('#yearPills .pill[data-year="2027"]').click();
  await page.locator('#departingFrom').fill('Austin');
  await page.locator('#destModePills .pill[data-dest-mode="flexible"]').click();
  const regionInput = page.locator('#addRegionInput');
  for (const region of regions) {
    await regionInput.fill(region);
    await regionInput.press('Enter');
  }
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill('2 adults');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
});

// ---------------------------------------------------------------------------
// classifyLegConnection — reasonable legs stay null
// ---------------------------------------------------------------------------
test.describe('classifyLegConnection: reasonable connections are never flagged', () => {
  test('a fast real train yields null even alongside a slow real drive', async ({ page }) => {
    const result = await classify(page, [
      { mode: 'train', hrs: 2.3, estimated: false },
      { mode: 'drive', hrs: 7.5, estimated: false },
    ]);
    expect(result).toBeNull();
  });

  test('a fast estimated-only set (unknown pair) yields null', async ({ page }) => {
    const result = await classify(page, [
      { mode: 'drive', hrs: 4.5, estimated: true },
      { mode: 'train', hrs: 5.5, estimated: true },
      { mode: 'flight', hrs: 3.5, estimated: true },
    ]);
    expect(result).toBeNull();
  });

  test('empty or missing option sets yield null', async ({ page }) => {
    expect(await classify(page, [])).toBeNull();
    expect(await classify(page, null)).toBeNull();
  });

  test('the shipped dataset never triggers the flag naturally: every known pair and the generic fallback classify null', async ({ page }) => {
    const results: Array<{ route: string; warning: Warning }> = await page.evaluate(() => {
      const w = window as any;
      const intake = { travelers: { whoIsGoing: '2 adults' }, otherRequirements: [] };
      const all = w.CITY_PAIRS.map((p: any) => ({
        route: p.a[0] + ' → ' + p.b[0],
        warning: w.classifyLegConnection(
          w.generateLegOptions(p.a[0], p.b[0], intake), p.a[0], p.b[0]
        ),
      }));
      all.push({
        route: 'generic fallback',
        warning: w.classifyLegConnection(
          w.generateLegOptions('Springfield', 'Shelbyville', intake),
          'Springfield', 'Shelbyville'
        ),
      });
      return all;
    });
    for (const r of results) expect(r.warning, r.route).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyLegConnection — verified-long (real flight/train on file)
// ---------------------------------------------------------------------------
test.describe('classifyLegConnection: verified-long with a real flight/train on file', () => {
  test('a real flight that still runs 9h fastest flags the leg with honest verified wording', async ({ page }) => {
    const result = await classify(
      page,
      [
        { mode: 'flight', hrs: 9, estimated: false },
        { mode: 'drive', hrs: 14, estimated: false },
      ],
      'Farville',
      'Remoteton'
    );
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('verified-long');
    expect(result!.reason).toBe(
      'Even the fastest option on file for Farville → Remoteton runs ≈9h door-to-door — a long ' +
        'travel day. Consider an intermediate stop to break it up.'
    );
  });
});

// ---------------------------------------------------------------------------
// classifyLegConnection — verified-long (no real flight/train, real drive/ferry)
// ---------------------------------------------------------------------------
test.describe('classifyLegConnection: verified-long for drive-only pairs', () => {
  test('a 9.5h real drive with a fast estimated top-up is still flagged — estimates never rescue', async ({ page }) => {
    const result = await classify(
      page,
      [
        { mode: 'drive', hrs: 9.5, estimated: false },
        // Faster than the threshold overall, but it's a guess.
        { mode: 'flight', hrs: 3.5, estimated: true },
      ],
      'Springfield',
      'Shelbyville'
    );
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('verified-long');
    expect(result!.reason).toBe(VERIFIED_DRIVE_REASON);
    // The wording is honest about what is and isn't verified.
    expect(result!.reason).toContain('only verified option');
    expect(result!.reason).toContain('unverified estimates');
  });

  test('without estimated top-ups the "unverified estimates" clause is dropped', async ({ page }) => {
    const result = await classify(page, [{ mode: 'drive', hrs: 9, estimated: false }]);
    expect(result!.kind).toBe('verified-long');
    expect(result!.reason).toBe(
      'No direct flight or train on file for A → B — the only verified option is a ≈9h drive. ' +
        'Consider checking real flight or train schedules, or adding an intermediate stop.'
    );
  });

  test('the slow mode is named honestly: a ferry reads "ferry crossing", unknown modes read "trip"', async ({ page }) => {
    const ferry = await classify(page, [{ mode: 'ferry', hrs: 9.5, estimated: false }]);
    expect(ferry!.kind).toBe('verified-long');
    expect(ferry!.reason).toContain('≈10h ferry crossing');

    const bus = await classify(page, [{ mode: 'bus', hrs: 9, estimated: false }]);
    expect(bus!.kind).toBe('verified-long');
    expect(bus!.reason).toContain('≈9h trip');
  });
});

// ---------------------------------------------------------------------------
// classifyLegConnection — unverified-long (unknown pair, all estimated)
// ---------------------------------------------------------------------------
test.describe('classifyLegConnection: unverified-long for all-estimated long legs', () => {
  test('all-estimated 9h+ options flag as unverified with "no route data" wording', async ({ page }) => {
    const result = await classify(
      page,
      [
        { mode: 'drive', hrs: 9.5, estimated: true },
        { mode: 'train', hrs: 9, estimated: true },
      ],
      'Springfield',
      'Shelbyville'
    );
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('unverified-long');
    expect(result!.reason).toBe(
      "We don't have route data for Springfield → Shelbyville — no direct flight or train is on " +
        'file, and every estimated option runs ≈9h or more, so the options above are long-haul ' +
        'guesses. Check real schedules, or consider an intermediate stop.'
    );
    // Honest: it presents guesses, never a verified claim about the route.
    expect(result!.reason).not.toContain('verified option');
  });
});

// ---------------------------------------------------------------------------
// classifyLegConnection — 8h boundary and determinism
// ---------------------------------------------------------------------------
test.describe('classifyLegConnection: threshold boundary and determinism', () => {
  test('exactly 8.0h is still reasonable in every branch; just over 8h flags', async ({ page }) => {
    // Branch 1: real flight
    expect(await classify(page, [{ mode: 'flight', hrs: 8, estimated: false }])).toBeNull();
    const overFlight = await classify(page, [{ mode: 'flight', hrs: 8.2, estimated: false }]);
    expect(overFlight!.kind).toBe('verified-long');

    // Branch 2: real drive only
    expect(await classify(page, [{ mode: 'drive', hrs: 8, estimated: false }])).toBeNull();
    const overDrive = await classify(page, [{ mode: 'drive', hrs: 8.2, estimated: false }]);
    expect(overDrive!.kind).toBe('verified-long');

    // Branch 3: all estimated
    expect(await classify(page, [{ mode: 'drive', hrs: 8, estimated: true }])).toBeNull();
    const overEst = await classify(page, [{ mode: 'drive', hrs: 8.2, estimated: true }]);
    expect(overEst!.kind).toBe('unverified-long');
  });

  test('classification is deterministic for identical inputs', async ({ page }) => {
    const options: SynthOpt[] = [
      { mode: 'drive', hrs: 9.5, estimated: false },
      { mode: 'flight', hrs: 3.5, estimated: true },
    ];
    const a = await classify(page, options, 'Springfield', 'Shelbyville');
    const b = await classify(page, options, 'Springfield', 'Shelbyville');
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// UI — flagged leg: inline warning + banner, warn-and-continue
// ---------------------------------------------------------------------------
test.describe('Flagged leg in the results view (injected long drive-only pair)', () => {
  test('submit surfaces the trade-off inline under the leg and in the conflict banner without blocking', async ({ page }) => {
    await injectPair(page, LONG_DRIVE_PAIR);
    await fillKnownForm(page, ['Springfield', 'Shelbyville']);
    await submitBtn(page).click();

    // Warn and continue: the plan renders fully — nothing is blocked.
    await expect(page.locator('#confirmationCard')).toBeVisible();
    await expect(page.locator('#errorBanner')).toBeHidden();
    await expect(page.locator('#legsSection')).toBeVisible();

    // Inline warning under the flagged leg's cards, with kind + honest wording.
    const warn = inlineWarn(page, 0);
    await expect(warn).toBeVisible();
    await expect(warn).toHaveAttribute('data-connection-warning-kind', 'verified-long');
    await expect(warn).toHaveAttribute('role', 'note');
    await expect(warn.locator('.icon')).toHaveText('⚠');
    await expect(warn).toContainText(VERIFIED_DRIVE_REASON);

    // The leg is NOT silently routed around: the long drive still renders as
    // a selectable option (plus the estimated top-up), and the fast estimated
    // top-up did not suppress the flag.
    const cards = legBlocks(page).nth(0).locator('.option-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Drive (rental car)' })).toBeVisible();

    // Global banner: a single warning renders inline (no list) with the same line.
    await expect(banner(page)).toBeVisible();
    await expect(banner(page).locator('ul')).toHaveCount(0);
    await expect(banner(page)).toContainText(VERIFIED_DRIVE_REASON);

    // Persistence: {kind, reason} exactly, plus the banner line.
    const data = await readStored(page);
    expect(data.legs).toHaveLength(1);
    expect(data.legs[0].connectionWarning).toEqual({
      kind: 'verified-long',
      reason: VERIFIED_DRIVE_REASON,
    });
    expect(data.conflictWarnings).toEqual([VERIFIED_DRIVE_REASON]);
  });

  test('selecting an option within the flagged leg keeps the options usable and the flag unchanged', async ({ page }) => {
    await injectPair(page, LONG_DRIVE_PAIR);
    await fillKnownForm(page, ['Springfield', 'Shelbyville']);
    await submitBtn(page).click();

    const before = await readStored(page);
    expect(before.legs[0].connectionWarning.kind).toBe('verified-long');

    // The flagged long drive stays fully selectable (warn-and-continue).
    const driveCard = legBlocks(page)
      .nth(0)
      .locator('.option-card')
      .filter({ hasText: 'Drive (rental car)' });
    await driveCard.click();
    await expect(driveCard).toHaveClass(/selected/);

    // Selection persisted; the connection flag is untouched (it depends only
    // on the option set) and the inline warning is still shown.
    const after = await readStored(page);
    expect(after.legs[0].selected).toBe('Drive (rental car)');
    expect(after.legs[0].connectionWarning).toEqual(before.legs[0].connectionWarning);
    await expect(inlineWarn(page, 0)).toBeVisible();
    await expect(inlineWarn(page, 0)).toHaveAttribute(
      'data-connection-warning-kind',
      'verified-long'
    );
  });

  test('an all-estimated long leg (lengthened GENERIC_LEG) flags as unverified-long with honest wording', async ({ page }) => {
    // Make the unknown-pair fallback itself long: every option is an estimate.
    await page.evaluate(() => {
      const g = (window as any).GENERIC_LEG;
      g.drive.hrs = 10.5;
      g.train.hrs = 11;
      g.flight.hrs = 9;
    });
    await fillKnownForm(page, ['Springfield', 'Shelbyville']);
    await submitBtn(page).click();

    const warn = inlineWarn(page, 0);
    await expect(warn).toBeVisible();
    await expect(warn).toHaveAttribute('data-connection-warning-kind', 'unverified-long');
    await expect(warn).toContainText(
      "We don't have route data for Springfield → Shelbyville"
    );
    await expect(warn).toContainText('long-haul guesses');
    // Unverified wording never claims a verified fact about the route.
    await expect(warn).not.toContainText('verified option');

    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('long-haul guesses');
    const data = await readStored(page);
    expect(data.legs[0].connectionWarning.kind).toBe('unverified-long');
  });

  test('coexists with a requirement conflict: the banner lists both, each flagged leg gets one line', async ({ page }) => {
    // Ferry-only long pair so "No rental car" can't remove the verified
    // option; the No-rental squeeze fires on the other (drive-first) legs.
    await injectPair(page, {
      a: ['springfield'],
      b: ['shelbyville'],
      ferry: { dur: '9h30m', hrs: 9.5, fare: 60, detail: 'Seasonal crossing' },
    });
    await fillKnownForm(page, ['Austin', 'Dallas', 'Springfield', 'Shelbyville'], {
      otherRequirements: [NO_RENTAL_REQ],
    });
    await submitBtn(page).click();

    // Two warnings → intro + list, requirement squeeze first, then the leg line.
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText(
      'Heads up — a few of your requirements are in tension with these results:'
    );
    const items = banner(page).locator('ul li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('"No rental car" is a squeeze');
    await expect(items.nth(1)).toContainText(
      'No direct flight or train on file for Springfield → Shelbyville — the only verified option is a ≈10h ferry crossing'
    );

    // Inline: only the flagged leg carries the warning.
    await expect(legBlocks(page)).toHaveCount(3);
    await expect(inlineWarn(page, 0)).toHaveCount(0);
    await expect(inlineWarn(page, 1)).toHaveCount(0);
    await expect(inlineWarn(page, 2)).toBeVisible();
    await expect(inlineWarn(page, 2)).toHaveAttribute(
      'data-connection-warning-kind',
      'verified-long'
    );

    const data = await readStored(page);
    expect(data.conflictWarnings).toHaveLength(2);
    expect(data.legs[2].connectionWarning.kind).toBe('verified-long');
    expect(data.legs[0].connectionWarning).toBeNull();
    expect(data.legs[1].connectionWarning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// UI — reasonable trips are untouched
// ---------------------------------------------------------------------------
test.describe('Reasonable connections stay unflagged in the UI', () => {
  test('a normal known-pair trip shows no inline warning and no banner, with null persisted per leg', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas', 'Houston']);
    await submitBtn(page).click();

    await expect(page.locator('#legsSection')).toBeVisible();
    await expect(legBlocks(page)).toHaveCount(2);
    await expect(page.locator('.leg-connection-warning')).toHaveCount(0);
    await expect(banner(page)).toBeHidden();

    // The flag is still computed and persisted — explicitly null, not absent.
    const data = await readStored(page);
    expect(data.conflictWarnings).toEqual([]);
    for (const leg of data.legs) {
      expect('connectionWarning' in leg).toBe(true);
      expect(leg.connectionWarning).toBeNull();
    }
  });

  test('legs rebuilt on a destination-option switch carry the recomputed flag', async ({ page }) => {
    await fillFlexibleForm(page, ['Texas']);
    await submitBtn(page).click();

    // Recommended Texas pick is single-stop (no legs); switch to the
    // two-stop option → the rebuilt leg carries a (null) connectionWarning.
    await page
      .locator('#destOptionsGrid .option-card[data-option-name="Austin + San Antonio"]')
      .click();

    const data = await readStored(page);
    expect(data.legs.length).toBeGreaterThan(0);
    for (const leg of data.legs) {
      expect('connectionWarning' in leg).toBe(true);
      expect(leg.connectionWarning).toBeNull();
    }
    await expect(page.locator('.leg-connection-warning')).toHaveCount(0);
  });
});
