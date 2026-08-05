import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler with a flexible destination, I want to list several
 * regions/countries I'm interested in so that the plan can propose and
 * compare specific destinations rather than assuming one."
 *
 * Covers the PRD Results-view "Destination options" requirement: 2–3 options,
 * only rendered when the destination was flexible; each option may be a single
 * city or a multi-stop combo; a one-line rationale each; exactly one marked
 * Recommended with a stated reason; and the selected option drives downstream
 * (persisted at `tripPlannerIntake.destination.selectedOption`).
 *
 * Generator cases call the exposed `window.generateDestinationOptions(data)`
 * (pure/deterministic given the intake payload — no clock reads); UI cases
 * drive the real form flow with far-future (2027) selections.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const ENGLISH_REQ = 'English predominantly spoken';

type Stop = { name: string; nights: number };
type DestOption = {
  name: string;
  stops: Stop[];
  rationale: string;
  tradeoff: string;
  recommended: boolean;
  recommendedReason: string | null;
};

interface IntakeOverrides {
  regions?: string[];
  tripStyle?: string;
  otherRequirements?: string[];
  mode?: 'general' | 'specific';
  months?: string[];
  resolved?: { startDate: string; endDate: string; reason: string | null } | null;
  tripLength?: string;
}

/** Minimal flexible-destination intake with the fields the generator reads. */
function makeIntake(overrides: IntakeOverrides = {}) {
  const mode = overrides.mode ?? 'specific';
  return {
    dates: {
      mode,
      months: overrides.months ?? [],
      year: 2027,
      tripLength: overrides.tripLength ?? '',
      startDate: mode === 'specific' ? '2027-05-10' : null,
      endDate: mode === 'specific' ? '2027-05-17' : null,
      resolved:
        overrides.resolved !== undefined
          ? overrides.resolved
          : { startDate: '2027-05-10', endDate: '2027-05-17', reason: null },
    },
    destination: {
      mode: 'flexible',
      stops: [] as unknown[],
      regions: overrides.regions ?? ['Europe'],
    },
    tripStyle: overrides.tripStyle ?? 'Balanced mix',
    otherRequirements: overrides.otherRequirements ?? [],
  };
}

function generate(page: Page, data: ReturnType<typeof makeIntake>): Promise<DestOption[]> {
  return page.evaluate((d) => (window as any).generateDestinationOptions(d), data);
}

function nightsSum(opt: DestOption): number {
  return opt.stops.reduce((sum, s) => sum + s.nights, 0);
}

function recommendedOf(options: DestOption[]): DestOption {
  const rec = options.filter((o) => o.recommended);
  expect(rec).toHaveLength(1);
  return rec[0];
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function submitBtn(page: Page) {
  return page.getByRole('button', { name: /Build My Trip/i });
}

function readStored(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) as string),
    STORAGE_KEY
  );
}

/** Fills the form in flexible-destination mode with the given region entries. */
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

/** Fills the form in the default fixed-destination ("I know where") mode. */
async function fillFixedForm(page: Page) {
  await page.locator('#monthChips .chip[data-month="Apr"]').click();
  await page.locator('#yearPills .pill[data-year="2027"]').click();
  await page.locator('#departingFrom').fill('Austin');
  const stopInput = page.getByPlaceholder('Add another city or country and press Enter');
  await stopInput.fill('Tokyo');
  await stopInput.press('Enter');
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill('2 adults');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
});

