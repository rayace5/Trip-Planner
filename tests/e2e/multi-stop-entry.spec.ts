import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler planning a multi-stop trip, I want to enter multiple
 * cities or countries in the order I'd visit them so that the plan covers my
 * whole route, not just one destination."
 *
 * PRD acceptance covered here:
 * - Ordered, reorderable stop list: add via Enter, rows removable and
 *   draggable (⠿ handle), order preserved from entry unless dragged.
 * - Rows renumber 1..n and the ↓ arrow separators re-render after any
 *   reorder or removal.
 * - Mid-drag visual state: exactly one .stop-row.dragging plus one coral
 *   insertion indicator (.drop-before/.drop-after); all cleared on drop.
 * - pointercancel aborts the drag without reordering; a single-stop drag
 *   is a no-op.
 * - Trip summary shows the full route in visit order ("A → B → C"; a
 *   single stop is just its name). Flexible-mode summary shows the
 *   SELECTED option's route and live-updates when another card is picked.
 * - destination.stops persists the final on-screen order at submit.
 */

const STORAGE_KEY = 'tripPlannerIntake';

function stopRows(page: Page) {
  return page.locator('#stopList .stop-row');
}

async function stopNames(page: Page): Promise<string[]> {
  return page.locator('#stopList .stop-row .stop-name').allInnerTexts();
}

async function stopNumbers(page: Page): Promise<string[]> {
  return page.locator('#stopList .stop-row .stop-num').allInnerTexts();
}

async function addStops(page: Page, names: string[]) {
  const input = page.getByPlaceholder('Add another city or country and press Enter');
  for (const name of names) {
    await input.fill(name);
    await input.press('Enter');
  }
}

/** Fills every other required field so the known-destination form submits. */
async function fillRequiredExceptStops(page: Page) {
  await page.locator('#monthChips .chip[data-month="Apr"]').click();
  await page.locator('#yearPills .pill[data-year="2027"]').click();
  await page.locator('#departingFrom').fill('Austin');
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill('2 adults');
}

