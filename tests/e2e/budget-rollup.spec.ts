import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler, I want an itemized budget rolled up against my
 * stated budget, with a clear flag when the plan is over — at both the
 * summary level and the line-item level."
 *
 * Covers the PRD's budget lines — flights/arrival leg, inter-city transport
 * (its own line on multi-stop trips), lodging (summed with a per-stop
 * breakdown), activities, food, local transport, and a misc/buffer line —
 * plus the total, the explicit over/under comparison against the stated
 * budget (normalized per-person × travelers; flights & lodging excludable
 * when budgeted separately), the budget-vs-total pill on the confirmation
 * card, line-level "top overage driver" flags when over, the "Prices as of"
 * freshness note, and live updates as flight/leg/lodging/nights/destination
 * selections change.
 *
 * Unit cases call the exposed pure `window.computeBudget` with hand-built
 * intake data so every line's math is asserted exactly. UI cases use
 * specific dates Jun 1–9, 2027 so allocations are deterministic.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const STOP_PLACEHOLDER = 'Add another city or country and press Enter';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

type BudgetLine = {
  key: string;
  label: string;
  amount: number;
  perStop?: Array<{ stop: string; nights: number; pricePerNight: number; amount: number }>;
  overShare?: boolean;
  excludedFromComparison: boolean;
};