// ---------------------------------------------------------------------------
// Generator — option count, single recommendation, one-line rationales
// ---------------------------------------------------------------------------
test.describe('Destination options generator — shape and recommendation', () => {
  test('returns 2–3 well-formed options with exactly one recommended and its stated reason', async ({ page }) => {
    for (const regions of [['Portugal'], ['Europe'], ['Svalbard']]) {
      const options = await generate(page, makeIntake({ regions }));
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options.length).toBeLessThanOrEqual(3);

      for (const opt of options) {
        expect(opt.name.length).toBeGreaterThan(0);
        expect(opt.stops.length).toBeGreaterThanOrEqual(1);
        // One-line rationale and trade-off on every option
        expect(opt.rationale.length).toBeGreaterThan(0);
        expect(opt.rationale).not.toContain('\n');
        expect(opt.tradeoff.length).toBeGreaterThan(0);
      }

      const rec = recommendedOf(options);
      expect(rec.recommendedReason).toMatch(/^Best overall fit — .+/);
      for (const other of options.filter((o) => !o.recommended)) {
        expect(other.recommendedReason).toBeNull();
      }
    }
  });

  test('empty region list yields no options (nothing to propose)', async ({ page }) => {
    const options = await generate(page, makeIntake({ regions: [] }));
    expect(options).toEqual([]);
  });

  test('is deterministic: identical intake produces identical options', async ({ page }) => {
    const intake = makeIntake({
      regions: ['Japan', 'Mexico'],
      tripStyle: 'Cultural exploration',
      otherRequirements: [ENGLISH_REQ, 'No rental car'],
      mode: 'general',
      months: ['Feb', 'Oct'],
      resolved: { startDate: '2027-10-10', endDate: '2027-10-18', reason: 'x' },
    });
    const first = await generate(page, intake);
    const second = await generate(page, intake);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// Generator — catalog matching (specific vs. broad, multi-stop combos, unknowns)
// ---------------------------------------------------------------------------
test.describe('Destination options generator — matching and combos', () => {
  test('a specific country in the entry wins over a broad region mention', async ({ page }) => {
    const options = await generate(
      page,
      makeIntake({ regions: ['Portugal or anywhere in Europe'] })
    );
    const names = options.map((o) => o.name);
    // Portugal's concrete proposals, not the generic Europe combos
    expect(names.some((n) => n.includes('Lisbon') || n.includes('Algarve'))).toBe(true);
    expect(names).not.toContain('London + Paris');
  });

  test('"Europe" can yield a multi-stop combo with nights allocated across stops summing to the trip length', async ({ page }) => {
    // 7-night resolved trip (May 10–17)
    const options = await generate(
      page,
      makeIntake({ regions: ['Europe'], tripStyle: 'Cultural exploration' })
    );
    const multi = options.filter((o) => o.stops.length >= 2);
    expect(multi.length).toBeGreaterThanOrEqual(1);
    expect(options.map((o) => o.name)).toContain('London + Paris');

    for (const opt of options) {
      expect(nightsSum(opt)).toBe(7);
      for (const stop of opt.stops) expect(stop.nights).toBeGreaterThanOrEqual(1);
    }
    // Odd total across 2 stops: remainder goes to the earlier stop (4 + 3)
    const combo = options.find((o) => o.name === 'London + Paris') as DestOption;
    expect(combo.stops.map((s) => s.nights)).toEqual([4, 3]);
  });

  test('with no resolved dates, nights fall back to the stated trip length', async ({ page }) => {
    const options = await generate(
      page,
      makeIntake({
        regions: ['Europe'],
        mode: 'general',
        months: ['May'],
        resolved: null,
        tripLength: '1 week',
      })
    );
    for (const opt of options) expect(nightsSum(opt)).toBe(7);
  });

  test('an unknown entry still yields an option and is padded with a non-recommended popular alternative', async ({ page }) => {
    const options = await generate(page, makeIntake({ regions: ['Svalbard'] }));
    expect(options.length).toBeGreaterThanOrEqual(2);
    // The user's own entry leads and is the recommended one
    expect(options[0].name).toBe('Svalbard');
    expect(options[0].recommended).toBe(true);
    expect(options[0].rationale).toContain('Svalbard');
    // The supplement is clearly labeled and never recommended
    const supplement = options.find((o) => /^Popular alternative/.test(o.rationale));
    expect(supplement).toBeTruthy();
    expect(supplement!.recommended).toBe(false);
  });

  test('with up to 3 entries, every listed region is represented by one option', async ({ page }) => {
    const options = await generate(
      page,
      makeIntake({
        regions: ['Japan', 'Mexico', 'Svalbard'],
        mode: 'general',
        months: ['Feb'],
        resolved: { startDate: '2027-02-10', endDate: '2027-02-17', reason: 'x' },
      })
    );
    expect(options).toHaveLength(3);
    const names = options.map((o) => o.name);
    expect(names.some((n) => /Tokyo|Kyoto|Osaka/.test(n))).toBe(true);
    expect(names.some((n) => /Mexico City|Oaxaca|Tulum/.test(n))).toBe(true);
    expect(names).toContain('Svalbard');
  });
});

// ---------------------------------------------------------------------------
// Generator — other-requirements checkboxes influence ranking and rationale
// ---------------------------------------------------------------------------
test.describe('Destination options generator — requirements shape the ranking', () => {
  const seAsia = (otherRequirements: string[]) =>
    makeIntake({
      regions: ['Southeast Asia'],
      tripStyle: 'Balanced mix',
      otherRequirements,
      mode: 'general',
      months: ['Jan'],
      resolved: { startDate: '2027-01-10', endDate: '2027-01-17', reason: 'x' },
    });

  test('"English predominantly spoken" changes the recommendation and is claimed only where true', async ({ page }) => {
    const without = recommendedOf(await generate(page, seAsia([])));
    expect(without.name).toBe('Bangkok + Chiang Mai');

    const withEnglish = recommendedOf(await generate(page, seAsia([ENGLISH_REQ])));
    expect(withEnglish.name).toBe('Singapore');
    expect(withEnglish.rationale).toContain('English is the main language');
    expect(withEnglish.recommendedReason).toContain('English predominantly spoken');
  });

  const mexico = (otherRequirements: string[]) =>
    makeIntake({
      regions: ['Mexico'],
      tripStyle: 'Relaxation',
      otherRequirements,
      mode: 'general',
      months: ['Feb'],
      resolved: { startDate: '2027-02-10', endDate: '2027-02-17', reason: 'x' },
    });

  test('"No rental car" flips the recommendation toward walkable picks and flags car-dependent ones', async ({ page }) => {
    const without = recommendedOf(await generate(page, mexico([])));
    expect(without.name).toBe('Tulum'); // best pure-relaxation fit when cars are fine

    const options = await generate(page, mexico(['No rental car']));
    const rec = recommendedOf(options);
    expect(rec.name).toBe('Mexico City + Oaxaca');
    expect(rec.rationale).toContain('no rental car needed');
    // The car-dependent option's trade-off is honest about it
    const tulum = options.find((o) => o.name === 'Tulum') as DestOption;
    expect(tulum.tradeoff).toContain('easiest with a rental car');
  });

  test('"Walkable cities preferred" has the same walkability effect', async ({ page }) => {
    const rec = recommendedOf(await generate(page, mexico(['Walkable cities preferred'])));
    expect(rec.name).toBe('Mexico City + Oaxaca');
  });
});

// ---------------------------------------------------------------------------
// UI flow — flexible submissions render selectable option cards
// ---------------------------------------------------------------------------
test.describe('Destination options UI — flexible destinations', () => {
  test('flexible submit renders 2–3 cards with the recommended one badged, reasoned, and pre-selected', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();

    const section = page.locator('#destOptionsSection');
    await expect(section).toBeVisible();

    const cards = page.locator('#destOptionsGrid .option-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);

    // Exactly one recommended card, and it starts selected with a stated reason
    const badged = page.locator('#destOptionsGrid .option-card:has(.rec-badge)');
    await expect(badged).toHaveCount(1);
    await expect(badged).toHaveClass(/selected/);
    await expect(badged.locator('.tradeoff.rec')).toContainText('Best overall fit');

    // Every card carries its name, a rationale, and a trade-off line
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      expect(await card.getAttribute('data-option-name')).toBeTruthy();
      await expect(card.locator('.rationale')).not.toBeEmpty();
      await expect(card.locator('.tradeoff').first()).not.toBeEmpty();
    }

    // Persistence: options + selectedOption stored, recommended pre-selected
    const data = await readStored(page);
    expect(data.destination.options).toHaveLength(count);
    expect(data.destination.options.filter((o: DestOption) => o.recommended)).toHaveLength(1);
    const recName = await badged.getAttribute('data-option-name');
    expect(data.destination.selectedOption.name).toBe(recName);
    expect(data.destination.selectedOption.recommended).toBe(true);
    // Selected option's stop nights cover the resolved trip length
    const totalNights = daysBetween(
      data.dates.resolved.startDate,
      data.dates.resolved.endDate
    );
    const storedSum = data.destination.selectedOption.stops.reduce(
      (sum: number, s: Stop) => sum + s.nights,
      0
    );
    expect(storedSum).toBe(totalNights);
  });

  test('selecting a different card moves the selection and rewrites the persisted choice', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();

    const recommendedCard = page.locator('#destOptionsGrid .option-card:has(.rec-badge)');
    const otherCard = page.locator('#destOptionsGrid .option-card:not(:has(.rec-badge))').first();
    const otherName = await otherCard.getAttribute('data-option-name');

    await otherCard.click();
    await expect(otherCard).toHaveClass(/selected/);
    await expect(recommendedCard).not.toHaveClass(/selected/);
    await expect(page.locator('#destOptionsGrid .option-card.selected')).toHaveCount(1);

    let data = await readStored(page);
    expect(data.destination.selectedOption.name).toBe(otherName);
    expect(data.destination.selectedOption.recommended).toBe(false);

    // Switching back restores the recommended flag on the stored selection
    await recommendedCard.click();
    await expect(recommendedCard).toHaveClass(/selected/);
    data = await readStored(page);
    expect(data.destination.selectedOption.name).toBe(
      await recommendedCard.getAttribute('data-option-name')
    );
    expect(data.destination.selectedOption.recommended).toBe(true);
  });

  test('fixed-destination ("I know where") submissions never render the section', async ({ page }) => {
    await fillFixedForm(page);
    await submitBtn(page).click();

    await expect(page.locator('#confirmationCard')).toBeVisible();
    await expect(page.locator('#destOptionsSection')).toBeHidden();
    await expect(page.locator('#destOptionsGrid .option-card')).toHaveCount(0);

    const data = await readStored(page);
    expect(data.destination.options).toBeUndefined();
    expect(data.destination.selectedOption).toBeUndefined();
  });

  test('"Edit my answers" hides the options and resubmitting brings them back', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();
    await expect(page.locator('#destOptionsSection')).toBeVisible();

    await page.locator('#editAgainBtn').click();
    await expect(page.locator('#destOptionsSection')).toBeHidden();
    await expect(page.locator('#intakeForm')).toBeVisible();

    await submitBtn(page).click();
    await expect(page.locator('#destOptionsSection')).toBeVisible();
    const count = await page.locator('#destOptionsGrid .option-card').count();
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
  });
});
