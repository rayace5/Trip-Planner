import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler with a multi-stop trip, I want to control (or let the
 * plan suggest) how many nights I spend at each stop so that pacing across
 * the whole trip is realistic."
 *
 * Covers the PRD nights-per-stop requirements: blank "nights here" values are
 * auto-allocated evenly from the resolved trip length at submission (user
 * values kept, remainder to earlier stops, min 1) and shown back as editable —
 * both in the intake rows and in a results-side route stepper (#routeSection)
 * that renders ✈ Departure/Home endpoints around every stop. Nights are
 * adjustable in place (min 1/stop) with live recalculation of the total-nights
 * readout, the resolved end date, and the dates line, persisted to
 * `tripPlannerIntake` immediately. Known mode drives destination.stops;
 * flexible mode drives the selected option's stops and rebuilds the stepper
 * when the user switches option cards.
 *
 * Allocation unit cases call the exposed pure `window.fillBlankNights`.
 * UI cases use specific dates Jun 1–9, 2027 (an 8-night trip) so every
 * expected allocation and date shift is deterministic.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const STOP_PLACEHOLDER = 'Add another city or country and press Enter';

type StopInput = { name: string; nights: number | null };

function submitBtn(page: Page) {
  return page.getByRole('button', { name: /Build My Trip/i });
}

function readStored(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) as string),
    STORAGE_KEY
  );
}

function fillBlank(page: Page, stops: StopInput[], totalNights: number) {
  return page.evaluate(
    ([s, t]) => (window as any).fillBlankNights(s, t),
    [stops, totalNights] as const
  );
}

/** Stop cards only (endpoints carry no data-stop-index). */
function routeStops(page: Page) {
  return page.locator('.route-stop[data-stop-index]');
}

function stepperInput(page: Page, city: string) {
  return page.locator('#routeStepper').getByLabel(`Nights in ${city}`, { exact: true });
}

