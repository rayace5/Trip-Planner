import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler, I want to enter my dates, budget, and preferences once
 * so that I don't have to repeat myself across multiple tools."
 *
 * Covers the P0 "Intake form" acceptance criteria from trip-planner-prd.md:
 * dates (general window vs. specific dates), departure location, destination
 * ("I know where" ordered stops with a 6-stop max, and "I'm flexible" region
 * chips), budget, trip goal & travelers, trip style default, the fixed
 * 9-option "other requirements" checkbox group, invalid-submit feedback
 * (banner + inline highlighting), and valid-submit persistence to
 * localStorage (`tripPlannerIntake`) + confirmation card.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const STOP_PLACEHOLDER = 'Add another city or country and press Enter';
const REGION_PLACEHOLDER = 'Add another region, country, or city and press Enter';

function submitBtn(page: Page) {
  return page.getByRole('button', { name: /Build My Trip/i });
}

async function addStop(page: Page, name: string) {
  const input = page.getByPlaceholder(STOP_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
}

async function addRegion(page: Page, name: string) {
  const input = page.getByPlaceholder(REGION_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
}

/**
 * Fills every required field in the default (general window + "I know where") mode.
 * Pass { skipDates: true } when the test drives the Dates section itself
 * (e.g. specific-dates mode, where the month chips are hidden).
 */
async function fillRequiredFields(page: Page, opts: { skipDates?: boolean } = {}) {
  if (!opts.skipDates) {
    await page.locator('#monthChips .chip[data-month="Jun"]').click(); // year 2026 pre-selected
  }
  await page.locator('#departingFrom').fill('Austin');
  await addStop(page, 'London');
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
// Dates
// ---------------------------------------------------------------------------
test.describe('Dates', () => {
  test('general window is the default mode with year 2026 pre-selected', async ({ page }) => {
    await expect(page.locator('#dateModePills .pill.selected')).toHaveText('General window');
    await expect(page.locator('#generalWindowFields')).toBeVisible();
    await expect(page.locator('#specificDatesFields')).toBeHidden();
    await expect(page.locator('#yearPills .pill.selected')).toHaveText('2026');
  });

  test('general window: submitting with no month selected is blocked', async ({ page }) => {
    await fillRequiredFields(page);
    // Deselect the month again so only the month requirement fails
    await page.locator('#monthChips .chip[data-month="Jun"]').click();
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toBeVisible();
    await expect(page.locator('#errorBanner')).toContainText(/at least one month/i);
    await expect(page.locator('#confirmationCard')).toBeHidden();
    expect(await readStored(page)).toBeNull();
  });

  test('general window: month + pre-selected year satisfies the dates requirement', async ({ page }) => {
    await fillRequiredFields(page);
    await submitBtn(page).click();
    await expect(page.locator('#confirmationCard')).toBeVisible();
    const data = await readStored(page);
    expect(data.dates).toMatchObject({
      mode: 'general',
      months: ['Jun'],
      year: 2026,
      startDate: null,
      endDate: null,
    });
  });

  test('switching to specific dates shows date fields and hides the general window fields', async ({ page }) => {
    await page.getByText('Specific dates').click();
    await expect(page.locator('#specificDatesFields')).toBeVisible();
    await expect(page.locator('#generalWindowFields')).toBeHidden();
  });

  test('specific dates: submitting without start and end dates is blocked', async ({ page }) => {
    await page.getByText('Specific dates').click();
    await fillRequiredFields(page, { skipDates: true });
    await submitBtn(page).click();
    const banner = page.locator('#errorBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/start date/i);
    await expect(banner).toContainText(/end date/i);
    await expect(page.locator('#confirmationCard')).toBeHidden();
  });

  test('specific dates: start date alone is not enough — end date still required', async ({ page }) => {
    await page.getByText('Specific dates').click();
    await fillRequiredFields(page, { skipDates: true });
    await page.locator('#startDate').fill('2026-06-01');
    await submitBtn(page).click();
    const banner = page.locator('#errorBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/end date/i);
    await expect(banner).not.toContainText(/start date/i);
  });

  test('specific dates: end date before start date is rejected', async ({ page }) => {
    await page.getByText('Specific dates').click();
    await fillRequiredFields(page, { skipDates: true });
    await page.locator('#startDate').fill('2026-06-10');
    await page.locator('#endDate').fill('2026-06-01');
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toContainText(/on or after the start date/i);
    await expect(page.locator('#confirmationCard')).toBeHidden();
  });

  test('specific dates: both dates provided allows submission and persists them', async ({ page }) => {
    await page.getByText('Specific dates').click();
    await fillRequiredFields(page, { skipDates: true });
    await page.locator('#startDate').fill('2026-06-01');
    await page.locator('#endDate').fill('2026-06-10');
    await submitBtn(page).click();
    await expect(page.locator('#confirmationCard')).toBeVisible();
    const data = await readStored(page);
    expect(data.dates).toMatchObject({
      mode: 'specific',
      startDate: '2026-06-01',
      endDate: '2026-06-10',
      months: [],
      year: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Departing from
// ---------------------------------------------------------------------------
test.describe('Departing from', () => {
  test('is required — empty field blocks submission and is highlighted inline', async ({ page }) => {
    await fillRequiredFields(page);
    await page.locator('#departingFrom').fill('');
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toContainText('Departing from');
    await expect(page.locator('#departingFrom')).toHaveClass(/invalid/);
    await expect(page.locator('#confirmationCard')).toBeHidden();
  });

  test('whitespace-only value is treated as empty', async ({ page }) => {
    await fillRequiredFields(page);
    await page.locator('#departingFrom').fill('   ');
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toContainText('Departing from');
  });
});

// ---------------------------------------------------------------------------
// Destination — "I know where" (ordered stops)
// ---------------------------------------------------------------------------
test.describe('Destination — I know where', () => {
  test('requires at least one stop', async ({ page }) => {
    await fillRequiredFields(page);
    await page.locator('.stop-row .remove-x').click(); // remove the stop added by the helper
    await expect(page.locator('.stop-row')).toHaveCount(0);
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toContainText(/at least one stop/i);
    await expect(page.locator('#confirmationCard')).toBeHidden();
  });

  test('typing + Enter adds a stop row and clears the input', async ({ page }) => {
    await addStop(page, 'Paris');
    await expect(page.locator('.stop-row')).toHaveCount(1);
    await expect(page.locator('.stop-row .stop-name')).toHaveText('Paris');
    await expect(page.getByPlaceholder(STOP_PLACEHOLDER)).toHaveValue('');
  });

  test('blank input + Enter does not add a stop', async ({ page }) => {
    const input = page.getByPlaceholder(STOP_PLACEHOLDER);
    await input.fill('   ');
    await input.press('Enter');
    await expect(page.locator('.stop-row')).toHaveCount(0);
  });

  test('stops preserve entry order and can be reordered with the arrows', async ({ page }) => {
    await addStop(page, 'London');
    await addStop(page, 'Paris');
    await addStop(page, 'Amsterdam');
    await expect(page.locator('.stop-row .stop-name')).toHaveText(['London', 'Paris', 'Amsterdam']);
    // Move Amsterdam up one place
    await page.locator('.stop-row').nth(2).locator('.move-up').click();
    await expect(page.locator('.stop-row .stop-name')).toHaveText(['London', 'Amsterdam', 'Paris']);
    // First row cannot move up, last cannot move down
    await expect(page.locator('.stop-row').nth(0).locator('.move-up')).toBeDisabled();
    await expect(page.locator('.stop-row').nth(2).locator('.move-down')).toBeDisabled();
  });

  test('stop rows are removable', async ({ page }) => {
    await addStop(page, 'London');
    await addStop(page, 'Paris');
    await page.locator('.stop-row', { hasText: 'London' }).locator('.remove-x').click();
    await expect(page.locator('.stop-row')).toHaveCount(1);
    await expect(page.locator('.stop-row .stop-name')).toHaveText('Paris');
  });

  test('nights are optional: blank persists null, a value persists as a number', async ({ page }) => {
    await fillRequiredFields(page); // adds "London" with nights left blank
    await addStop(page, 'Paris');
    await page.locator('.stop-row', { hasText: 'Paris' }).locator('.nights-input').fill('4');
    await submitBtn(page).click();
    await expect(page.locator('#confirmationCard')).toBeVisible();
    const data = await readStored(page);
    expect(data.destination.mode).toBe('known');
    expect(data.destination.stops).toEqual([
      { name: 'London', nights: null },
      { name: 'Paris', nights: 4 },
    ]);
  });

  test('input disables with an inline message at 6 stops, and re-enables after a removal', async ({ page }) => {
    const input = page.getByPlaceholder(STOP_PLACEHOLDER);
    for (let i = 1; i <= 6; i++) await addStop(page, `Stop ${i}`);
    await expect(page.locator('.stop-row')).toHaveCount(6);
    await expect(input).toBeDisabled();
    await expect(page.locator('#stopLimitMsg')).toBeVisible();
    await expect(page.locator('#stopLimitMsg')).toContainText('6/6');
    // Removing a stop lifts the limit
    await page.locator('.stop-row .remove-x').first().click();
    await expect(page.locator('.stop-row')).toHaveCount(5);
    await expect(input).toBeEnabled();
    await expect(page.locator('#stopLimitMsg')).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// Destination — "I'm flexible" (region chips)
// ---------------------------------------------------------------------------
test.describe("Destination — I'm flexible", () => {
  test('toggling shows the region entry and hides the stop list', async ({ page }) => {
    await page.getByText("I'm flexible").click();
    await expect(page.locator('#flexibleDestField')).toBeVisible();
    await expect(page.locator('#fixedDestField')).toBeHidden();
  });

  test('requires at least one region chip', async ({ page }) => {
    await fillRequiredFields(page);
    await page.getByText("I'm flexible").click(); // no regions added
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toContainText(/at least one region/i);
    await expect(page.locator('#confirmationCard')).toBeHidden();
  });

  test('regions added via Enter become removable chips and persist on submit', async ({ page }) => {
    await fillRequiredFields(page);
    await page.getByText("I'm flexible").click();
    await addRegion(page, 'Portugal');
    await addRegion(page, 'Japan');
    await expect(page.locator('#regionChipList .chip')).toHaveCount(2);
    // Chips are removable
    await page.locator('#regionChipList .chip', { hasText: 'Portugal' }).locator('.chip-x').click();
    await expect(page.locator('#regionChipList .chip')).toHaveCount(1);
    await submitBtn(page).click();
    await expect(page.locator('#confirmationCard')).toBeVisible();
    const data = await readStored(page);
    expect(data.destination).toMatchObject({ mode: 'flexible', regions: ['Japan'], stops: [] });
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------
test.describe('Budget', () => {
  test('per-person/group and included/separate toggles default to Per person + Included', async ({ page }) => {
    await expect(page.locator('#budgetScopePills .pill.selected')).toHaveText('Per person');
    await expect(page.locator('#budgetIncludesPills .pill.selected')).toHaveText('Included');
  });

  test('empty amount blocks submission and highlights the field', async ({ page }) => {
    await fillRequiredFields(page);
    await page.locator('#budgetAmount').fill('');
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toContainText('Total budget');
    await expect(page.locator('#budgetAmount')).toHaveClass(/invalid/);
  });

  test.describe('non-positive or non-numeric amounts are rejected', () => {
    for (const bad of ['0', '-100', 'abc']) {
      test(`"${bad}" is rejected`, async ({ page }) => {
        await fillRequiredFields(page);
        await page.locator('#budgetAmount').fill(bad);
        await submitBtn(page).click();
        await expect(page.locator('#errorBanner')).toContainText(/positive number/i);
        await expect(page.locator('#confirmationCard')).toBeHidden();
      });
    }
  });

  test('a positive amount with default toggles persists as per-person / included', async ({ page }) => {
    await fillRequiredFields(page);
    await submitBtn(page).click();
    const data = await readStored(page);
    expect(data.budget).toEqual({ amount: 3000, scope: 'per-person', flightsLodging: 'included' });
  });

  test('toggled values (Group total / Separate) and $ formatting persist correctly', async ({ page }) => {
    await fillRequiredFields(page);
    await page.locator('#budgetAmount').fill('$4,500');
    await page.getByText('Group total').click();
    await page.locator('#budgetIncludesPills .pill', { hasText: 'Separate' }).click();
    await submitBtn(page).click();
    const data = await readStored(page);
    expect(data.budget).toEqual({ amount: 4500, scope: 'group', flightsLodging: 'separate' });
  });
});

// ---------------------------------------------------------------------------
// Trip goal & travelers
// ---------------------------------------------------------------------------
test.describe('Trip goal & travelers', () => {
  test('purpose is required', async ({ page }) => {
    await fillRequiredFields(page);
    await page.locator('#tripPurpose').fill('');
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toContainText('Purpose of the trip');
    await expect(page.locator('#tripPurpose')).toHaveClass(/invalid/);
  });

  test("who's going is required", async ({ page }) => {
    await fillRequiredFields(page);
    await page.locator('#whoIsGoing').fill('');
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toContainText("Who's going");
    await expect(page.locator('#whoIsGoing')).toHaveClass(/invalid/);
  });

  test('constraints are optional — blank submits fine, a value is persisted', async ({ page }) => {
    await fillRequiredFields(page); // constraints left blank
    await submitBtn(page).click();
    await expect(page.locator('#confirmationCard')).toBeVisible();
    let data = await readStored(page);
    expect(data.travelers).toEqual({ purpose: 'Anniversary', whoIsGoing: '2 adults', constraints: '' });

    // Resubmit with a constraint value
    await page.locator('#editAgainBtn').click();
    await page.locator('#constraints').fill('vegetarian');
    await submitBtn(page).click();
    data = await readStored(page);
    expect(data.travelers.constraints).toBe('vegetarian');
  });
});

// ---------------------------------------------------------------------------
// Trip style
// ---------------------------------------------------------------------------
test.describe('Trip style', () => {
  test('defaults to Balanced mix and persists it when untouched', async ({ page }) => {
    await expect(page.locator('#styleRange')).toHaveValue('3');
    await expect(page.locator('#styleLabels span.active')).toHaveText('Balanced mix');
    await fillRequiredFields(page);
    await submitBtn(page).click();
    const data = await readStored(page);
    expect(data.tripStyle).toBe('Balanced mix');
  });

  test('a different style selection is persisted', async ({ page }) => {
    await fillRequiredFields(page);
    await page.locator('#styleLabels span', { hasText: 'Adventure' }).click();
    await expect(page.locator('#styleRange')).toHaveValue('1');
    await submitBtn(page).click();
    const data = await readStored(page);
    expect(data.tripStyle).toBe('Adventure');
  });
});

// ---------------------------------------------------------------------------
// Other requirements
// ---------------------------------------------------------------------------
test.describe('Other requirements', () => {
  const EXPECTED_OPTIONS = [
    'Accessible for people with limited mobility',
    'Pet-friendly',
    'Kid-friendly',
    'No rental car',
    'Walkable cities preferred',
    'Travel during key special events/holidays for that destination',
    'Looking for popular bucket list destinations and activities',
    'English predominantly spoken',
    'Female solo travel friendly',
  ];

  test('has exactly the 9 specified checkboxes, none pre-checked', async ({ page }) => {
    const boxes = page.locator('#otherReqs input[type="checkbox"]');
    await expect(boxes).toHaveCount(9);
    const values = await boxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    expect(values).toEqual(EXPECTED_OPTIONS);
    for (let i = 0; i < 9; i++) {
      await expect(boxes.nth(i)).not.toBeChecked();
    }
  });

  test('is optional — submitting with none checked persists an empty array', async ({ page }) => {
    await fillRequiredFields(page);
    await submitBtn(page).click();
    const data = await readStored(page);
    expect(data.otherRequirements).toEqual([]);
  });

  test('checked options are persisted, including potentially conflicting combinations', async ({ page }) => {
    await fillRequiredFields(page);
    // Per the PRD, conflicting requirement combos warn on the results page but never block intake.
    await page.getByText('No rental car').click();
    await page.getByText('Walkable cities preferred').click();
    await submitBtn(page).click();
    await expect(page.locator('#confirmationCard')).toBeVisible();
    const data = await readStored(page);
    expect(data.otherRequirements).toEqual(['No rental car', 'Walkable cities preferred']);
  });
});

// ---------------------------------------------------------------------------
// Submission feedback & persistence
// ---------------------------------------------------------------------------
test.describe('Submission', () => {
  test('empty submit shows the missing-fields banner listing every problem, with inline highlighting', async ({ page }) => {
    await submitBtn(page).click();
    const banner = page.locator('#errorBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/missing/i);
    await expect(banner).toContainText(/at least one month/i);
    await expect(banner).toContainText('Departing from');
    await expect(banner).toContainText(/at least one stop/i);
    await expect(banner).toContainText('Total budget');
    await expect(banner).toContainText('Purpose of the trip');
    await expect(banner).toContainText("Who's going");
    // Inline highlighting on both plain inputs and grouped controls
    await expect(page.locator('#departingFrom')).toHaveClass(/invalid/);
    await expect(page.locator('#monthChips')).toHaveClass(/invalid-group/);
    // Nothing persisted, no confirmation
    await expect(page.locator('#confirmationCard')).toBeHidden();
    expect(await readStored(page)).toBeNull();
  });

  test('fixing the flagged fields clears the banner and submits', async ({ page }) => {
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toBeVisible();
    await fillRequiredFields(page);
    await submitBtn(page).click();
    await expect(page.locator('#errorBanner')).toBeHidden();
    await expect(page.locator('#confirmationCard')).toBeVisible();
  });

  test('valid submit persists the full documented shape to localStorage and shows the confirmation card', async ({ page }) => {
    await fillRequiredFields(page);
    await page.locator('#tripLength').fill('7-10 days');
    await page.locator('#mustSee').fill('Tower of London');
    await submitBtn(page).click();

    await expect(page.locator('#confirmationCard')).toBeVisible();
    await expect(page.locator('#intakeForm')).toBeHidden();
    await expect(page.locator('#confirmationSummary')).toContainText('London');

    const data = await readStored(page);
    expect(data).toMatchObject({
      dates: { mode: 'general', months: ['Jun'], year: 2026, tripLength: '7-10 days', startDate: null, endDate: null },
      departingFrom: 'Austin',
      destination: { mode: 'known', stops: [{ name: 'London', nights: null }], regions: [] },
      budget: { amount: 3000, scope: 'per-person', flightsLodging: 'included' },
      travelers: { purpose: 'Anniversary', whoIsGoing: '2 adults', constraints: '' },
      tripStyle: 'Balanced mix',
      mustSee: 'Tower of London',
      otherRequirements: [],
    });
    expect(typeof data.submittedAt).toBe('string');
    expect(Number.isNaN(Date.parse(data.submittedAt))).toBe(false);
  });

  test('"Edit my answers" returns to the form from the confirmation card', async ({ page }) => {
    await fillRequiredFields(page);
    await submitBtn(page).click();
    await expect(page.locator('#confirmationCard')).toBeVisible();
    await page.locator('#editAgainBtn').click();
    await expect(page.locator('#confirmationCard')).toBeHidden();
    await expect(page.locator('#intakeForm')).toBeVisible();
  });
});
