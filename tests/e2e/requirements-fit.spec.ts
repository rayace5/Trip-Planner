import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler with special requirements (accessibility, pet-friendly,
 * kid-friendly, solo-female-friendly), I want them to actually shape the
 * recommendations, and when a requirement conflicts with the results I want a
 * warning that never blocks the plan (warn and continue)."
 *
 * Covers:
 *  - Scoring: accessibility / pet / kid / solo checkboxes boost strong fits
 *    (+2 with a truthful reason clause), penalize poor fits (−1 with an honest
 *    trade-off clause), and record `requirementGaps` per option; unknown
 *    entries never fabricate gaps; solo never produces a gap.
 *  - `window.detectConflictWarnings(data)`: flexible-mode warning when the
 *    recommended option (or every option) has the gap; leg warning when
 *    "No rental car" excluded a drive that would have won; label adaptation;
 *    empty array when nothing was compromised.
 *  - UI: non-blocking #conflictBanner near the trip summary (inline for one
 *    warning, intro + <ul> for several), persisted at
 *    `tripPlannerIntake.conflictWarnings` (always an array), hidden on "Edit
 *    my answers", and re-evaluated when the destination option switches.
 *
 * Generator/detector cases call the exposed pure functions via page.evaluate;
 * UI cases drive the real form with far-future (2027) selections.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const STOP_PLACEHOLDER = 'Add another city or country and press Enter';

const ACCESS_REQ = 'Accessible for people with limited mobility';
const PET_REQ = 'Pet-friendly';
const KID_REQ = 'Kid-friendly';
const SOLO_REQ = 'Female solo travel friendly';
const NO_RENTAL_REQ = 'No rental car';
const WALKABLE_REQ = 'Walkable cities preferred';
const ENGLISH_REQ = 'English predominantly spoken';

type DestOption = {
  name: string;
  rationale: string;
  tradeoff: string;
  requirementGaps: string[];
  recommended: boolean;
  recommendedReason: string | null;
};

interface IntakeOverrides {
  regions?: string[];
  tripStyle?: string;
  otherRequirements?: string[];
}

/** Minimal flexible-destination intake for the pure generator (7 nights, May 2027). */
function makeIntake(overrides: IntakeOverrides = {}) {
  return {
    dates: {
      mode: 'specific',
      months: [] as string[],
      year: 2027,
      tripLength: '',
      startDate: '2027-05-10',
      endDate: '2027-05-17',
      resolved: { startDate: '2027-05-10', endDate: '2027-05-17', reason: null },
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

function detect(page: Page, data: unknown): Promise<string[]> {
  return page.evaluate((d) => (window as any).detectConflictWarnings(d), data);
}

function recommendedOf(options: DestOption[]): DestOption {
  const rec = options.filter((o) => o.recommended);
  expect(rec).toHaveLength(1);
  return rec[0];
}

function submitBtn(page: Page) {
  return page.getByRole('button', { name: /Build My Trip/i });
}

function banner(page: Page) {
  return page.locator('#conflictBanner');
}

function readStored(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) as string),
    STORAGE_KEY
  );
}

async function checkReqs(page: Page, reqs: string[]) {
  for (const req of reqs) {
    await page.locator(`#otherReqs input[value="${req}"]`).check();
  }
}

/** Flexible mode, general window Apr 2027, with the given other-requirements. */
async function fillFlexibleForm(page: Page, regions: string[], reqs: string[] = []) {
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
  await checkReqs(page, reqs);
}

/** Known-destination mode with specific dates Jun 1–9, 2027. */
async function fillKnownForm(page: Page, stops: string[], reqs: string[] = []) {
  await page.getByText('Specific dates').click();
  await page.locator('#startDate').fill('2027-06-01');
  await page.locator('#endDate').fill('2027-06-09');
  await page.locator('#departingFrom').fill('Austin');
  const stopInput = page.getByPlaceholder(STOP_PLACEHOLDER);
  for (const s of stops) {
    await stopInput.fill(s);
    await stopInput.press('Enter');
  }
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill('2 adults');
  await checkReqs(page, reqs);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
});