async function addStop(page: Page, name: string, nights?: number) {
  const input = page.getByPlaceholder(STOP_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
  if (nights != null) {
    await page
      .locator('.stop-row', { hasText: name })
      .locator('.nights-input')
      .fill(String(nights));
  }
}

/**
 * Fills the whole form in known-destination mode with specific dates
 * Jun 1–9, 2027 — an 8-night trip. Stops with `nights` undefined are left
 * blank ("auto").
 */
async function fillKnownForm(page: Page, stops: Array<{ name: string; nights?: number }>) {
  await page.getByText('Specific dates').click();
  await page.locator('#startDate').fill('2027-06-01');
  await page.locator('#endDate').fill('2027-06-09');
  await page.locator('#departingFrom').fill('Austin');
  for (const s of stops) await addStop(page, s.name, s.nights);
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill('2 adults');
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
// fillBlankNights — pure allocation rules
// ---------------------------------------------------------------------------
test.describe('fillBlankNights allocation rules', () => {
  test('all-blank stops split the trip length evenly', async ({ page }) => {
    const out = await fillBlank(
      page,
      [
        { name: 'A', nights: null },
        { name: 'B', nights: null },
        { name: 'C', nights: null },
      ],
      9
    );
    expect(out).toEqual([
      { name: 'A', nights: 3 },
      { name: 'B', nights: 3 },
      { name: 'C', nights: 3 },
    ]);
  });

  test('an uneven split gives the remainder to the earlier stops', async ({ page }) => {
    const out = await fillBlank(
      page,
      [
        { name: 'A', nights: null },
        { name: 'B', nights: null },
        { name: 'C', nights: null },
      ],
      8
    );
    expect(out.map((s: StopInput) => s.nights)).toEqual([3, 3, 2]);
  });

  test('user-specified nights are kept and only the blanks share the remainder', async ({ page }) => {
    const out = await fillBlank(
      page,
      [
        { name: 'A', nights: 4 },
        { name: 'B', nights: null },
        { name: 'C', nights: null },
      ],
      9
    );
    expect(out).toEqual([
      { name: 'A', nights: 4 },
      { name: 'B', nights: 3 },
      { name: 'C', nights: 2 },
    ]);
  });

  test('blank stops never go below 1 night even when fixed nights exceed the trip length', async ({ page }) => {
    const out = await fillBlank(
      page,
      [
        { name: 'A', nights: 10 },
        { name: 'B', nights: null },
        { name: 'C', nights: null },
      ],
      7
    );
    expect(out.map((s: StopInput) => s.nights)).toEqual([10, 1, 1]);
  });

  test('a single blank stop absorbs the whole trip; fully specified lists are returned unchanged', async ({ page }) => {
    expect(await fillBlank(page, [{ name: 'A', nights: null }], 8)).toEqual([
      { name: 'A', nights: 8 },
    ]);
    // No blanks -> nothing is rescaled, even if the sum differs from the total
    expect(
      await fillBlank(
        page,
        [
          { name: 'A', nights: 2 },
          { name: 'B', nights: 2 },
        ],
        10
      )
    ).toEqual([
      { name: 'A', nights: 2 },
      { name: 'B', nights: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Submission — auto-allocation persisted and shown back as editable
// ---------------------------------------------------------------------------
test.describe('Submission auto-allocation (known mode)', () => {
  test('blank nights are filled evenly from the trip length, persisted, and shown in the stepper', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'London' }, { name: 'Paris' }]); // both blank, 8 nights
    await submitBtn(page).click();
    await expect(page.locator('#confirmationCard')).toBeVisible();

    const data = await readStored(page);
    expect(data.destination.stops).toEqual([
      { name: 'London', nights: 4 },
      { name: 'Paris', nights: 4 },
    ]);

    await expect(page.locator('#routeSection')).toBeVisible();
    await expect(routeStops(page).locator('.city')).toHaveText(['London', 'Paris']);
    await expect(routeStops(page).locator('.nights')).toHaveText(['4 nights', '4 nights']);
    await expect(page.locator('#routeTotal')).toHaveText('8 nights total · Jun 1–9, 2027');
  });

  test('a mix of set and blank nights keeps the set value and gives the rest to the blank stop', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'London', nights: 5 }, { name: 'Paris' }]);
    await submitBtn(page).click();
    const data = await readStored(page);
    expect(data.destination.stops).toEqual([
      { name: 'London', nights: 5 },
      { name: 'Paris', nights: 3 },
    ]);
  });

  test('when user-set nights outgrow the date range, the resolved end date follows the nights', async ({ page }) => {
    await fillKnownForm(page, [
      { name: 'London', nights: 5 },
      { name: 'Paris', nights: 5 },
    ]);
    await submitBtn(page).click();
    const data = await readStored(page);
    // 10 nights from Jun 1 -> Jun 11; the raw entered dates stay untouched
    expect(data.dates.resolved.endDate).toBe('2027-06-11');
    expect(data.dates.startDate).toBe('2027-06-01');
    expect(data.dates.endDate).toBe('2027-06-09');
    await expect(page.locator('#routeTotal')).toHaveText('10 nights total · Jun 1–11, 2027');
  });

  test('"Edit my answers" shows the allocated nights back in the intake rows (editable)', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'London' }, { name: 'Paris' }]);
    await submitBtn(page).click();
    await page.locator('#editAgainBtn').click();

    await expect(page.locator('#intakeForm')).toBeVisible();
    await expect(page.locator('#routeSection')).toBeHidden();
    await expect(page.locator('.stop-row').nth(0).locator('.nights-input')).toHaveValue('4');
    await expect(page.locator('.stop-row').nth(1).locator('.nights-input')).toHaveValue('4');

    // The values are genuinely editable: change one and resubmit
    await page.locator('.stop-row', { hasText: 'London' }).locator('.nights-input').fill('6');
    await submitBtn(page).click();
    const data = await readStored(page);
    expect(data.destination.stops).toEqual([
      { name: 'London', nights: 6 },
      { name: 'Paris', nights: 4 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Route stepper — rendering
// ---------------------------------------------------------------------------
test.describe('Route stepper rendering', () => {
  test('renders departure and home endpoints around the stops', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'London' }, { name: 'Paris' }]);
    await submitBtn(page).click();

    const endpoints = page.locator('.route-stop.route-endpoint');
    await expect(endpoints).toHaveCount(2);
    await expect(endpoints.nth(0)).toHaveText('✈ Departure — Austin');
    await expect(endpoints.nth(1)).toHaveText('✈ Home — Austin');
    // Endpoints have no nights controls
    await expect(endpoints.locator('.nights-adjust')).toHaveCount(0);
  });

  test('a single-stop trip still shows the stepper with both endpoints', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'Tokyo' }]);
    await submitBtn(page).click();

    await expect(page.locator('#routeSection')).toBeVisible();
    await expect(routeStops(page)).toHaveCount(1);
    await expect(routeStops(page).locator('.city')).toHaveText('Tokyo');
    await expect(routeStops(page).locator('.nights')).toHaveText('8 nights');
    await expect(page.locator('.route-stop.route-endpoint')).toHaveCount(2);
  });

  test('flexible mode renders the selected option\'s stops in the stepper', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();

    await expect(page.locator('#routeSection')).toBeVisible();
    const data = await readStored(page);
    const stops = data.destination.selectedOption.stops as Array<{ name: string; nights: number }>;
    await expect(routeStops(page)).toHaveCount(stops.length);
    await expect(routeStops(page).locator('.city')).toHaveText(stops.map((s) => s.name));
    await expect(routeStops(page).locator('.nights')).toHaveText(
      stops.map((s) => `${s.nights} night${s.nights === 1 ? '' : 's'}`)
    );
  });

  test('switching option cards rebuilds the stepper with that option\'s stops', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();

    const otherCard = page.locator('#destOptionsGrid .option-card:not(.selected)').first();
    const otherName = await otherCard.getAttribute('data-option-name');
    await otherCard.click();

    const data = await readStored(page);
    expect(data.destination.selectedOption.name).toBe(otherName);
    const stops = data.destination.selectedOption.stops as Array<{ name: string; nights: number }>;
    await expect(routeStops(page)).toHaveCount(stops.length);
    await expect(routeStops(page).locator('.city')).toHaveText(stops.map((s) => s.name));
  });
});

