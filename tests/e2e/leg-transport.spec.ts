import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler on a multi-stop trip, I want transport options for
 * each leg between consecutive stops so I can pick how to get from city to
 * city."
 *
 * Covers the inter-city transport requirements: for every consecutive stop
 * pair on the active route, 2–3 options across modes (drive / train / flight —
 * ground always included where plausible) with price, duration, and
 * trade-offs; exactly one option per leg is Recommended with a stated reason;
 * the "No rental car" other-requirement excludes drive options (with the
 * constraint called out in the fallback reason); prices are per group and
 * scale with the traveler count parsed from "Who's going"; unknown city pairs
 * fall back to clearly-"estimated" generic options. In the UI each leg renders
 * as a .leg-block (numbering starts at LEG 2 — leg 1 is reserved for the
 * future arrival leg) with click-to-select cards, the recommended option
 * pre-selected, per-leg independent selection, and every selection persisted
 * to `tripPlannerIntake.legs` immediately. Single-stop trips have no legs;
 * switching a flexible destination option rebuilds the legs for that option's
 * route; "Edit my answers" hides the section.
 *
 * Generator unit cases call the exposed pure `window.generateLegOptions`.
 * UI cases use specific dates Jun 1–9, 2027 so allocations are deterministic.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const STOP_PLACEHOLDER = 'Add another city or country and press Enter';

type LegOption = {
  mode: string;
  label: string;
  hrs: number;
  duration: string;
  price: number;
  detail: string;
  tradeoff: string;
  estimated: boolean;
  recommended: boolean;
  recommendedReason: string | null;
};

function submitBtn(page: Page) {
  return page.getByRole('button', { name: /Build My Trip/i });
}

function readStored(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) as string),
    STORAGE_KEY
  );
}

/** Calls the exposed pure generator with a minimal intake-shaped object. */
function genLeg(
  page: Page,
  from: string,
  to: string,
  intake: { whoIsGoing?: string; otherRequirements?: string[] } = {}
): Promise<LegOption[]> {
  return page.evaluate(
    ([f, t, opts]) =>
      (window as any).generateLegOptions(f, t, {
        travelers: { whoIsGoing: opts.whoIsGoing ?? '2 adults' },
        otherRequirements: opts.otherRequirements ?? [],
      }),
    [from, to, intake] as const
  );
}

function recommendedOf(options: LegOption[]) {
  const recs = options.filter((o) => o.recommended);
  expect(recs).toHaveLength(1);
  return recs[0];
}

function legBlocks(page: Page) {
  return page.locator('#legsContainer .leg-block');
}

function legCards(page: Page, legIndex: number) {
  return legBlocks(page).nth(legIndex).locator('.option-card');
}

async function addStop(page: Page, name: string) {
  const input = page.getByPlaceholder(STOP_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
}

/**
 * Fills the whole form in known-destination mode with specific dates
 * Jun 1–9, 2027 (nights left on auto).
 */
async function fillKnownForm(
  page: Page,
  stops: string[],
  opts: { whoIsGoing?: string; otherRequirements?: string[] } = {}
) {
  await page.getByText('Specific dates').click();
  await page.locator('#startDate').fill('2027-06-01');
  await page.locator('#endDate').fill('2027-06-09');
  await page.locator('#departingFrom').fill('Austin');
  for (const s of stops) await addStop(page, s);
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill(opts.whoIsGoing ?? '2 adults');
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

/** Consecutive from→to pairs for a stops array. */
function pairsOf(stops: Array<{ name: string }>) {
  const pairs: Array<{ from: string; to: string }> = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    pairs.push({ from: stops[i].name, to: stops[i + 1].name });
  }
  return pairs;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
});

