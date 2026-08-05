import { test, expect } from '@playwright/test';

/**
 * Starter Playwright suite for the Trip Planner intake form + results view.
 * This is a scaffold to configure the pipeline against — write-unit-tests
 * and implement-story will add to this file (or split it up) as real
 * stories land. Update the file/selector paths once the real app file
 * exists (e.g. index.html at repo root, built from the mockup).
 */

test.describe('Trip Planner intake form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
  });

  test('loads the intake form by default', async ({ page }) => {
    await expect(page.locator('#stage-input')).toBeVisible();
    await expect(page.locator('#stage-results')).toBeHidden();
  });

  test('toggling to "General window" shows month chips instead of date fields', async ({ page }) => {
    await page.getByText('General window').click();
    await expect(page.locator('#generalWindowFields')).toBeVisible();
    await expect(page.locator('#specificDatesFields')).toBeHidden();
  });

  test('destination stop list enforces the 6-stop max', async ({ page }) => {
    const addStopInput = page.getByPlaceholder('Add another city or country and press Enter');
    for (let i = 0; i < 6; i++) {
      await addStopInput.fill(`Stop ${i + 1}`);
      await addStopInput.press('Enter');
    }
    await expect(addStopInput).toBeDisabled();
    await expect(page.locator('.stop-row')).toHaveCount(6);
  });

  test('submitting with required fields missing shows the missing-fields banner', async ({ page }) => {
    await page.getByRole('button', { name: /Build My Trip/i }).click();
    await expect(page.getByText(/missing/i)).toBeVisible();
  });
});

test.describe('Trip Planner results view', () => {
  // Deferred: the results view is intentionally not built until the results-view story lands.
  test.fixme('selecting a non-recommended flight option updates the budget total', async ({ page }) => {
    await page.goto('/index.html');
    // This assumes a real submitted-results state; adapt once form -> results
    // wiring exists. Left as a scaffold for write-unit-tests to complete.
    const initialTotal = await page.locator('.budget-row.total .amt').innerText();
    await page.locator('.option-card').nth(0).click();
    const updatedTotal = await page.locator('.budget-row.total .amt').innerText();
    expect(updatedTotal).not.toBe(initialTotal);
  });
});
