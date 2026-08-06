import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler, I want 2–3 lodging options for each stop on my
 * route, matched to my trip style and traveler mix, so I can pick where to
 * stay in each place."
 *
 * Covers the per-stop lodging requirements: every stop on the active route
 * gets 2–3 lodging options (central / quiet / value archetypes) with a price
 * per night, a location description, and a trade-off; exactly one option per
 * stop is Recommended with a stated reason driven by the trip style
 * (relaxation → the quiet stay, cultural → the central/historic base,
 * adventure → the city's best activity base, balanced → the
 * price-for-location pick) and nudged by the traveler mix (kids boost
 * family-fit stays, accessibility needs boost step-free-friendly ones — with
 * wording only for what actually fired); known cities use real neighborhood
 * names while unknown cities fall back to clearly-"estimated" generic
 * archetypes priced off the region's cost level. In the UI each stop renders
 * as a "STOP N · CITY" block with click-to-select cards, the recommended
 * option pre-selected, per-stop independent selection persisted to
 * `tripPlannerIntake.lodging` immediately, single-stop trips get one section,
 * flexible mode follows the selected destination option (switching rebuilds
 * lodging, preserving selections for surviving cities), nights edits leave
 * lodging untouched, and "Edit my answers" hides the section.
 *
 * Generator unit cases call the exposed pure `window.generateLodgingOptions`.
 * UI cases use specific dates Jun 1–9, 2027 so allocations are deterministic.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const STOP_PLACEHOLDER = 'Add another city or country and press Enter';

type LodgingOption = {
  role: string;
  name: string;
  pricePerNight: number;
  location: string;
  tradeoff: string;
  familyFit: boolean;
  accessFit: boolean;
  estimated: boolean;
  matchScore: number;
  recommended: boolean;
  recommendedReason: string | null;
};