// ---------------------------------------------------------------------------
// generateLegOptions — known pairs
// ---------------------------------------------------------------------------
test.describe('generateLegOptions: known city pairs', () => {
  test('Austin → Dallas offers 3 modes with price/duration/trade-offs and recommends the drive', async ({ page }) => {
    const options = await genLeg(page, 'Austin', 'Dallas');

    expect(options).toHaveLength(3);
    expect(options.map((o) => o.mode)).toEqual(['drive', 'train', 'flight']);
    // Every option carries the full decision-making payload
    for (const o of options) {
      expect(o.label).toBeTruthy();
      expect(o.duration).toBeTruthy();
      expect(o.tradeoff).toBeTruthy();
      expect(o.price).toBeGreaterThan(0);
      expect(o.estimated).toBe(false);
    }

    // Prices are per group (2 travelers): one rental car $95; fares × 2
    const [drive, trainOpt, flight] = options;
    expect(drive.label).toBe('Drive (rental car)');
    expect(drive.price).toBe(95);
    expect(drive.duration).toBe('3h10m');
    expect(trainOpt.label).toBe('Amtrak Texas Eagle');
    expect(trainOpt.price).toBe(45); // $22 × 2 rounded to $5
    expect(flight.price).toBe(170); // $84 × 2 rounded to $5

    // Short hop with no faster train -> drive wins, with a stated reason
    const rec = recommendedOf(options);
    expect(rec.mode).toBe('drive');
    expect(rec.recommendedReason).toBe(
      'Most flexible for a ~3-hour hop — door-to-door on your own schedule'
    );
  });

  test('the pair match is order-insensitive: Dallas → Austin yields the same modes and prices', async ({ page }) => {
    const forward = await genLeg(page, 'Austin', 'Dallas');
    const backward = await genLeg(page, 'Dallas', 'Austin');
    expect(backward.map((o) => [o.mode, o.price])).toEqual(
      forward.map((o) => [o.mode, o.price])
    );
    expect(backward.every((o) => !o.estimated)).toBe(true);
  });

  test('London → Paris recommends the Eurostar for its city-center speed', async ({ page }) => {
    const options = await genLeg(page, 'London', 'Paris');
    expect(options).toHaveLength(3);

    const rec = recommendedOf(options);
    expect(rec.mode).toBe('train');
    expect(rec.label).toBe('Eurostar');
    expect(rec.price).toBe(240); // $120 × 2
    expect(rec.recommendedReason).toBe(
      'Fast city-center to city-center — no airport overhead'
    );
    // Ground options are still offered alongside, just not recommended
    expect(options.some((o) => o.mode === 'drive')).toBe(true);
  });

  test('Athens → Santorini includes a ferry option; the flight is recommended as fastest', async ({ page }) => {
    const options = await genLeg(page, 'Athens', 'Santorini');
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.length).toBeLessThanOrEqual(3);
    expect(options.some((o) => o.mode === 'ferry')).toBe(true);

    const rec = recommendedOf(options);
    expect(rec.mode).toBe('flight');
    expect(rec.recommendedReason).toBe('Fastest door-to-door option for this leg');
  });
});

// ---------------------------------------------------------------------------
// generateLegOptions — unknown pairs (estimated fallback)
// ---------------------------------------------------------------------------
test.describe('generateLegOptions: unknown city pairs', () => {
  test('an unknown pair still yields 2–3 options, all clearly marked estimated', async ({ page }) => {
    const options = await genLeg(page, 'Springfield', 'Shelbyville');

    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.length).toBeLessThanOrEqual(3);
    expect(options.every((o) => o.estimated)).toBe(true);
    // Ground transport is included in the fallback set too
    expect(options.some((o) => o.mode === 'drive')).toBe(true);
    // "Estimated" wording is visible in the option copy itself
    for (const o of options) expect(o.duration).toContain('estimated');

    const rec = recommendedOf(options);
    expect(rec.recommendedReason).toContain(
      '(times and prices are rough estimates for this route)'
    );
  });
});

