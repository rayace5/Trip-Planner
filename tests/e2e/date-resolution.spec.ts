import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler with flexible dates, I want to select multiple
 * candidate months and a year so that the plan can find the best window
 * rather than forcing me to pick one date range upfront."
 *
 * Covers the PRD's General-window resolution requirement (Dates bullet):
 * the selected months resolve to ONE concrete recommended date range,
 * persisted at `tripPlannerIntake.dates.resolved` and shown in the trip
 * summary with a one-line reason ("Recommended: Oct 12–19 — …").
 *
 * Heuristic cases call the exposed `window.resolveGeneralWindow(data, now)`
 * with a pinned `now` (deterministic); the two summary-display cases drive
 * the real UI flow with far-future (2027) selections since the UI path uses
 * the real clock.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const EVENTS_REQUIREMENT = 'Travel during key special events/holidays for that destination';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Resolved = { startDate: string; endDate: string; reason: string };

interface IntakeOverrides {
  months?: string[];
  year?: number;
  tripLength?: string;
  destination?: string;
  otherRequirements?: string[];
}

/** Minimal intake payload with the fields resolveGeneralWindow reads. */
function makeIntake(overrides: IntakeOverrides = {}) {
  return {
    dates: {
      mode: 'general',
      months: overrides.months ?? ['Oct'],
      year: overrides.year ?? 2026,
      tripLength: overrides.tripLength ?? '',
      startDate: null,
      endDate: null,
    },
    destination: {
      mode: 'known',
      stops: [{ name: overrides.destination ?? 'Tokyo', nights: null }],
      regions: [] as string[],
    },
    otherRequirements: overrides.otherRequirements ?? [],
  };
}

/** Runs the exposed resolver in the page with a pinned local-time `now`. */
function resolve(
  page: Page,
  data: ReturnType<typeof makeIntake>,
  now: [number, number, number] // [year, monthIndex, day]
): Promise<Resolved> {
  return page.evaluate(
    ({ data, now }) =>
      (window as any).resolveGeneralWindow(data, new Date(now[0], now[1], now[2])),
    { data, now }
  );
}