type Budget = {
  lines: BudgetLine[];
  total: number;
  statedBudget: number | null;
  delta: number | null;
  over: boolean;
  comparisonTotal: number;
  travelers: number;
  scope: string;
  flightsLodging: string;
  statedAmount: number | null;
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

/** Calls the exposed pure rollup with a hand-built intake-shaped object. */
function computeBudget(page: Page, data: any): Promise<Budget> {
  return page.evaluate((d) => (window as any).computeBudget(d), data);
}

/** Mirrors the app's money formatting ($ thousands separators, no cents). */
function fmt(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function todayISO() {
  const d = new Date();
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayLong() {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function line(b: Budget, key: string) {
  return b.lines.find((l) => l.key === key) as BudgetLine;
}

function budgetRow(page: Page, key: string) {
  return page.locator(`#budgetBox .budget-row[data-budget-line="${key}"]`);
}

function lodgingRow(page: Page, stop: string) {
  return page.locator(
    `#budgetBox .budget-row[data-budget-line="lodging"][data-budget-stop="${stop}"]`
  );
}

function totalRow(page: Page) {
  return page.locator('#budgetBox .budget-row.total');
}

function vsRow(page: Page) {
  return page.locator('#budgetBox .budget-row.vs');
}

/**
 * Fixed two-stop fixture with known selections so every line is exact math:
 *   flights    selected "Nonstop" group price $800 (not the first option)
 *   intercity  selected "Flight" leg $250
 *   lodging    Austin (high) $120 × 3 nights + Bangkok (low) $55 × 2 = $470
 *   activities Austin 3 × $30 + Bangkok 2 × $10 = $110 × 2 travelers = $220
 *   food       (2 × $65 + 2 × $25) × 2 = $360
 *   local      (2 × $16 + 2 × $8) × 2 = $96
 *   misc       roundTo5(8% × $2,196) = $175  →  total $2,371
 */
function fixture(overrides: any = {}) {
  return {
    travelers: { whoIsGoing: '2 adults' },
    destination: {
      mode: 'known',
      stops: [
        { name: 'Austin', nights: 3 },
        { name: 'Bangkok', nights: 2 },
      ],
    },
    budget: { amount: 1500, scope: 'group', flightsLodging: 'included' },
    arrivalFlight: {
      from: 'Chicago',
      to: 'Austin',
      options: [
        { label: 'Cheapest', pricePerPerson: 250, priceGroup: 500 },
        { label: 'Nonstop', pricePerPerson: 400, priceGroup: 800 },
      ],
      selected: 'Nonstop',
    },
    legs: [
      {
        from: 'Austin',
        to: 'Bangkok',
        options: [
          { label: 'Train', mode: 'train', price: 100 },
          { label: 'Flight', mode: 'flight', price: 250 },
        ],
        selected: 'Flight',
      },
    ],
    lodging: [
      {
        stop: 'Austin',
        options: [
          { name: 'Downtown high-rise hotel', pricePerNight: 220 },
          { name: 'East Austin guesthouse', pricePerNight: 120 },
        ],
        selected: 'East Austin guesthouse',
      },
      {
        stop: 'Bangkok',
        options: [{ name: 'Riverside hotel', pricePerNight: 55 }],
        selected: 'Riverside hotel',
      },
    ],
    itinerary: {
      days: [
        {
          stop: 'Austin',
          entries: [
            { title: 'Breakfast near your lodging', meal: 'breakfast' },
            { title: 'South Congress stroll' },
            { title: 'Lunch at a local spot', meal: 'lunch' },
            { title: 'Live music on Rainey Street' },
            { title: 'Rest block / free time' },
          ],
        },
        { stop: 'Austin', entries: [{ title: 'Museum visit' }] },
        {
          stop: 'Bangkok',
          entries: [
            { title: 'Fly Austin → Bangkok', travel: true },
            { title: 'Hotel check-in in Bangkok' },
            { title: 'Easy first look around Bangkok' },
          ],
        },
        {
          stop: 'Bangkok',
          entries: [
            { title: 'Grand Palace tour' },
            { title: 'Dinner at a local spot', meal: 'dinner' },
          ],
        },
      ],
    },
    ...overrides,
  };
}

async function addStop(page: Page, name: string) {
  const input = page.getByPlaceholder(STOP_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
}

/**
 * Fills the whole form in known-destination mode with specific dates
 * Jun 1–9, 2027. Budget defaults to $3,000, per-person, flights & lodging
 * included, unless overridden.
 */
async function fillKnownForm(
  page: Page,
  stops: string[],
  opts: {
    budget?: string;
    scope?: 'per-person' | 'group';
    includes?: 'included' | 'separate';
    whoIsGoing?: string;
  } = {}
) {
  await page.getByText('Specific dates').click();
  await page.locator('#startDate').fill('2027-06-01');
  await page.locator('#endDate').fill('2027-06-09');
  await page.locator('#departingFrom').fill('Austin');
  for (const s of stops) await addStop(page, s);
  await page.locator('#budgetAmount').fill(opts.budget ?? '3000');
  if (opts.scope) {
    await page.locator(`#budgetScopePills .pill[data-budget-scope="${opts.scope}"]`).click();
  }
  if (opts.includes) {
    await page.locator(`#budgetIncludesPills .pill[data-budget-includes="${opts.includes}"]`).click();
  }
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill(opts.whoIsGoing ?? '2 adults');
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
// computeBudget — line math per category (fixed fixture, exact amounts)
// ---------------------------------------------------------------------------
test.describe('computeBudget: itemized line math', () => {
  test('every PRD line is computed exactly from the selected options', async ({ page }) => {
    const b = await computeBudget(page, fixture());

    expect(b.lines.map((l) => l.key)).toEqual([
      'flights', 'intercity', 'lodging', 'activities', 'food', 'local', 'misc',
    ]);

    // Flights: the SELECTED option's group price, not the first option
    expect(line(b, 'flights').amount).toBe(800);
    expect(line(b, 'flights').label).toBe('Flights — arrival leg (2 travelers)');

    // Inter-city: selected leg option, labeled with the route
    expect(line(b, 'intercity').amount).toBe(250);
    expect(line(b, 'intercity').label).toBe('Inter-city transport — Austin → Bangkok');

    // Lodging: selected price/night × that stop's nights, with per-stop breakdown
    expect(line(b, 'lodging').amount).toBe(470);
    expect(line(b, 'lodging').perStop).toEqual([
      { stop: 'Austin', nights: 3, pricePerNight: 120, amount: 360 },
      { stop: 'Bangkok', nights: 2, pricePerNight: 55, amount: 110 },
    ]);

    // Activities: non-meal/non-logistics entries × city tier × travelers
    // Austin (high, $30): stroll + live music + museum = 3
    // Bangkok (low, $10): "Easy first look around" + palace tour = 2
    expect(line(b, 'activities').amount).toBe((3 * 30 + 2 * 10) * 2);

    // Food / local transport: per itinerary day at the day's city tier × travelers
    expect(line(b, 'food').amount).toBe((2 * 65 + 2 * 25) * 2);
    expect(line(b, 'local').amount).toBe((2 * 16 + 2 * 8) * 2);

    // Misc: 8% of the subtotal, rounded to $5; total sums everything
    expect(line(b, 'misc').amount).toBe(175);
    expect(b.total).toBe(2371);
    expect(b.travelers).toBe(2);
  });

  test('meal, travel, and logistics itinerary entries never count as activities', async ({ page }) => {
    const b = await computeBudget(page, fixture({
      destination: { mode: 'known', stops: [{ name: 'Springfield', nights: 1 }] },
      arrivalFlight: null,
      legs: [],
      lodging: [],
      itinerary: {
        days: [
          {
            stop: 'Springfield', // unknown city → mid tier ($20 activity)
            entries: [
              { title: 'Breakfast near your lodging', meal: 'breakfast' },
              { title: 'Fly Austin → Springfield', travel: true },
              { title: 'Hotel check-in and drop bags' },
              { title: 'Check out and store your bags' },
              { title: 'Head to the airport — evening flight home' },
              { title: 'Rest block / free time' },
              { title: 'Morning market visit' },
              { title: 'Easy first look around Springfield' },
            ],
          },
        ],
      },
    }));

    // Only the market visit and the first-look walk are paid activities
    expect(line(b, 'activities').amount).toBe(2 * 20 * 2);
    expect(line(b, 'food').amount).toBe(45 * 2);
    expect(line(b, 'local').amount).toBe(12 * 2);
  });

  test('a solo traveler gets singular labeling and 1× multipliers', async ({ page }) => {
    const b = await computeBudget(page, fixture({ travelers: { whoIsGoing: 'solo' } }));
    expect(b.travelers).toBe(1);
    expect(line(b, 'flights').label).toBe('Flights — arrival leg (1 traveler)');
    expect(line(b, 'activities').amount).toBe(3 * 30 + 2 * 10);
    expect(line(b, 'food').amount).toBe(2 * 65 + 2 * 25);
  });

  test('a selection label that no longer matches falls back to the first option', async ({ page }) => {
    const data = fixture();
    data.arrivalFlight.selected = 'No longer exists';
    data.lodging[0].selected = 'Demolished hotel';
    const b = await computeBudget(page, data);
    expect(line(b, 'flights').amount).toBe(500); // first option's group price
    expect(line(b, 'lodging').perStop?.[0].pricePerNight).toBe(220);
  });

  test('single-stop trips get no inter-city line', async ({ page }) => {
    const data = fixture({ legs: [] });
    data.destination.stops = [{ name: 'Austin', nights: 3 }];
    const b = await computeBudget(page, data);
    expect(b.lines.map((l) => l.key)).not.toContain('intercity');
    expect(b.lines.map((l) => l.key)).toContain('flights');
  });

  test('lodging nights floor at 1, and misc floors at $5', async ({ page }) => {
    const b = await computeBudget(page, {
      travelers: { whoIsGoing: 'solo' },
      destination: { mode: 'known', stops: [{ name: 'Springfield', nights: 0 }] },
      lodging: [
        {
          stop: 'Springfield',
          options: [{ name: 'Cheap stay', pricePerNight: 5 }],
          selected: 'Cheap stay',
        },
        {
          // A stop no longer on the route still bills at least 1 night
          stop: 'Nowhereville',
          options: [{ name: 'Roadside inn', pricePerNight: 10 }],
          selected: 'Roadside inn',
        },
      ],
    });
    expect(line(b, 'lodging').perStop).toEqual([
      { stop: 'Springfield', nights: 1, pricePerNight: 5, amount: 5 },
      { stop: 'Nowhereville', nights: 1, pricePerNight: 10, amount: 10 },
    ]);
    expect(line(b, 'misc').amount).toBe(5); // roundTo5 floors at $5
  });

  test('empty intake data produces no lines, a $0 total, and no comparison', async ({ page }) => {
    const b = await computeBudget(page, {});
    expect(b.lines).toEqual([]);
    expect(b.total).toBe(0);
    expect(b.statedBudget).toBeNull();
    expect(b.delta).toBeNull();
    expect(b.over).toBe(false);
  });

  test('deterministic: identical inputs produce identical rollups', async ({ page }) => {
    const a = await computeBudget(page, fixture());
    const b = await computeBudget(page, fixture());
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// computeBudget — stated-budget normalization and over/under comparison
// ---------------------------------------------------------------------------
test.describe('computeBudget: stated budget comparison', () => {
  test('a per-person budget is multiplied by the traveler count', async ({ page }) => {
    const b = await computeBudget(page, fixture({
      budget: { amount: 1500, scope: 'per-person', flightsLodging: 'included' },
    }));
    expect(b.statedAmount).toBe(1500);
    expect(b.statedBudget).toBe(3000);
    expect(b.delta).toBe(2371 - 3000); // under
    expect(b.over).toBe(false);
  });

  test('a group budget is compared as-is; over when the total exceeds it', async ({ page }) => {
    const b = await computeBudget(page, fixture()); // $1,500 group vs $2,371
    expect(b.statedBudget).toBe(1500);
    expect(b.comparisonTotal).toBe(2371);
    expect(b.delta).toBe(871);
    expect(b.over).toBe(true);
  });

  test('exactly at budget is not flagged over (delta 0)', async ({ page }) => {
    const b = await computeBudget(page, fixture({
      budget: { amount: 2371, scope: 'group', flightsLodging: 'included' },
    }));
    expect(b.delta).toBe(0);
    expect(b.over).toBe(false);
    expect(b.lines.every((l) => !l.overShare)).toBe(true);
  });

  test('a missing/invalid budget amount disables the comparison but keeps the lines', async ({ page }) => {
    for (const amount of [null, 0, -100, NaN]) {
      const b = await computeBudget(page, fixture({
        budget: { amount, scope: 'group', flightsLodging: 'included' },
      }));
      expect(b.lines.length).toBe(7);
      expect(b.total).toBe(2371);
      expect(b.statedBudget).toBeNull();
      expect(b.delta).toBeNull();
      expect(b.over).toBe(false);
    }
  });

  test("'separate' excludes flights, inter-city, and lodging from the comparison but keeps the lines", async ({ page }) => {
    const b = await computeBudget(page, fixture({
      budget: { amount: 1500, scope: 'group', flightsLodging: 'separate' },
    }));
    // All 7 lines still render-able…
    expect(b.lines.map((l) => l.key)).toEqual([
      'flights', 'intercity', 'lodging', 'activities', 'food', 'local', 'misc',
    ]);
    // …but the trip-getting-there lines are excluded from the comparison
    for (const key of ['flights', 'intercity', 'lodging']) {
      expect(line(b, key).excludedFromComparison).toBe(true);
    }
    for (const key of ['activities', 'food', 'local', 'misc']) {
      expect(line(b, key).excludedFromComparison).toBe(false);
    }
    // On-the-ground subtotal: 220 + 360 + 96 + 175
    expect(b.comparisonTotal).toBe(851);
    expect(b.delta).toBe(851 - 1500);
    expect(b.over).toBe(false); // same trip was over when everything counted
  });
});

// ---------------------------------------------------------------------------
// computeBudget — line-level over flags (top overage drivers)
// ---------------------------------------------------------------------------
test.describe('computeBudget: line-level over flags', () => {
  test('when over, only comparison lines above an equal share are flagged', async ({ page }) => {
    const b = await computeBudget(page, fixture()); // $1,500 / 7 lines ≈ $214 share
    expect(b.over).toBe(true);
    const flagged = b.lines.filter((l) => l.overShare).map((l) => l.key);
    expect(flagged).toEqual(['flights', 'intercity', 'lodging', 'activities', 'food']);
    // $96 local and $175 misc sit under the share — never flagged
    expect(line(b, 'local').overShare).toBeUndefined();
    expect(line(b, 'misc').overShare).toBeUndefined();
  });

  test('no line is flagged when the trip is under budget', async ({ page }) => {
    const b = await computeBudget(page, fixture({
      budget: { amount: 5000, scope: 'group', flightsLodging: 'included' },
    }));
    expect(b.over).toBe(false);
    expect(b.lines.every((l) => !l.overShare)).toBe(true);
  });

  test("with 'separate', flags are computed against on-the-ground lines only", async ({ page }) => {
    const b = await computeBudget(page, fixture({
      budget: { amount: 500, scope: 'group', flightsLodging: 'separate' },
    }));
    // Over on the on-the-ground subtotal: $851 vs $500 (share = $125/line)
    expect(b.over).toBe(true);
    expect(b.delta).toBe(351);
    const flagged = b.lines.filter((l) => l.overShare).map((l) => l.key);
    expect(flagged).toEqual(['activities', 'food', 'misc']);
    // The excluded $800 flights line is never blamed for an on-the-ground overage
    expect(line(b, 'flights').overShare).toBeUndefined();
    expect(line(b, 'local').overShare).toBeUndefined(); // $96 < $125 share
  });
});

// ---------------------------------------------------------------------------
// UI — budget box, badge, and freshness note at submit
// ---------------------------------------------------------------------------
test.describe('Budget rollup in the results view', () => {
  test('under budget: every line renders, the vs row and badge are green-under', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '5000' }); // $10,000 for 2
    await submitBtn(page).click();

    await expect(page.locator('#budgetRollupSection')).toBeVisible();
    const b = (await readStored(page)).budgetRollup as Budget;
    expect(b.statedBudget).toBe(10000);
    expect(b.over).toBe(false);

    // Every computed line has a matching row with the exact amount
    // (lodging renders as one row per stop)
    for (const l of b.lines) {
      if (l.key === 'lodging' && l.perStop) {
        for (const ps of l.perStop) {
          const rowEl = lodgingRow(page, ps.stop);
          await expect(rowEl).toHaveAttribute('data-budget-amount', String(ps.amount));
          await expect(rowEl).toContainText(`Lodging — ${ps.stop}`);
          await expect(rowEl).toContainText(`${ps.nights} nights`);
        }
      } else {
        await expect(budgetRow(page, l.key)).toHaveAttribute(
          'data-budget-amount', String(l.amount)
        );
      }
    }
    await expect(lodgingRow(page, 'Austin')).toHaveCount(1);
    await expect(lodgingRow(page, 'Dallas')).toHaveCount(1);

    // Total and vs rows
    await expect(totalRow(page)).toHaveAttribute('data-budget-total', String(b.total));
    await expect(totalRow(page)).toHaveAttribute('data-budget-over', 'false');
    await expect(totalRow(page)).not.toHaveClass(/over/);
    await expect(totalRow(page).locator('.amt')).toHaveText(`$${fmt(b.total)}`);
    await expect(vsRow(page)).toHaveAttribute('data-budget-delta', String(b.delta));
    await expect(vsRow(page).locator('.amt')).toHaveClass(/under/);
    await expect(vsRow(page).locator('.amt')).toHaveText(`−$${fmt(-(b.delta as number))} under`);

    // No line-level over flags when under
    await expect(page.locator('#budgetBox .budget-row.over-share')).toHaveCount(0);
    await expect(page.locator('#budgetBox .over-flag')).toHaveCount(0);

    // Summary-level pill: green "$total-vs-budget", no over wording
    const badge = page.locator('#budgetBadge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(`$${fmt(b.comparisonTotal)} / $${fmt(b.statedBudget as number)}`);
    await expect(badge).not.toHaveClass(/over/);
    await expect(badge).toHaveAttribute('data-budget-over', 'false');
  });

  test('over budget: red badge, over total, +$ over vs row, and top-overage-driver line flags', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '100' }); // $200 for 2
    await submitBtn(page).click();

    const b = (await readStored(page)).budgetRollup as Budget;
    expect(b.over).toBe(true);
    expect(b.delta).toBe(b.comparisonTotal - 200);

    const badge = page.locator('#budgetBadge');
    await expect(badge).toHaveClass(/over/);
    await expect(badge).toHaveAttribute('data-budget-over', 'true');
    await expect(badge).toHaveText(
      `$${fmt(b.comparisonTotal)} / $200 — $${fmt(b.delta as number)} over`
    );

    await expect(totalRow(page)).toHaveClass(/over/);
    await expect(totalRow(page)).toHaveAttribute('data-budget-over', 'true');
    await expect(vsRow(page).locator('.amt')).toHaveClass(/over/);
    await expect(vsRow(page).locator('.amt')).toHaveText(`+$${fmt(b.delta as number)} over`);

    // Line-item-level flags, matching the persisted overShare markings
    const flaggedRows = page.locator('#budgetBox .budget-row.over-share');
    expect(await flaggedRows.count()).toBeGreaterThan(0);
    await expect(flaggedRows.first().locator('.over-flag')).toHaveText('top overage driver');
    for (const l of b.lines.filter((x) => x.overShare && x.key !== 'lodging')) {
      await expect(budgetRow(page, l.key)).toHaveClass(/over-share/);
    }
  });

  test('the per-person vs row shows the normalization math', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '100' }); // per-person default
    await submitBtn(page).click();
    await expect(vsRow(page)).toContainText(
      'vs. stated budget ($100/person × 2 travelers = $200)'
    );
  });

  test('a group budget is shown as-is with no per-person math', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '3000', scope: 'group' });
    await submitBtn(page).click();
    const b = (await readStored(page)).budgetRollup as Budget;
    expect(b.scope).toBe('group');
    expect(b.statedBudget).toBe(3000);
    await expect(vsRow(page)).toContainText('vs. stated budget ($3,000)');
    await expect(vsRow(page)).not.toContainText('/person');
  });

  test("'separate' at intake adds the on-the-ground subtotal row, exclusion wording, and footnote", async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '3000', includes: 'separate' });
    await submitBtn(page).click();

    const b = (await readStored(page)).budgetRollup as Budget;
    expect(b.flightsLodging).toBe('separate');
    expect(b.comparisonTotal).toBeLessThan(b.total);

    // The excluded lines still render for reference
    await expect(budgetRow(page, 'flights')).toHaveCount(1);
    await expect(budgetRow(page, 'intercity')).toHaveCount(1);
    await expect(lodgingRow(page, 'Austin')).toHaveCount(1);

    // …but the comparison is explicit about what the budget covers
    const subtotal = budgetRow(page, 'comparison-subtotal');
    await expect(subtotal).toHaveAttribute('data-budget-amount', String(b.comparisonTotal));
    await expect(subtotal).toContainText('On-the-ground subtotal');
    await expect(vsRow(page)).toContainText('flights & lodging excluded (budgeted separately)');
    await expect(page.locator('#budgetBox .budget-footnote')).toContainText(
      "aren't counted against your stated budget"
    );
  });

  test('a budget exactly equal to the estimate reads "right at budget"', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '3000', scope: 'group' });
    await submitBtn(page).click();
    const ct = ((await readStored(page)).budgetRollup as Budget).comparisonTotal;

    // Resubmit the same trip with the stated budget set to the exact estimate
    await page.locator('#editAgainBtn').click();
    await page.locator('#budgetAmount').fill(String(ct));
    await submitBtn(page).click();

    await expect(vsRow(page)).toHaveAttribute('data-budget-delta', '0');
    await expect(vsRow(page).locator('.amt')).toHaveText('right at budget');
    await expect(vsRow(page).locator('.amt')).toHaveClass(/under/);
    await expect(page.locator('#budgetBadge')).not.toHaveClass(/over/);
  });

  test('the freshness note shows today as the "Prices as of" date, persisted as asOf', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await expect(page.locator('#budgetFreshnessNote')).toContainText(
      `Prices as of ${todayLong()}`
    );
    await expect(page.locator('#budgetFreshnessNote')).toContainText('not live');
    const b = (await readStored(page)).budgetRollup;
    expect(b.asOf).toBe(todayISO());
  });

  test('a single-stop trip has no inter-city row', async ({ page }) => {
    await fillKnownForm(page, ['Tokyo']);
    await submitBtn(page).click();
    await expect(page.locator('#budgetRollupSection')).toBeVisible();
    await expect(budgetRow(page, 'intercity')).toHaveCount(0);
    await expect(budgetRow(page, 'flights')).toHaveCount(1);
    await expect(lodgingRow(page, 'Tokyo')).toHaveCount(1);
  });

  test('the persisted budgetRollup carries the full comparison shape', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '5000' });
    await submitBtn(page).click();
    const b = (await readStored(page)).budgetRollup;
    for (const key of [
      'lines', 'total', 'statedBudget', 'delta', 'over', 'comparisonTotal',
      'travelers', 'scope', 'flightsLodging', 'statedAmount', 'asOf',
    ]) {
      expect(b, `budgetRollup.${key}`).toHaveProperty(key);
    }
    expect(b.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const l of b.lines) {
      expect(typeof l.key).toBe('string');
      expect(typeof l.label).toBe('string');
      expect(typeof l.amount).toBe('number');
      expect(typeof l.excludedFromComparison).toBe('boolean');
    }
    expect(b.total).toBe(b.lines.reduce((s: number, l: any) => s + l.amount, 0));
  });

  test('"Edit my answers" hides the budget section', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();
    await expect(page.locator('#budgetRollupSection')).toBeVisible();

    await page.locator('#editAgainBtn').click();
    await expect(page.locator('#budgetRollupSection')).toBeHidden();
    await expect(page.locator('#intakeForm')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// UI — live updates with selections
// ---------------------------------------------------------------------------
test.describe('Budget rollup live updates', () => {
  test('picking a different arrival flight updates the flights line, total, and badge immediately', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '5000' });
    await submitBtn(page).click();

    const before = await readStored(page);
    const af = before.arrivalFlight;
    const current = af.options.find((o: any) => o.label === af.selected);
    const other = af.options.find((o: any) => o.priceGroup !== current.priceGroup);
    expect(other).toBeTruthy();

    await page
      .locator(`#arrivalContainer .option-card[data-flight-option-label="${other.label}"]`)
      .click();

    // The flights line follows the new selection, no resubmit needed
    await expect(budgetRow(page, 'flights')).toHaveAttribute(
      'data-budget-amount', String(other.priceGroup)
    );
    const after = (await readStored(page)).budgetRollup as Budget;
    expect(line(after, 'flights').amount).toBe(other.priceGroup);
    expect(after.total).not.toBe(before.budgetRollup.total);
    await expect(totalRow(page)).toHaveAttribute('data-budget-total', String(after.total));
    await expect(page.locator('#budgetBadge')).toHaveText(
      new RegExp(`^\\$${fmt(after.comparisonTotal)} / `)
    );
  });

  test('picking a different inter-city option updates the inter-city line and total', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '5000' });
    await submitBtn(page).click();

    const before = await readStored(page);
    const leg = before.legs[0];
    const current = leg.options.find((o: any) => o.label === leg.selected);
    const other = leg.options.find((o: any) => o.price !== current.price);
    expect(other).toBeTruthy();

    await page
      .locator(`#legsContainer .leg-block[data-leg-index="0"] .option-card[data-leg-option-label="${other.label}"]`)
      .click();

    await expect(budgetRow(page, 'intercity')).toHaveAttribute(
      'data-budget-amount', String(other.price)
    );
    const after = (await readStored(page)).budgetRollup as Budget;
    expect(line(after, 'intercity').amount).toBe(other.price);
    await expect(totalRow(page)).toHaveAttribute('data-budget-total', String(after.total));
  });

  test('picking a different stay updates that stop\'s lodging row by exactly rate × nights', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '5000' });
    await submitBtn(page).click();

    const before = await readStored(page);
    const entry = before.lodging[0]; // Austin
    const nights = before.destination.stops[0].nights;
    const current = entry.options.find((o: any) => o.name === entry.selected);
    const other = entry.options.find((o: any) => o.pricePerNight !== current.pricePerNight);
    expect(other).toBeTruthy();

    await page
      .locator(`#lodgingContainer .leg-block[data-lodging-stop="Austin"] .option-card[data-lodging-option-name="${other.name}"]`)
      .click();

    await expect(lodgingRow(page, 'Austin')).toHaveAttribute(
      'data-budget-amount', String(other.pricePerNight * nights)
    );
    const after = (await readStored(page)).budgetRollup as Budget;
    // Total moves by exactly the lodging swing (plus the recomputed misc buffer)
    expect(line(after, 'lodging').amount).toBe(
      line(before.budgetRollup, 'lodging').amount +
        (other.pricePerNight - current.pricePerNight) * nights
    );
    await expect(totalRow(page)).toHaveAttribute('data-budget-total', String(after.total));
    await expect(page.locator('#budgetBadge')).toHaveText(
      new RegExp(`^\\$${fmt(after.comparisonTotal)} / `)
    );
  });

  test('adding a night updates the lodging row by the nightly rate and the per-day lines', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], { budget: '5000' });
    await submitBtn(page).click();

    const before = await readStored(page);
    const b0 = before.budgetRollup as Budget;
    const austin = line(b0, 'lodging').perStop?.find((p) => p.stop === 'Austin');
    expect(austin).toBeTruthy();

    await page.getByRole('button', { name: 'Increase nights in Austin' }).click();

    const after = (await readStored(page)).budgetRollup as Budget;
    const austinAfter = line(after, 'lodging').perStop?.find((p) => p.stop === 'Austin');
    expect(austinAfter?.nights).toBe((austin as any).nights + 1);
    expect(austinAfter?.amount).toBe((austin as any).amount + (austin as any).pricePerNight);
    await expect(lodgingRow(page, 'Austin')).toHaveAttribute(
      'data-budget-amount', String(austinAfter?.amount)
    );
    // One more itinerary day → the food and local lines grow too
    expect(line(after, 'food').amount).toBeGreaterThan(line(b0, 'food').amount);
    expect(line(after, 'local').amount).toBeGreaterThan(line(b0, 'local').amount);
    await expect(totalRow(page)).toHaveAttribute('data-budget-total', String(after.total));
  });

  test('switching the destination option rebuilds the budget for the new route', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();
    await expect(page.locator('#budgetRollupSection')).toBeVisible();
    const beforeTotal = await totalRow(page).getAttribute('data-budget-total');

    const otherCard = page.locator('#destOptionsGrid .option-card:not(.selected)').first();
    await otherCard.click();

    const data = await readStored(page);
    const b = data.budgetRollup as Budget;
    const stops = data.destination.selectedOption.stops.map((s: any) => s.name);
    // Lodging budget rows follow the newly selected route
    expect(line(b, 'lodging').perStop?.map((p) => p.stop)).toEqual(stops);
    for (const stop of stops) await expect(lodgingRow(page, stop)).toHaveCount(1);
    await expect(totalRow(page)).toHaveAttribute('data-budget-total', String(b.total));
    expect(String(b.total)).not.toBe(beforeTotal);
  });
});