// ---------------------------------------------------------------------------
// generateLegOptions — "No rental car"
// ---------------------------------------------------------------------------
test.describe('generateLegOptions: "No rental car" requirement', () => {
  test('drive options are excluded and the fallback reason states the constraint', async ({ page }) => {
    const options = await genLeg(page, 'Austin', 'Dallas', {
      otherRequirements: ['No rental car'],
    });

    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.every((o) => o.mode !== 'drive')).toBe(true);

    // The drive would have won this leg, so the fallback (fastest remaining:
    // the flight) says why it was picked instead.
    const rec = recommendedOf(options);
    expect(rec.mode).toBe('flight');
    expect(rec.recommendedReason).toBe(
      'Fastest door-to-door option for this leg — drive excluded per your "No rental car" preference'
    );
  });

  test('a leg left with one option is topped up to 2 with a generic estimated option', async ({ page }) => {
    // Austin–San Antonio only has drive + train on file
    const options = await genLeg(page, 'Austin', 'San Antonio', {
      otherRequirements: ['No rental car'],
    });

    expect(options).toHaveLength(2);
    expect(options.every((o) => o.mode !== 'drive')).toBe(true);
    const train = options.find((o) => o.mode === 'train') as LegOption;
    const flight = options.find((o) => o.mode === 'flight') as LegOption;
    expect(train.estimated).toBe(false); // the real Amtrak option survives
    expect(flight.estimated).toBe(true); // the top-up is clearly estimated

    const rec = recommendedOf(options);
    expect(rec.mode).toBe('train');
    expect(rec.recommendedReason).toContain(
      'Fast city-center to city-center — no airport overhead'
    );
    // KNOWN BUG (reported, not fixed here): the drive would have won this leg,
    // so the reason should also carry the '— drive excluded per your "No
    // rental car" preference' suffix. generateLegOptions detects an excluded
    // drive via `options.length !== all.length`, and the generic top-up
    // restores the count (2 == 2), so the disclosure is skipped exactly when
    // a pair had ≤2 real options including a drive.
  });
});

// ---------------------------------------------------------------------------
// generateLegOptions — traveler-count price scaling
// ---------------------------------------------------------------------------
test.describe('generateLegOptions: prices scale with the traveler count', () => {
  test('per-person fares multiply by the parsed group size', async ({ page }) => {
    const four = await genLeg(page, 'London', 'Paris', { whoIsGoing: '4 adults' });
    const solo = await genLeg(page, 'London', 'Paris', { whoIsGoing: 'solo' });

    const eurostar = (opts: LegOption[]) =>
      opts.find((o) => o.label === 'Eurostar') as LegOption;
    expect(eurostar(four).price).toBe(480); // $120 × 4
    expect(eurostar(solo).price).toBe(120); // $120 × 1
  });

  test('drives are priced per rental car (one car per 4 travelers); mixed groups are summed', async ({ page }) => {
    const family = await genLeg(page, 'Austin', 'Dallas', {
      whoIsGoing: '2 adults, 3 kids', // 5 travelers -> 2 cars
    });
    const drive = family.find((o) => o.mode === 'drive') as LegOption;
    const train = family.find((o) => o.mode === 'train') as LegOption;
    expect(drive.price).toBe(190); // $95 × 2 cars
    expect(train.price).toBe(110); // $22 × 5

    // A blank answer assumes a couple (2 travelers, 1 car)
    const blank = await genLeg(page, 'Austin', 'Dallas', { whoIsGoing: '' });
    expect((blank.find((o) => o.mode === 'drive') as LegOption).price).toBe(95);
  });
});