// ---------------------------------------------------------------------------
// Generator — special requirements shape scoring, rationale, and gaps
// ---------------------------------------------------------------------------
test.describe('Generator: special requirements shape the recommendation', () => {
  test('accessibility flips Southeast Asia toward Singapore and claims it only where true', async ({ page }) => {
    const without = recommendedOf(
      await generate(page, makeIntake({ regions: ['Southeast Asia'] }))
    );
    expect(without.name).toBe('Bangkok + Chiang Mai');

    const options = await generate(
      page,
      makeIntake({ regions: ['Southeast Asia'], otherRequirements: [ACCESS_REQ] })
    );
    const rec = recommendedOf(options);
    expect(rec.name).toBe('Singapore'); // access: 2 — the honest strong fit
    expect(rec.recommendedReason).toContain('flat, step-free-friendly getting around');
    expect(rec.rationale).toContain('flat and modern with step-free options for limited mobility');
    expect(rec.requirementGaps).not.toContain('access');

    // The poor fit (access: 0) gets the gap recorded and an honest trade-off
    const bkk = options.find((o) => o.name === 'Bangkok + Chiang Mai') as DestOption;
    expect(bkk.requirementGaps).toContain('access');
    expect(bkk.tradeoff).toContain('stairs, hills, or uneven streets make it tough with limited mobility');
  });

  test('pet-friendly boosts pet=2 picks and records honest gaps on pet=0 ones', async ({ page }) => {
    const options = await generate(
      page,
      makeIntake({ regions: ['Texas'], otherRequirements: [PET_REQ] })
    );
    const rec = recommendedOf(options);
    expect(rec.name).toBe('Austin'); // pet: 2 — road-trippable with pet lodging
    expect(rec.recommendedReason).toContain('genuinely pet-friendly');
    expect(rec.rationale).toContain('road-trip-friendly with plenty of pet-friendly lodging');
    expect(rec.requirementGaps).not.toContain('pet');

    const vegas = options.find((o) => o.name === 'Las Vegas + Grand Canyon') as DestOption;
    expect(vegas.requirementGaps).toContain('pet');
    expect(vegas.tradeoff).toContain('bringing a pet is impractical (long flights and pet-entry rules)');
  });

  test('kid-friendly flips the Europe recommendation toward the kid=2 pick', async ({ page }) => {
    const without = recommendedOf(await generate(page, makeIntake({ regions: ['Europe'] })));
    expect(without.name).toBe('London + Paris');

    const rec = recommendedOf(
      await generate(page, makeIntake({ regions: ['Europe'], otherRequirements: [KID_REQ] }))
    );
    expect(rec.name).toBe('Barcelona'); // kid: 2 beats the kid: 1 combos
    expect(rec.recommendedReason).toContain('easy with kids');
    expect(rec.rationale).toContain('an easy destination with kids');
  });

  test('solo-female-friendly boosts solo=2 picks but never records a gap anywhere', async ({ page }) => {
    const spain = makeIntake({
      regions: ['Spain'],
      tripStyle: 'Cultural exploration',
      otherRequirements: [SOLO_REQ],
    });
    const without = recommendedOf(
      await generate(page, { ...spain, otherRequirements: [] })
    );
    expect(without.name).toBe('Barcelona');

    const rec = recommendedOf(await generate(page, spain));
    expect(rec.name).toBe('Madrid + Seville'); // solo: 2
    expect(rec.recommendedReason).toContain('a strong fit for solo female travel');
    expect(rec.rationale).toContain('well-suited to solo female travelers');

    // The catalog holds no solo=0 proposal, so solo can never conflict
    for (const regions of [['Spain'], ['Japan'], ['Texas'], ['Europe'], ['Southeast Asia'], ['Mexico']]) {
      const options = await generate(
        page,
        makeIntake({ regions, otherRequirements: [SOLO_REQ] })
      );
      for (const o of options) expect(o.requirementGaps).not.toContain('solo');
    }
  });

  test('unknown entries carry an empty requirementGaps array — no fabricated conflicts', async ({ page }) => {
    const options = await generate(
      page,
      makeIntake({
        regions: ['Svalbard'],
        otherRequirements: [ACCESS_REQ, PET_REQ, KID_REQ, SOLO_REQ, NO_RENTAL_REQ, ENGLISH_REQ],
      })
    );
    expect(options[0].name).toBe('Svalbard');
    expect(options[0].requirementGaps).toEqual([]);
    // Every option (including catalog supplements) exposes the array
    for (const o of options) expect(Array.isArray(o.requirementGaps)).toBe(true);
  });

  test('is deterministic with special requirements checked', async ({ page }) => {
    const intake = makeIntake({
      regions: ['Portugal', 'Japan'],
      otherRequirements: [ACCESS_REQ, PET_REQ, KID_REQ, SOLO_REQ],
    });
    const first = await generate(page, intake);
    const second = await generate(page, intake);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// detectConflictWarnings — pure detector on hand-built data
// ---------------------------------------------------------------------------
test.describe('detectConflictWarnings: flexible-mode gaps', () => {
  const flexible = (
    reqs: string[],
    options: Array<{ recommended: boolean; requirementGaps: string[] }>,
    legs: unknown[] = []
  ) => ({
    otherRequirements: reqs,
    destination: { mode: 'flexible', options },
    legs,
  });

  test('warns when the recommended option compromises a checked requirement', async ({ page }) => {
    const warnings = await detect(
      page,
      flexible([PET_REQ], [
        { recommended: true, requirementGaps: ['pet'] },
        { recommended: false, requirementGaps: [] },
      ])
    );
    expect(warnings).toEqual([
      'Limited pet-friendly options fit your other criteria — showing the closest available matches.',
    ]);
  });

  test('stays silent when the recommendation honestly satisfies the requirement', async ({ page }) => {
    // Other options compromise, but the recommended one does not — no warning
    const warnings = await detect(
      page,
      flexible([ACCESS_REQ], [
        { recommended: true, requirementGaps: [] },
        { recommended: false, requirementGaps: ['access'] },
        { recommended: false, requirementGaps: ['access'] },
      ])
    );
    expect(warnings).toEqual([]);
  });

  test('a gap on an unchecked requirement is ignored', async ({ page }) => {
    const warnings = await detect(
      page,
      flexible([], [{ recommended: true, requirementGaps: ['pet', 'access', 'kid'] }])
    );
    expect(warnings).toEqual([]);
  });

  test('warns when every option has the gap, even without a recommended flag', async ({ page }) => {
    const warnings = await detect(
      page,
      flexible([KID_REQ], [
        { recommended: false, requirementGaps: ['kid'] },
        { recommended: false, requirementGaps: ['kid'] },
      ])
    );
    expect(warnings).toEqual([
      'Limited kid-friendly options fit your other criteria — showing the closest available matches.',
    ]);
  });

  test('multiple compromised requirements yield one warning each', async ({ page }) => {
    const warnings = await detect(
      page,
      flexible([ENGLISH_REQ, PET_REQ], [
        { recommended: true, requirementGaps: ['english', 'pet'] },
      ])
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('English-speaking');
    expect(warnings[1]).toContain('pet-friendly');
  });

  test('the walkability label adapts to which checkbox(es) triggered it', async ({ page }) => {
    const opts = [{ recommended: true, requirementGaps: ['walkable'] }];
    expect(await detect(page, flexible([NO_RENTAL_REQ], opts))).toEqual([
      'Limited no-rental-car options fit your other criteria — showing the closest available matches.',
    ]);
    expect(await detect(page, flexible([WALKABLE_REQ], opts))).toEqual([
      'Limited walkable options fit your other criteria — showing the closest available matches.',
    ]);
    expect(await detect(page, flexible([NO_RENTAL_REQ, WALKABLE_REQ], opts))).toEqual([
      'Limited walkable, no-rental-car options fit your other criteria — showing the closest available matches.',
    ]);
  });

  test('known-destination mode never reads destination options for conflicts', async ({ page }) => {
    const warnings = await detect(page, {
      otherRequirements: [PET_REQ],
      destination: {
        mode: 'known',
        options: [{ recommended: true, requirementGaps: ['pet'] }],
      },
      legs: [],
    });
    expect(warnings).toEqual([]);
  });
});

test.describe('detectConflictWarnings: no-rental-car leg compromises', () => {
  test('a leg whose drive would have won produces a warning naming the leg', async ({ page }) => {
    const warnings = await detect(page, {
      otherRequirements: [NO_RENTAL_REQ],
      destination: { mode: 'known' },
      legs: [
        {
          from: 'Austin',
          to: 'Dallas',
          options: [{ mode: 'flight', recommended: true, noRentalCompromise: true }],
        },
        {
          from: 'Dallas',
          to: 'Houston',
          options: [{ mode: 'train', recommended: true }],
        },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"No rental car" is a squeeze on the Austin → Dallas leg');
    expect(warnings[0]).toContain('driving would otherwise be the most practical option');
    expect(warnings[0]).not.toContain('Houston');
  });

  test('two squeezed legs are named together with plural wording', async ({ page }) => {
    const warnings = await detect(page, {
      otherRequirements: [NO_RENTAL_REQ],
      destination: { mode: 'known' },
      legs: [
        { from: 'Austin', to: 'Dallas', options: [{ noRentalCompromise: true }] },
        { from: 'Dallas', to: 'Houston', options: [{ noRentalCompromise: true }] },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Austin → Dallas and Dallas → Houston legs');
  });

  test('returns an empty array when nothing was compromised', async ({ page }) => {
    const warnings = await detect(page, {
      otherRequirements: [NO_RENTAL_REQ, PET_REQ, ACCESS_REQ],
      destination: { mode: 'known' },
      legs: [{ from: 'Kyoto', to: 'Osaka', options: [{ mode: 'train', recommended: true }] }],
    });
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// UI — warn-and-continue banner
// ---------------------------------------------------------------------------
test.describe('Conflict banner UI: warn and continue', () => {
  test('pet-friendly + Europe warns in a banner but still renders the full plan', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe'], [PET_REQ]);
    await submitBtn(page).click();

    // The banner is visible, polite, and names the compromised requirement
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toHaveAttribute('role', 'status');
    await expect(banner(page).locator('.icon')).toHaveText('⚠');
    await expect(banner(page)).toContainText(
      'Limited pet-friendly options fit your other criteria — showing the closest available matches.'
    );
    // Single warning renders inline — no list
    await expect(banner(page).locator('ul')).toHaveCount(0);

    // Never blocks: the whole plan still renders around it
    await expect(page.locator('#confirmationCard')).toBeVisible();
    await expect(page.locator('#destOptionsSection')).toBeVisible();
    await expect(page.locator('#routeSection')).toBeVisible();
    await expect(page.locator('#legsSection')).toBeVisible();

    // Persisted as a one-entry array
    const data = await readStored(page);
    expect(data.conflictWarnings).toEqual([
      'Limited pet-friendly options fit your other criteria — showing the closest available matches.',
    ]);
  });

  test('no conflicts → hidden banner and a persisted empty array', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();

    await expect(page.locator('#confirmationCard')).toBeVisible();
    await expect(banner(page)).toBeHidden();
    const data = await readStored(page);
    expect(data.conflictWarnings).toEqual([]);
  });

  test('solo-female-friendly never conflicts (boost-only requirement)', async ({ page }) => {
    await fillFlexibleForm(page, ['Japan'], [SOLO_REQ]);
    await submitBtn(page).click();

    await expect(page.locator('#confirmationCard')).toBeVisible();
    await expect(banner(page)).toBeHidden();
    expect((await readStored(page)).conflictWarnings).toEqual([]);
  });

  test('known-mode "No rental car" on a drive-first leg warns and names the leg', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], [NO_RENTAL_REQ]);
    await submitBtn(page).click();

    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText(
      '"No rental car" is a squeeze on the Austin → Dallas leg'
    );
    // The leg still renders its non-drive options — nothing was blocked
    await expect(page.locator('#legsSection')).toBeVisible();
    await expect(
      page.locator('#legsContainer .option-card[data-leg-option-mode="drive"]')
    ).toHaveCount(0);

    const data = await readStored(page);
    expect(data.conflictWarnings).toHaveLength(1);
    expect(data.conflictWarnings[0]).toContain('Austin → Dallas');
  });

  test('known-mode "No rental car" where the train wins anyway shows no banner', async ({ page }) => {
    await fillKnownForm(page, ['Kyoto', 'Osaka'], [NO_RENTAL_REQ]);
    await submitBtn(page).click();

    await expect(page.locator('#legsSection')).toBeVisible();
    await expect(banner(page)).toBeHidden();
    expect((await readStored(page)).conflictWarnings).toEqual([]);
  });

  test('multiple conflicts render as an intro plus a list, all persisted', async ({ page }) => {
    // Every Japan proposal is english=0 and pet=0 → two flexible-mode warnings
    await fillFlexibleForm(page, ['Japan'], [ENGLISH_REQ, PET_REQ]);
    await submitBtn(page).click();

    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText(
      'Heads up — a few of your requirements are in tension with these results:'
    );
    const items = banner(page).locator('ul li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('English-speaking');
    await expect(items.nth(1)).toContainText('pet-friendly');

    const data = await readStored(page);
    expect(data.conflictWarnings).toHaveLength(2);
  });

  test('"Edit my answers" hides the banner; resubmitting brings it back', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe'], [PET_REQ]);
    await submitBtn(page).click();
    await expect(banner(page)).toBeVisible();

    await page.locator('#editAgainBtn').click();
    await expect(banner(page)).toBeHidden();
    await expect(page.locator('#intakeForm')).toBeVisible();

    await submitBtn(page).click();
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('pet-friendly');
  });

  test('switching the destination option re-evaluates leg conflicts live', async ({ page }) => {
    // Texas + "No rental car": every proposal is car-dependent, so the banner
    // starts with the single flexible-mode warning. The recommended pick
    // (single-stop Austin) has no legs; switching to Austin + San Antonio
    // creates a leg whose drive would have won → a second, leg warning.
    await fillFlexibleForm(page, ['Texas'], [NO_RENTAL_REQ]);
    await submitBtn(page).click();

    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('Limited no-rental-car options');
    await expect(banner(page).locator('ul')).toHaveCount(0);
    let data = await readStored(page);
    expect(data.conflictWarnings).toHaveLength(1);

    await page
      .locator('#destOptionsGrid .option-card[data-option-name="Austin + San Antonio"]')
      .click();

    await expect(banner(page)).toBeVisible();
    await expect(banner(page).locator('ul li')).toHaveCount(2);
    await expect(banner(page)).toContainText(
      '"No rental car" is a squeeze on the Austin → San Antonio leg'
    );
    data = await readStored(page);
    expect(data.conflictWarnings).toHaveLength(2);

    // Switching back to the single-stop pick drops the leg warning again
    await page
      .locator('#destOptionsGrid .option-card[data-option-name="Austin"]')
      .click();
    await expect(banner(page)).toBeVisible();
    await expect(banner(page).locator('ul')).toHaveCount(0);
    await expect(banner(page)).not.toContainText('squeeze');
    data = await readStored(page);
    expect(data.conflictWarnings).toHaveLength(1);
  });
});