async function fillFlexibleForm(page: Page, regions: string[]) {
  await fillRequiredExceptStops(page);
  await page.locator('#destModePills .pill[data-dest-mode="flexible"]').click();
  const regionInput = page.locator('#addRegionInput');
  for (const region of regions) {
    await regionInput.fill(region);
    await regionInput.press('Enter');
  }
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

/**
 * Drags the ⠿ handle of the row at `sourceIndex` so the stop lands
 * before/after the row currently at `targetIndex`. Uses raw mouse events
 * (Chromium emits the matching pointer events) because the app's drag is
 * pointer-event based, not HTML5 drag-and-drop. Hovering the handle first
 * scrolls the stop list into view (it sits below the 720px fold).
 */
async function dragStop(
  page: Page,
  sourceIndex: number,
  targetIndex: number,
  place: 'before' | 'after'
) {
  const handle = stopRows(page).nth(sourceIndex).locator('.drag');
  await handle.hover();
  await page.mouse.down();
  const box = await stopRows(page).nth(targetIndex).boundingBox();
  if (!box) throw new Error('target stop row is not visible');
  // Above the row's vertical midpoint inserts before it; below inserts after.
  const y = place === 'before' ? box.y + 2 : box.y + box.height - 2;
  await page.mouse.move(box.x + box.width / 2, y, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
});

// ---------------------------------------------------------------------------
// Ordered entry (regression): Enter adds stops in visit order
// ---------------------------------------------------------------------------
test.describe('Ordered stop entry', () => {
  test('stops added via Enter keep entry order, number 1..n, and separate rows with ↓ arrows', async ({ page }) => {
    await addStops(page, ['London', 'Paris', 'Amsterdam']);

    expect(await stopNames(page)).toEqual(['London', 'Paris', 'Amsterdam']);
    expect(await stopNumbers(page)).toEqual(['1', '2', '3']);
    await expect(page.locator('#stopList .stop-arrow')).toHaveCount(2);
    // Each row is draggable and removable
    await expect(page.locator('#stopList .stop-row .drag')).toHaveCount(3);
    await expect(page.locator('#stopList .stop-row .remove-x')).toHaveCount(3);
    // Helper advertises both reorder paths
    await expect(page.locator('#stopHelper')).toContainText('Drag ⠿ or use ↑ / ↓ to reorder');
  });

  test('removing a middle stop renumbers the rest and re-renders the arrows', async ({ page }) => {
    await addStops(page, ['London', 'Paris', 'Amsterdam']);
    await page.getByRole('button', { name: 'Remove Paris' }).click();

    expect(await stopNames(page)).toEqual(['London', 'Amsterdam']);
    expect(await stopNumbers(page)).toEqual(['1', '2']);
    await expect(page.locator('#stopList .stop-arrow')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Drag-to-reorder on the ⠿ handle
// ---------------------------------------------------------------------------
test.describe('Drag-to-reorder', () => {
  test('dragging row 3 before row 1 reorders, renumbers, and persists the new order at submit', async ({ page }) => {
    await fillRequiredExceptStops(page);
    await addStops(page, ['London', 'Paris', 'Amsterdam']);

    await dragStop(page, 2, 0, 'before');

    expect(await stopNames(page)).toEqual(['Amsterdam', 'London', 'Paris']);
    expect(await stopNumbers(page)).toEqual(['1', '2', '3']);
    await expect(page.locator('#stopList .stop-arrow')).toHaveCount(2);

    await submitBtn(page).click();
    await expect(page.locator('#confirmationCard')).toBeVisible();
    const data = await readStored(page);
    expect(data.destination.stops.map((s: { name: string }) => s.name)).toEqual([
      'Amsterdam',
      'London',
      'Paris',
    ]);
  });

  test('dragging row 1 below the last row moves it to the end', async ({ page }) => {
    await addStops(page, ['London', 'Paris', 'Amsterdam']);

    await dragStop(page, 0, 2, 'after');

    expect(await stopNames(page)).toEqual(['Paris', 'Amsterdam', 'London']);
    expect(await stopNumbers(page)).toEqual(['1', '2', '3']);
  });

  test('mid-drag shows exactly one dragging row and one insertion indicator, all cleared after drop', async ({ page }) => {
    await addStops(page, ['London', 'Paris', 'Amsterdam']);

    const handle = stopRows(page).nth(2).locator('.drag');
    await handle.hover();
    await page.mouse.down();
    const box = await stopRows(page).nth(0).boundingBox();
    if (!box) throw new Error('target stop row is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + 2, { steps: 5 });

    await expect(page.locator('.stop-row.dragging')).toHaveCount(1);
    await expect(stopRows(page).nth(2)).toHaveClass(/dragging/);
    await expect(page.locator('.stop-row.drop-before, .stop-row.drop-after')).toHaveCount(1);
    await expect(stopRows(page).nth(0)).toHaveClass(/drop-before/);

    await page.mouse.up();
    await expect(page.locator('.stop-row.dragging')).toHaveCount(0);
    await expect(page.locator('.stop-row.drop-before, .stop-row.drop-after')).toHaveCount(0);
    expect(await stopNames(page)).toEqual(['Amsterdam', 'London', 'Paris']);
  });

  test('pointercancel aborts the drag without reordering', async ({ page }) => {
    await addStops(page, ['London', 'Paris', 'Amsterdam']);

    const handle = stopRows(page).nth(2).locator('.drag');
    await handle.hover();
    await page.mouse.down();
    const box = await stopRows(page).nth(0).boundingBox();
    if (!box) throw new Error('target stop row is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + 2, { steps: 5 });
    await expect(page.locator('.stop-row.dragging')).toHaveCount(1);

    // e.g. the browser reclaiming the pointer for a touch gesture
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel')));

    await expect(page.locator('.stop-row.dragging')).toHaveCount(0);
    await expect(page.locator('.stop-row.drop-before, .stop-row.drop-after')).toHaveCount(0);
    expect(await stopNames(page)).toEqual(['London', 'Paris', 'Amsterdam']);
    await page.mouse.up(); // release the synthetic mouse button
    expect(await stopNames(page)).toEqual(['London', 'Paris', 'Amsterdam']);
  });

  test('dragging the only stop is a no-op', async ({ page }) => {
    await addStops(page, ['Tokyo']);

    const handle = stopRows(page).first().locator('.drag');
    await handle.hover();
    await page.mouse.down();
    await page.mouse.move(200, 200, { steps: 5 });
    await expect(page.locator('.stop-row.dragging')).toHaveCount(0);
    await expect(page.locator('.stop-row.drop-before, .stop-row.drop-after')).toHaveCount(0);
    await page.mouse.up();

    expect(await stopNames(page)).toEqual(['Tokyo']);
    expect(await stopNumbers(page)).toEqual(['1']);
  });

  test('↑ / ↓ move buttons still reorder correctly after a drag', async ({ page }) => {
    await addStops(page, ['London', 'Paris', 'Amsterdam']);
    await dragStop(page, 2, 0, 'before'); // → Amsterdam, London, Paris

    await page.getByRole('button', { name: 'Move Paris up' }).click();
    expect(await stopNames(page)).toEqual(['Amsterdam', 'Paris', 'London']);

    await page.getByRole('button', { name: 'Move Amsterdam down' }).click();
    expect(await stopNames(page)).toEqual(['Paris', 'Amsterdam', 'London']);
    expect(await stopNumbers(page)).toEqual(['1', '2', '3']);

    // Boundary buttons stay disabled after the re-render
    await expect(page.getByRole('button', { name: 'Move Paris up' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Move London down' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Trip summary shows the full route in visit order
// ---------------------------------------------------------------------------
test.describe('Trip summary route', () => {
  test('known-mode summary joins all stops in order with →', async ({ page }) => {
    await fillRequiredExceptStops(page);
    await addStops(page, ['London', 'Paris', 'Amsterdam']);
    await submitBtn(page).click();

    await expect(page.locator('#confirmationCard')).toBeVisible();
    await expect(page.locator('#confirmationSummary')).toContainText(
      'London → Paris → Amsterdam'
    );
  });

  test('a single stop shows just its name, with no arrow', async ({ page }) => {
    await fillRequiredExceptStops(page);
    await addStops(page, ['Tokyo']);
    await submitBtn(page).click();

    const summary = page.locator('#confirmationSummary');
    await expect(summary).toContainText('Tokyo');
    await expect(summary).not.toContainText('→');
  });

  test('flexible-mode summary shows the selected option route and live-updates on card change', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();
    await expect(page.locator('#destOptionsSection')).toBeVisible();

    // Initial summary = the pre-selected (recommended) option's route
    let data = await readStored(page);
    const initialRoute = data.destination.selectedOption.stops
      .map((s: { name: string }) => s.name)
      .join(' → ');
    await expect(page.locator('#confirmationSummary')).toContainText(initialRoute);

    // Clicking a different card rewrites the summary to that option's route
    const otherCard = page
      .locator('#destOptionsGrid .option-card:not(.selected)')
      .first();
    await otherCard.click();
    data = await readStored(page);
    const newRoute = data.destination.selectedOption.stops
      .map((s: { name: string }) => s.name)
      .join(' → ');
    expect(newRoute).not.toBe(initialRoute);
    await expect(page.locator('#confirmationSummary')).toContainText(newRoute);
  });
});