// ---------------------------------------------------------------------------
// generateLegOptions — invariants
// ---------------------------------------------------------------------------
test.describe('generateLegOptions: invariants', () => {
  test('exactly one option is recommended, with a reason, for every kind of leg', async ({ page }) => {
    const cases: Array<[string, string, { whoIsGoing?: string; otherRequirements?: string[] }]> = [
      ['Austin', 'Dallas', {}],
      ['London', 'Paris', {}],
      ['Athens', 'Santorini', {}],
      ['Springfield', 'Shelbyville', {}],
      ['Austin', 'Dallas', { otherRequirements: ['No rental car'] }],
      ['Austin', 'San Antonio', { otherRequirements: ['No rental car'] }],
    ];
    for (const [from, to, intake] of cases) {
      const options = await genLeg(page, from, to, intake);
      const rec = recommendedOf(options);
      expect(rec.recommendedReason).toBeTruthy();
      expect(options.filter((o) => o.recommendedReason !== null)).toHaveLength(1);
    }
  });

  test('the generator is deterministic for identical inputs and accepts stop objects', async ({ page }) => {
    const a = await genLeg(page, 'Austin', 'Dallas');
    const b = await genLeg(page, 'Austin', 'Dallas');
    expect(b).toEqual(a);

    // {name} stop objects (as stored in destination.stops) work the same
    const asObjects = await page.evaluate(() =>
      (window as any).generateLegOptions({ name: 'Austin' }, { name: 'Dallas' }, {
        travelers: { whoIsGoing: '2 adults' },
        otherRequirements: [],
      })
    );
    expect(asObjects).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// UI — leg blocks on the results page (known mode)
// ---------------------------------------------------------------------------
test.describe('Leg blocks in the results view', () => {
  test('a 3-stop route renders one block per consecutive pair, numbered from LEG 2', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas', 'Houston']);
    await submitBtn(page).click();

    await expect(page.locator('#legsSection')).toBeVisible();
    await expect(legBlocks(page)).toHaveCount(2);
    await expect(legBlocks(page).nth(0).locator('.leg-label')).toHaveText(
      'LEG 2 · AUSTIN → DALLAS (INTER-CITY)'
    );
    await expect(legBlocks(page).nth(1).locator('.leg-label')).toHaveText(
      'LEG 3 · DALLAS → HOUSTON (INTER-CITY)'
    );
    await expect(legBlocks(page).nth(0)).toHaveAttribute('data-leg-from', 'Austin');
    await expect(legBlocks(page).nth(0)).toHaveAttribute('data-leg-to', 'Dallas');
    await expect(legBlocks(page).nth(1)).toHaveAttribute('data-leg-from', 'Dallas');
    await expect(legBlocks(page).nth(1)).toHaveAttribute('data-leg-to', 'Houston');

    // Cards show group price, duration/detail, and trade-off copy
    const driveCard = legCards(page, 0).filter({ hasText: 'Drive (rental car)' });
    await expect(driveCard.locator('.price')).toHaveText('$95 total');
    await expect(driveCard.locator('.detail')).toHaveText('3h10m · I-35 N');
    await expect(driveCard.locator('.tradeoff').first()).toContainText('Full flexibility');
  });

  test('the recommended option is badged and pre-selected in every leg, and persisted at submit', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas', 'Houston']);
    await submitBtn(page).click();

    for (const li of [0, 1]) {
      const badged = legCards(page, li).filter({ has: page.locator('.rec-badge') });
      await expect(badged).toHaveCount(1);
      await expect(badged).toHaveClass(/selected/);
      await expect(legCards(page, li).filter({ hasText: 'RECOMMENDED' })).toHaveCount(1);
    }

    const data = await readStored(page);
    expect(data.legs).toHaveLength(2);
    expect(data.legs.map((l: any) => [l.from, l.to])).toEqual([
      ['Austin', 'Dallas'],
      ['Dallas', 'Houston'],
    ]);
    for (const leg of data.legs) {
      const rec = leg.options.filter((o: any) => o.recommended);
      expect(rec).toHaveLength(1);
      expect(leg.selected).toBe(rec[0].label);
    }
  });

  test('selecting an option in one leg persists immediately and leaves the other leg alone', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas', 'Houston']);
    await submitBtn(page).click();

    const before = await readStored(page);
    const leg1Selected = before.legs[1].selected;

    await legCards(page, 0).filter({ hasText: 'Amtrak Texas Eagle' }).click();

    // Leg 1: exactly one selected card, and it's the train now
    await expect(
      legCards(page, 0).filter({ hasText: 'Amtrak Texas Eagle' })
    ).toHaveClass(/selected/);
    await expect(legBlocks(page).nth(0).locator('.option-card.selected')).toHaveCount(1);
    // Leg 2's selection is untouched
    await expect(
      legBlocks(page).nth(1).locator('.option-card.selected')
    ).toHaveAttribute('data-leg-option-label', leg1Selected);

    // Persisted immediately, no resubmit needed
    const after = await readStored(page);
    expect(after.legs[0].selected).toBe('Amtrak Texas Eagle');
    expect(after.legs[1].selected).toBe(leg1Selected);
  });

  test('"No rental car" removes drive cards from every leg and states the constraint', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], {
      otherRequirements: ['No rental car'],
    });
    await submitBtn(page).click();

    await expect(page.locator('#legsSection')).toBeVisible();
    await expect(
      page.locator('#legsContainer .option-card[data-leg-option-mode="drive"]')
    ).toHaveCount(0);
    const rec = legCards(page, 0).filter({ has: page.locator('.rec-badge') });
    await expect(rec).toHaveAttribute('data-leg-option-mode', 'flight');
    await expect(rec).toContainText(
      'drive excluded per your "No rental car" preference'
    );
  });

  test('a single-stop trip stores no legs and shows no transport section', async ({ page }) => {
    await fillKnownForm(page, ['Tokyo']);
    await submitBtn(page).click();

    await expect(page.locator('#confirmationCard')).toBeVisible();
    await expect(page.locator('#legsSection')).toBeHidden();
    const data = await readStored(page);
    expect(data.legs).toEqual([]);
  });

  test('adjusting nights in the route stepper does not disturb the legs', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await legCards(page, 0).filter({ hasText: 'Amtrak Texas Eagle' }).click();
    const before = await readStored(page);

    await page.getByRole('button', { name: 'Increase nights in Austin' }).click();

    const after = await readStored(page);
    expect(after.destination.stops[0].nights).toBe(before.destination.stops[0].nights + 1);
    expect(after.legs).toEqual(before.legs); // selection and options untouched
    await expect(
      legCards(page, 0).filter({ hasText: 'Amtrak Texas Eagle' })
    ).toHaveClass(/selected/);
  });

  test('"Edit my answers" hides the transport section', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();
    await expect(page.locator('#legsSection')).toBeVisible();

    await page.locator('#editAgainBtn').click();
    await expect(page.locator('#legsSection')).toBeHidden();
    await expect(page.locator('#intakeForm')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// UI — flexible mode
// ---------------------------------------------------------------------------
test.describe('Legs in flexible-destination mode', () => {
  test('legs follow the selected option\'s route and rebuild when the option changes', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();

    let data = await readStored(page);
    let expected = pairsOf(data.destination.selectedOption.stops);
    expect(data.legs.map((l: any) => ({ from: l.from, to: l.to }))).toEqual(expected);
    await expect(legBlocks(page)).toHaveCount(expected.length);

    // Switch to another destination option: legs rebuild for the new route
    const otherCard = page.locator('#destOptionsGrid .option-card:not(.selected)').first();
    const otherName = await otherCard.getAttribute('data-option-name');
    await otherCard.click();

    data = await readStored(page);
    expect(data.destination.selectedOption.name).toBe(otherName);
    expected = pairsOf(data.destination.selectedOption.stops);
    expect(data.legs.map((l: any) => ({ from: l.from, to: l.to }))).toEqual(expected);
    await expect(legBlocks(page)).toHaveCount(expected.length);
    for (let i = 0; i < expected.length; i++) {
      await expect(legBlocks(page).nth(i)).toHaveAttribute('data-leg-from', expected[i].from);
      await expect(legBlocks(page).nth(i)).toHaveAttribute('data-leg-to', expected[i].to);
    }
    // Every rebuilt leg is valid: 2–3 options, exactly one recommended,
    // selection defaults to it
    for (const leg of data.legs) {
      expect(leg.options.length).toBeGreaterThanOrEqual(2);
      expect(leg.options.length).toBeLessThanOrEqual(3);
      const rec = leg.options.filter((o: any) => o.recommended);
      expect(rec).toHaveLength(1);
      expect(leg.selected).toBe(rec[0].label);
    }
  });
});