/** Whole days between two ISO yyyy-mm-dd dates (b - a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function submitBtn(page: Page) {
  return page.getByRole('button', { name: /Build My Trip/i });
}

async function fillNonDateRequiredFields(page: Page, stop = 'Tokyo') {
  await page.locator('#departingFrom').fill('Austin');
  const stopInput = page.getByPlaceholder('Add another city or country and press Enter');
  await stopInput.fill(stop);
  await stopInput.press('Enter');
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill('2 adults');
}

function readStored(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) as string),
    STORAGE_KEY
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
});

// ---------------------------------------------------------------------------
// Resolution window + trip-length parsing
// ---------------------------------------------------------------------------
test.describe('General-window resolution — range and trip length', () => {
  test('resolves to a single concrete range starting inside the selected months and year', async ({ page }) => {
    const result = await resolve(
      page,
      makeIntake({ months: ['Sep', 'Oct'], year: 2026 }),
      [2026, 0, 15]
    );
    expect(result.startDate).toMatch(ISO_DATE);
    expect(result.endDate).toMatch(ISO_DATE);
    const [year, month] = result.startDate.split('-').map(Number);
    expect(year).toBe(2026);
    expect([9, 10]).toContain(month); // Sep or Oct
    expect(daysBetween(result.startDate, result.endDate)).toBeGreaterThan(0);
  });

  test('trip length "7-10 days" resolves to the midpoint length (8 nights)', async ({ page }) => {
    const result = await resolve(page, makeIntake({ tripLength: '7-10 days' }), [2026, 0, 15]);
    expect(daysBetween(result.startDate, result.endDate)).toBe(8);
  });

  test('trip length "5 days" resolves to 4 nights', async ({ page }) => {
    const result = await resolve(page, makeIntake({ tripLength: '5 days' }), [2026, 0, 15]);
    expect(daysBetween(result.startDate, result.endDate)).toBe(4);
  });

  test('blank trip length falls back to a 7-night default', async ({ page }) => {
    const result = await resolve(page, makeIntake({ tripLength: '' }), [2026, 0, 15]);
    expect(daysBetween(result.startDate, result.endDate)).toBe(7);
  });

  test('reason is a non-empty one-liner stating the recommendation and its basis', async ({ page }) => {
    const result = await resolve(page, makeIntake({ months: ['Oct'] }), [2026, 0, 15]);
    expect(typeof result.reason).toBe('string');
    expect(result.reason).toMatch(/^Recommended: /);
    expect(result.reason).toContain('—'); // "Recommended: <range> — <basis>"
    expect(result.reason.split('—')[1].trim().length).toBeGreaterThan(0);
    expect(result.reason).not.toContain('\n');
  });
});

// ---------------------------------------------------------------------------
// Event-seeking vs. holiday-avoiding
// ---------------------------------------------------------------------------
test.describe('General-window resolution — events vs. holidays', () => {
  const december = (otherRequirements: string[]) =>
    makeIntake({ months: ['Dec'], year: 2026, destination: 'Paris', otherRequirements });

  test('same inputs resolve differently with the special-events checkbox on vs. off', async ({ page }) => {
    const avoiding = await resolve(page, december([]), [2026, 5, 1]);
    const seeking = await resolve(page, december([EVENTS_REQUIREMENT]), [2026, 5, 1]);
    expect(seeking.startDate).not.toBe(avoiding.startDate);
    expect(seeking.reason).not.toBe(avoiding.reason);
  });

  test('event-seeking aligns the range with a known destination event and says so', async ({ page }) => {
    const result = await resolve(page, december([EVENTS_REQUIREMENT]), [2026, 5, 1]);
    expect(result.startDate).toBe('2026-12-05'); // Christmas-market season start
    expect(result.reason).toMatch(/timed for Christmas markets/i);
  });

  test('default (checkbox off) steers clear of the holiday peak and says so', async ({ page }) => {
    const result = await resolve(page, december([]), [2026, 5, 1]);
    // Dec 23–31 is the Christmas–New Year peak; a 7-night trip must end before it.
    const endDay = Number(result.endDate.split('-')[2]);
    expect(result.endDate < '2026-12-23').toBe(true);
    expect(endDay).toBeLessThan(23);
    expect(result.reason).toMatch(/avoids .*Christmas/i);
  });
});

// ---------------------------------------------------------------------------
// Past-window roll-forward + minimum lead time
// ---------------------------------------------------------------------------
test.describe('General-window resolution — past windows and lead time', () => {
  test('months fully in the past roll forward to the same months next year, stated in the reason', async ({ page }) => {
    const result = await resolve(
      page,
      makeIntake({ months: ['Mar', 'Apr'], year: 2026 }),
      [2026, 7, 1] // Aug 1, 2026 — the whole Mar–Apr 2026 window has passed
    );
    const [year, month] = result.startDate.split('-').map(Number);
    expect(year).toBe(2027);
    expect([3, 4]).toContain(month); // same candidate months, next year
    expect(result.reason).toMatch(/rolled forward to 2027/i);
    expect(result.reason).toMatch(/2026 window has passed/i);
  });

  test('with `now` inside the only selected month, the range still starts at least 7 days out', async ({ page }) => {
    const result = await resolve(
      page,
      makeIntake({ months: ['Oct'], year: 2026 }),
      [2026, 9, 20] // Oct 20 — default mid-month start would already be past
    );
    expect(result.startDate).toBe('2026-10-27'); // clamped to now + 7 days
    expect(daysBetween('2026-10-20', result.startDate)).toBeGreaterThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------
test.describe('General-window resolution — determinism', () => {
  test('same inputs and same pinned now produce identical output', async ({ page }) => {
    const intake = makeIntake({
      months: ['Mar', 'Nov'],
      year: 2026,
      tripLength: '7-10 days',
      destination: 'Kyoto',
      otherRequirements: [EVENTS_REQUIREMENT],
    });
    const first = await resolve(page, intake, [2026, 0, 15]);
    const second = await resolve(page, intake, [2026, 0, 15]);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// UI flow — trip summary + persistence (real clock, far-future selections)
// ---------------------------------------------------------------------------
test.describe('Trip summary shows the resolved dates', () => {
  test('general-window submit shows a "Recommended:" rationale and persists dates.resolved', async ({ page }) => {
    await page.locator('#monthChips .chip[data-month="Apr"]').click();
    await page.locator('#yearPills .pill[data-year="2027"]').click();
    await fillNonDateRequiredFields(page, 'Tokyo');
    await submitBtn(page).click();

    await expect(page.locator('#confirmationCard')).toBeVisible();
    const rationale = page.locator('#dateRationale');
    await expect(rationale).toBeVisible();
    await expect(rationale).toContainText('Recommended:');
    await expect(rationale).toContainText('—'); // one-line reason attached

    const data = await readStored(page);
    expect(data.dates.resolved.startDate).toMatch(/^2027-04-\d{2}$/);
    expect(data.dates.resolved.endDate).toMatch(ISO_DATE);
    expect(data.dates.resolved.reason).toMatch(/^Recommended: /);
    // Raw window selections are preserved alongside the resolution
    expect(data.dates.months).toEqual(['Apr']);
    expect(data.dates.year).toBe(2027);
  });

  test('specific-dates submit shows the chosen dates without "Recommended:" and persists reason null', async ({ page }) => {
    await page.getByText('Specific dates').click();
    await page.locator('#startDate').fill('2027-06-01');
    await page.locator('#endDate').fill('2027-06-10');
    await fillNonDateRequiredFields(page, 'Tokyo');
    await submitBtn(page).click();

    await expect(page.locator('#confirmationCard')).toBeVisible();
    const rationale = page.locator('#dateRationale');
    await expect(rationale).toContainText('Jun 1, 2027');
    await expect(rationale).toContainText('Jun 10, 2027');
    await expect(rationale).not.toContainText('Recommended');

    const data = await readStored(page);
    expect(data.dates.resolved).toEqual({
      startDate: '2027-06-01',
      endDate: '2027-06-10',
      reason: null,
    });
  });
});