type GenIntake = {
  tripStyle?: string;
  whoIsGoing?: string;
  constraints?: string;
  otherRequirements?: string[];
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
function genLodging(
  page: Page,
  stop: string | { name: string },
  intake: GenIntake = {}
): Promise<LodgingOption[]> {
  return page.evaluate(
    ([s, opts]) =>
      (window as any).generateLodgingOptions(s, {
        tripStyle: opts.tripStyle ?? 'Balanced mix',
        travelers: {
          whoIsGoing: opts.whoIsGoing ?? '2 adults',
          constraints: opts.constraints ?? '',
        },
        otherRequirements: opts.otherRequirements ?? [],
      }),
    [stop, intake] as const
  );
}

function recommendedOf(options: LodgingOption[]) {
  const recs = options.filter((o) => o.recommended);
  expect(recs).toHaveLength(1);
  return recs[0];
}

function lodgingBlocks(page: Page) {
  return page.locator('#lodgingContainer .leg-block');
}

function lodgingCards(page: Page, stopIndex: number) {
  return lodgingBlocks(page).nth(stopIndex).locator('.option-card');
}

async function addStop(page: Page, name: string) {
  const input = page.getByPlaceholder(STOP_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
}

/**
 * Fills the whole form in known-destination mode with specific dates
 * Jun 1–9, 2027 (nights left on auto, style left on the Balanced default
 * unless overridden).
 */
async function fillKnownForm(
  page: Page,
  stops: string[],
  opts: { whoIsGoing?: string; style?: string; otherRequirements?: string[] } = {}
) {
  await page.getByText('Specific dates').click();
  await page.locator('#startDate').fill('2027-06-01');
  await page.locator('#endDate').fill('2027-06-09');
  await page.locator('#departingFrom').fill('Austin');
  for (const s of stops) await addStop(page, s);
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill(opts.whoIsGoing ?? '2 adults');
  if (opts.style) {
    await page.locator('#styleLabels span', { hasText: opts.style }).click();
  }
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
// generateLodgingOptions — known cities: 3 options with the full payload
// ---------------------------------------------------------------------------
test.describe('generateLodgingOptions: known cities', () => {
  test('Austin offers 3 real-neighborhood options with price/location/trade-off, one recommended', async ({ page }) => {
    const options = await genLodging(page, 'Austin');

    expect(options).toHaveLength(3);
    expect(options.map((o) => o.role)).toEqual(['central', 'quiet', 'value']);
    expect(options.map((o) => o.name)).toEqual([
      'Downtown high-rise hotel',
      'South Congress boutique hotel',
      'East Austin guesthouse',
    ]);
    // Every option carries the full decision-making payload
    for (const o of options) {
      expect(o.location).toBeTruthy();
      expect(o.tradeoff).toBeTruthy();
      expect(o.pricePerNight).toBeGreaterThan(0);
      expect(o.estimated).toBe(false);
    }
    const rec = recommendedOf(options);
    expect(rec.recommendedReason).toBeTruthy();
    expect(options.filter((o) => o.recommendedReason !== null)).toHaveLength(1);
  });

  test('prices per night are the city cost base × archetype factor, rounded to $5', async ({ page }) => {
    // Austin is a high-cost city (base $110 mid / $170 high): 1.3× / 1.0× / 0.7×
    const austin = await genLodging(page, 'Austin');
    expect(austin.map((o) => o.pricePerNight)).toEqual([220, 170, 120]);

    // Bangkok is low-cost (base $55)
    const bangkok = await genLodging(page, 'Bangkok');
    expect(bangkok.map((o) => o.pricePerNight)).toEqual([70, 55, 40]);

    // New York is premium (base $240)
    const nyc = await genLodging(page, 'New York');
    expect(nyc.map((o) => o.pricePerNight)).toEqual([310, 240, 170]);
  });
});

// ---------------------------------------------------------------------------
// generateLodgingOptions — trip style picks the recommendation
// ---------------------------------------------------------------------------
test.describe('generateLodgingOptions: trip style drives the recommendation', () => {
  test('Relaxation recommends the quiet stay with a relaxation reason', async ({ page }) => {
    const options = await genLodging(page, 'Austin', { tripStyle: 'Relaxation' });
    const rec = recommendedOf(options);
    expect(rec.role).toBe('quiet');
    expect(rec.name).toBe('South Congress boutique hotel');
    expect(rec.recommendedReason).toBe(
      'Quietest of the three — the easiest place to actually unwind, matching your relaxation focus'
    );
  });

  test('Cultural exploration recommends the central base with a cultural reason', async ({ page }) => {
    const options = await genLodging(page, 'Austin', { tripStyle: 'Cultural exploration' });
    const rec = recommendedOf(options);
    expect(rec.role).toBe('central');
    expect(rec.name).toBe('Downtown high-rise hotel');
    expect(rec.recommendedReason).toBe(
      'Walkable to the historic center and the main sights — the best base for cultural exploration'
    );
  });

  test('Balanced mix recommends the price-for-location pick with a balance reason', async ({ page }) => {
    const options = await genLodging(page, 'Austin', { tripStyle: 'Balanced mix' });
    const rec = recommendedOf(options);
    expect(rec.role).toBe('quiet');
    expect(rec.recommendedReason).toBe(
      'Best price-for-location balance of the three for a balanced trip'
    );
  });

  test('Adventure recommends the city\'s activity base with an adventure reason', async ({ page }) => {
    // Queenstown names its activity base explicitly
    const queenstown = await genLodging(page, 'Queenstown', { tripStyle: 'Adventure' });
    const rec = recommendedOf(queenstown);
    expect(rec.role).toBe('central');
    expect(rec.name).toBe('Lakefront hotel');
    expect(rec.recommendedReason).toBe(
      'Well-placed base for early starts and day activities — matching your adventure focus'
    );

    // Cities without a named activity base default to the central stay
    const generic = await genLodging(page, 'Springfield', { tripStyle: 'Adventure' });
    expect(recommendedOf(generic).role).toBe('central');
  });

  test('the same city flips its recommendation as the style changes', async ({ page }) => {
    const byStyle = async (style: string) =>
      recommendedOf(await genLodging(page, 'Austin', { tripStyle: style }));
    const relax = await byStyle('Relaxation');
    const cultural = await byStyle('Cultural exploration');
    const balanced = await byStyle('Balanced mix');
    expect(relax.name).not.toBe(cultural.name);
    // Even when two styles land on the same stay, the stated reason differs
    expect(relax.name).toBe(balanced.name);
    expect(relax.recommendedReason).not.toBe(balanced.recommendedReason);
  });
});

// ---------------------------------------------------------------------------
// generateLodgingOptions — traveler mix: kids
// ---------------------------------------------------------------------------
test.describe('generateLodgingOptions: kids in the party', () => {
  test('kids parsed from "who\'s going" add family wording to the family-fit winner', async ({ page }) => {
    const options = await genLodging(page, 'Austin', {
      tripStyle: 'Balanced mix',
      whoIsGoing: '2 adults, 2 kids',
    });
    const rec = recommendedOf(options);
    expect(rec.familyFit).toBe(true);
    expect(rec.recommendedReason).toBe(
      'Best price-for-location balance of the three for a balanced trip — and a comfortable fit with kids in tow'
    );
    expect(rec.location).toContain('family rooms and extra space are easier to find here');
    // Non-family-fit options don't get the family wording
    const central = options.find((o) => o.role === 'central') as LodgingOption;
    expect(central.location).not.toContain('family rooms');
  });

  test('the Kid-friendly checkbox triggers the same boost without kids in the free text', async ({ page }) => {
    const options = await genLodging(page, 'Austin', {
      tripStyle: 'Balanced mix',
      whoIsGoing: '2 adults',
      otherRequirements: ['Kid-friendly'],
    });
    const rec = recommendedOf(options);
    expect(rec.recommendedReason).toContain('— and a comfortable fit with kids in tow');
    expect(rec.matchScore).toBe(5); // style +3, family fit +2
  });

  test('teens do not count as kids — no family wording fires', async ({ page }) => {
    const options = await genLodging(page, 'Austin', {
      tripStyle: 'Balanced mix',
      whoIsGoing: '2 adults, 2 teens',
    });
    const rec = recommendedOf(options);
    expect(rec.recommendedReason).toBe(
      'Best price-for-location balance of the three for a balanced trip'
    );
    for (const o of options) expect(o.location).not.toContain('family rooms');
  });

  test('the kids clause only appears when the winner actually fits families', async ({ page }) => {
    // Cultural style favors the central stay, which isn't the family pick —
    // the reason stays honest and omits the kids clause.
    const options = await genLodging(page, 'Austin', {
      tripStyle: 'Cultural exploration',
      whoIsGoing: '2 adults, 2 kids',
    });
    const rec = recommendedOf(options);
    expect(rec.role).toBe('central');
    expect(rec.familyFit).toBe(false);
    expect(rec.recommendedReason).not.toContain('kids in tow');
    // The scoring still recorded the boost on the family-fit option
    const quiet = options.find((o) => o.role === 'quiet') as LodgingOption;
    expect(quiet.matchScore).toBe(2);
    expect(rec.matchScore).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// generateLodgingOptions — traveler mix: accessibility
// ---------------------------------------------------------------------------
test.describe('generateLodgingOptions: accessibility needs', () => {
  test('the accessibility checkbox adds step-free wording to the fitting winner and a booking caution elsewhere', async ({ page }) => {
    const options = await genLodging(page, 'Austin', {
      tripStyle: 'Cultural exploration',
      otherRequirements: ['Accessible for people with limited mobility'],
    });
    const rec = recommendedOf(options);
    expect(rec.role).toBe('central');
    expect(rec.accessFit).toBe(true);
    expect(rec.recommendedReason).toContain('— with step-free access typically available');
    expect(rec.location).toContain('elevator and step-free rooms typically available');
    // The non-step-free option warns to confirm before booking
    const quiet = options.find((o) => o.role === 'quiet') as LodgingOption;
    expect(quiet.accessFit).toBe(false);
    expect(quiet.tradeoff).toContain('confirm step-free access before booking');
    // Fitting non-winners get the location note but no booking caution
    const value = options.find((o) => o.role === 'value') as LodgingOption;
    expect(value.tradeoff).not.toContain('confirm step-free access');
  });

  test('mobility keywords in the constraints free text trigger the same handling', async ({ page }) => {
    const options = await genLodging(page, 'Austin', {
      tripStyle: 'Cultural exploration',
      constraints: 'One of us uses a wheelchair',
    });
    const rec = recommendedOf(options);
    expect(rec.recommendedReason).toContain('— with step-free access typically available');
  });

  test('a winner flagged not-step-free omits the access claim and carries the caution itself', async ({ page }) => {
    // Tulum's beach-zone cabanas are flagged access:false in the city data
    const options = await genLodging(page, 'Tulum', {
      tripStyle: 'Cultural exploration',
      otherRequirements: ['Accessible for people with limited mobility'],
    });
    const rec = recommendedOf(options);
    expect(rec.name).toBe('Beach-zone cabana hotel');
    expect(rec.accessFit).toBe(false);
    expect(rec.recommendedReason).not.toContain('step-free access typically available');
    expect(rec.tradeoff).toContain('confirm step-free access before booking');
  });

  test('no accessibility wording appears when no accessibility need fired', async ({ page }) => {
    const options = await genLodging(page, 'Austin', { tripStyle: 'Cultural exploration' });
    for (const o of options) {
      expect(o.location).not.toContain('step-free');
      expect(o.tradeoff).not.toContain('confirm step-free access');
    }
    expect(recommendedOf(options).recommendedReason).not.toContain('step-free');
  });
});

// ---------------------------------------------------------------------------
// generateLodgingOptions — unknown cities (estimated fallback)
// ---------------------------------------------------------------------------
test.describe('generateLodgingOptions: unknown cities', () => {
  test('an unknown city gets generic archetypes, all clearly marked estimated', async ({ page }) => {
    const options = await genLodging(page, 'Springfield');

    expect(options).toHaveLength(3);
    expect(options.every((o) => o.estimated)).toBe(true);
    expect(options.map((o) => o.name)).toEqual([
      'City-center hotel',
      'Quiet neighborhood guesthouse',
      'Budget-friendly chain near transit',
    ]);
    expect(options[0].location).toBe('Central Springfield, walkable to the main sights');
    // "Estimated" wording is visible in the option copy itself
    for (const o of options) {
      expect(o.tradeoff).toContain('typical rates for the area, not a checked listing');
    }
    const rec = recommendedOf(options);
    expect(rec.recommendedReason).toContain(
      "(we don't have Springfield lodging on file — areas and rates are rough estimates)"
    );
    // No region match -> mid cost base ($110)
    expect(options.map((o) => o.pricePerNight)).toEqual([145, 110, 75]);
  });

  test('an unknown city in a known region is priced off that region\'s cost level', async ({ page }) => {
    // Not in the city dataset, but the region profile (Japan -> high) applies
    const options = await genLodging(page, 'Kanazawa, Japan');
    expect(options.every((o) => o.estimated)).toBe(true);
    expect(options.map((o) => o.pricePerNight)).toEqual([220, 170, 120]);
  });
});

// ---------------------------------------------------------------------------
// generateLodgingOptions — invariants
// ---------------------------------------------------------------------------
test.describe('generateLodgingOptions: invariants', () => {
  test('every scenario yields 2–3 options with exactly one recommended and a reason', async ({ page }) => {
    const cases: Array<[string, GenIntake]> = [
      ['Austin', {}],
      ['Tokyo', { tripStyle: 'Relaxation' }],
      ['Rome', { tripStyle: 'Cultural exploration', otherRequirements: ['Accessible for people with limited mobility'] }],
      ['Queenstown', { tripStyle: 'Adventure' }],
      ['Cancun', { whoIsGoing: 'family of 5' }],
      ['Springfield', { tripStyle: 'Relaxation' }],
    ];
    for (const [city, intake] of cases) {
      const options = await genLodging(page, city, intake);
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options.length).toBeLessThanOrEqual(3);
      const rec = recommendedOf(options);
      expect(rec.recommendedReason).toBeTruthy();
      expect(options.filter((o) => o.recommendedReason !== null)).toHaveLength(1);
    }
  });

  test('the generator is deterministic for identical inputs and accepts stop objects', async ({ page }) => {
    const a = await genLodging(page, 'Austin', { tripStyle: 'Relaxation' });
    const b = await genLodging(page, 'Austin', { tripStyle: 'Relaxation' });
    expect(b).toEqual(a);

    // {name} stop objects (as stored in destination.stops) work the same
    const asObject = await genLodging(page, { name: 'Austin' }, { tripStyle: 'Relaxation' });
    expect(asObject).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// UI — lodging blocks on the results page (known mode)
// ---------------------------------------------------------------------------
test.describe('Lodging blocks in the results view', () => {
  test('a 3-stop route renders one STOP block per stop, in order, with per-stop cards', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas', 'Houston']);
    await submitBtn(page).click();

    await expect(page.locator('#lodgingSection')).toBeVisible();
    await expect(lodgingBlocks(page)).toHaveCount(3);
    await expect(lodgingBlocks(page).nth(0).locator('.leg-label')).toHaveText('STOP 1 · AUSTIN');
    await expect(lodgingBlocks(page).nth(1).locator('.leg-label')).toHaveText('STOP 2 · DALLAS');
    await expect(lodgingBlocks(page).nth(2).locator('.leg-label')).toHaveText('STOP 3 · HOUSTON');
    await expect(lodgingBlocks(page).nth(0)).toHaveAttribute('data-lodging-stop', 'Austin');
    await expect(lodgingBlocks(page).nth(0).locator('h2')).toHaveText('Lodging options');
    for (const si of [0, 1, 2]) await expect(lodgingCards(page, si)).toHaveCount(3);

    // Cards show the nightly price, the location, and the trade-off copy
    const quietCard = lodgingCards(page, 0).filter({ hasText: 'South Congress boutique hotel' });
    await expect(quietCard.locator('.price')).toHaveText('$170 / night');
    await expect(quietCard.locator('.detail')).toHaveText('SoCo, 15 min walk to downtown');
    await expect(quietCard.locator('.tradeoff').first()).toContainText('Calmer nights');
  });

  test('the recommended stay is badged and pre-selected in every stop, and persisted at submit', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas', 'Houston']);
    await submitBtn(page).click();

    for (const si of [0, 1, 2]) {
      const badged = lodgingCards(page, si).filter({ has: page.locator('.rec-badge') });
      await expect(badged).toHaveCount(1);
      await expect(badged).toHaveClass(/selected/);
      await expect(lodgingCards(page, si).filter({ hasText: 'RECOMMENDED' })).toHaveCount(1);
    }

    const data = await readStored(page);
    expect(data.lodging).toHaveLength(3);
    expect(data.lodging.map((l: any) => l.stop)).toEqual(['Austin', 'Dallas', 'Houston']);
    for (const entry of data.lodging) {
      const rec = entry.options.filter((o: any) => o.recommended);
      expect(rec).toHaveLength(1);
      expect(entry.selected).toBe(rec[0].name);
    }
  });

  test('selecting a stay in one stop persists immediately and leaves the other stops alone', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas', 'Houston']);
    await submitBtn(page).click();

    const before = await readStored(page);
    const dallasSelected = before.lodging[1].selected;

    await lodgingCards(page, 0).filter({ hasText: 'East Austin guesthouse' }).click();

    // Stop 1: exactly one selected card, and it's the value stay now
    await expect(
      lodgingCards(page, 0).filter({ hasText: 'East Austin guesthouse' })
    ).toHaveClass(/selected/);
    await expect(lodgingBlocks(page).nth(0).locator('.option-card.selected')).toHaveCount(1);
    // Stop 2's selection is untouched
    await expect(
      lodgingBlocks(page).nth(1).locator('.option-card.selected')
    ).toHaveAttribute('data-lodging-option-name', dallasSelected);

    // Persisted immediately, no resubmit needed
    const after = await readStored(page);
    expect(after.lodging[0].selected).toBe('East Austin guesthouse');
    expect(after.lodging[1].selected).toBe(dallasSelected);
  });

  test('a single-stop trip gets exactly one lodging section', async ({ page }) => {
    await fillKnownForm(page, ['Tokyo']);
    await submitBtn(page).click();

    await expect(page.locator('#lodgingSection')).toBeVisible();
    await expect(lodgingBlocks(page)).toHaveCount(1);
    await expect(lodgingBlocks(page).nth(0).locator('.leg-label')).toHaveText('STOP 1 · TOKYO');
    const data = await readStored(page);
    expect(data.lodging).toHaveLength(1);
    expect(data.lodging[0].stop).toBe('Tokyo');
  });

  test('the trip style set in the form drives the recommended stay on the page', async ({ page }) => {
    await fillKnownForm(page, ['Austin'], { style: 'Cultural exploration' });
    await submitBtn(page).click();

    const rec = lodgingCards(page, 0).filter({ has: page.locator('.rec-badge') });
    await expect(rec).toHaveAttribute('data-lodging-option-name', 'Downtown high-rise hotel');
    await expect(rec).toContainText('the best base for cultural exploration');
  });

  test('adjusting nights in the route stepper does not disturb the lodging', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await lodgingCards(page, 0).filter({ hasText: 'East Austin guesthouse' }).click();
    const before = await readStored(page);

    await page.getByRole('button', { name: 'Increase nights in Austin' }).click();

    const after = await readStored(page);
    expect(after.destination.stops[0].nights).toBe(before.destination.stops[0].nights + 1);
    expect(after.lodging).toEqual(before.lodging); // selection and options untouched
    await expect(
      lodgingCards(page, 0).filter({ hasText: 'East Austin guesthouse' })
    ).toHaveClass(/selected/);
  });

  test('"Edit my answers" hides the lodging section', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();
    await expect(page.locator('#lodgingSection')).toBeVisible();

    await page.locator('#editAgainBtn').click();
    await expect(page.locator('#lodgingSection')).toBeHidden();
    await expect(page.locator('#intakeForm')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// UI — flexible mode
// ---------------------------------------------------------------------------
test.describe('Lodging in flexible-destination mode', () => {
  test('lodging follows the selected option\'s stops and rebuilds when the option changes', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();

    let data = await readStored(page);
    let expected = data.destination.selectedOption.stops.map((s: any) => s.name);
    expect(data.lodging.map((l: any) => l.stop)).toEqual(expected);
    await expect(lodgingBlocks(page)).toHaveCount(expected.length);

    // Switch to another destination option: lodging rebuilds for the new route
    const otherCard = page.locator('#destOptionsGrid .option-card:not(.selected)').first();
    const otherName = await otherCard.getAttribute('data-option-name');
    await otherCard.click();

    data = await readStored(page);
    expect(data.destination.selectedOption.name).toBe(otherName);
    expected = data.destination.selectedOption.stops.map((s: any) => s.name);
    expect(data.lodging.map((l: any) => l.stop)).toEqual(expected);
    await expect(lodgingBlocks(page)).toHaveCount(expected.length);
    for (let i = 0; i < expected.length; i++) {
      await expect(lodgingBlocks(page).nth(i)).toHaveAttribute('data-lodging-stop', expected[i]);
    }
    // Every rebuilt stop is valid: 2–3 options, exactly one recommended,
    // selection defaults to it
    for (const entry of data.lodging) {
      expect(entry.options.length).toBeGreaterThanOrEqual(2);
      expect(entry.options.length).toBeLessThanOrEqual(3);
      const rec = entry.options.filter((o: any) => o.recommended);
      expect(rec).toHaveLength(1);
      expect(entry.selected).toBe(rec[0].name);
    }
  });

  test('switching options preserves the lodging choice for a city that survives the switch', async ({ page }) => {
    await fillFlexibleForm(page, ['Portugal']);
    await submitBtn(page).click();

    // Find two options sharing a city (e.g. "Lisbon" and "Lisbon + Porto")
    const data = await readStored(page);
    const options = data.destination.options as Array<{ name: string; stops: Array<{ name: string }> }>;
    let pair: { a: string; b: string; shared: string } | null = null;
    outer: for (const a of options) {
      for (const b of options) {
        if (a.name === b.name) continue;
        const shared = a.stops.find((s) => b.stops.some((t) => t.name === s.name));
        if (shared) { pair = { a: a.name, b: b.name, shared: shared.name }; break outer; }
      }
    }
    expect(pair).not.toBeNull();
    const { a, b, shared } = pair as { a: string; b: string; shared: string };
    const optionCard = (name: string) =>
      page.locator(`#destOptionsGrid .option-card[data-option-name="${name}"]`);

    // Start on option A and pick a non-recommended stay for the shared city
    await optionCard(a).click();
    const sharedBlock = page.locator(`#lodgingContainer .leg-block[data-lodging-stop="${shared}"]`);
    const altCard = sharedBlock.locator('.option-card:not(.selected)').first();
    const altName = await altCard.getAttribute('data-lodging-option-name');
    await altCard.click();
    let stored = await readStored(page);
    expect(stored.lodging.find((l: any) => l.stop === shared).selected).toBe(altName);

    // Switch to option B: the surviving city keeps the custom selection
    await optionCard(b).click();
    stored = await readStored(page);
    expect(stored.lodging.find((l: any) => l.stop === shared).selected).toBe(altName);
    await expect(
      sharedBlock.locator('.option-card.selected')
    ).toHaveAttribute('data-lodging-option-name', altName as string);

    // Cities that didn't survive default to their recommended stay
    for (const entry of stored.lodging.filter((l: any) => l.stop !== shared)) {
      const rec = entry.options.filter((o: any) => o.recommended);
      expect(entry.selected).toBe(rec[0].name);
    }
  });
});