// ---------------------------------------------------------------------------
// Route stepper — adjusting nights in place
// ---------------------------------------------------------------------------
test.describe('Adjusting nights in the stepper', () => {
  test('+ adds a night: stop label, total, resolved end date, and storage all update live', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'London' }, { name: 'Paris' }]); // 4 + 4
    await submitBtn(page).click();

    await page.getByRole('button', { name: 'Increase nights in London' }).click();

    await expect(routeStops(page).nth(0).locator('.nights')).toHaveText('5 nights');
    await expect(stepperInput(page, 'London')).toHaveValue('5');
    await expect(page.locator('#routeTotal')).toHaveText('9 nights total · Jun 1–10, 2027');
    await expect(page.locator('#dateRationale')).toHaveText('📅 Jun 1, 2027 – Jun 10, 2027');

    const data = await readStored(page);
    expect(data.destination.stops[0]).toEqual({ name: 'London', nights: 5 });
    expect(data.dates.resolved.endDate).toBe('2027-06-10');
  });

  test('− removes a night and shortens the trip accordingly', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'London' }, { name: 'Paris' }]); // 4 + 4
    await submitBtn(page).click();

    await page.getByRole('button', { name: 'Decrease nights in Paris' }).click();

    await expect(routeStops(page).nth(1).locator('.nights')).toHaveText('3 nights');
    await expect(page.locator('#routeTotal')).toHaveText('7 nights total · Jun 1–8, 2027');
    const data = await readStored(page);
    expect(data.destination.stops[1]).toEqual({ name: 'Paris', nights: 3 });
    expect(data.dates.resolved.endDate).toBe('2027-06-08');
  });

  test('minimum is 1 night per stop: − is disabled at 1 and re-enabled above it', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'London', nights: 1 }, { name: 'Paris' }]);
    await submitBtn(page).click();

    const minus = page.getByRole('button', { name: 'Decrease nights in London' });
    await expect(minus).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Decrease nights in Paris' })).toBeEnabled();

    await page.getByRole('button', { name: 'Increase nights in London' }).click();
    await expect(routeStops(page).nth(0).locator('.nights')).toHaveText('2 nights');
    await expect(page.getByRole('button', { name: 'Decrease nights in London' })).toBeEnabled();
  });

  test('typing a value commits and persists immediately, before leaving the field', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'London' }, { name: 'Paris' }]); // 4 + 4
    await submitBtn(page).click();

    await stepperInput(page, 'London').fill('6');

    // No blur yet — label, total, and storage already reflect the new value
    await expect(routeStops(page).nth(0).locator('.nights')).toHaveText('6 nights');
    await expect(page.locator('#routeTotal')).toHaveText('10 nights total · Jun 1–11, 2027');
    const data = await readStored(page);
    expect(data.destination.stops[0]).toEqual({ name: 'London', nights: 6 });
    expect(data.dates.resolved.endDate).toBe('2027-06-11');
  });

  test('typing an invalid value (below 1) is normalized to 1 night on change', async ({ page }) => {
    await fillKnownForm(page, [{ name: 'London' }, { name: 'Paris' }]); // 4 + 4
    await submitBtn(page).click();

    const input = stepperInput(page, 'London');
    await input.fill('0');
    await input.blur();

    await expect(stepperInput(page, 'London')).toHaveValue('1');
    await expect(routeStops(page).nth(0).locator('.nights')).toHaveText('1 night');
    await expect(page.getByRole('button', { name: 'Decrease nights in London' })).toBeDisabled();
    await expect(page.locator('#routeTotal')).toHaveText('5 nights total · Jun 1–6, 2027');
    const data = await readStored(page);
    expect(data.destination.stops[0]).toEqual({ name: 'London', nights: 1 });
  });

  test('flexible mode: adjusting a stop updates the selected option card and storage', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();

    let data = await readStored(page);
    const first = data.destination.selectedOption.stops[0] as { name: string; nights: number };

    await page.getByRole('button', { name: `Increase nights in ${first.name}` }).click();

    data = await readStored(page);
    expect(data.destination.selectedOption.stops[0].nights).toBe(first.nights + 1);
    // The selected option card's nights line reflects the change live
    await expect(
      page.locator('#destOptionsGrid .option-card.selected .detail')
    ).toContainText(`${first.nights + 1} nights ${first.name}`);
    // End date follows the new total
    const total = data.destination.selectedOption.stops.reduce(
      (sum: number, s: { nights: number }) => sum + s.nights,
      0
    );
    const start = Date.parse(data.dates.resolved.startDate);
    expect(Date.parse(data.dates.resolved.endDate)).toBe(start + total * 86_400_000);
  });
});
