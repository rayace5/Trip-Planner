import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler, I want 2–3 arrival flight options (origin → first
 * stop) with a clear recommended pick and stated trade-offs so I can choose
 * how to start my trip."
 *
 * Covers the arrival-flight requirements: for the LEG 1 route (departure city
 * → first stop of the active route) the planner offers 3 options — a 1-stop
 * budget fare, a nonstop morning flight, and a nonstop afternoon flight —
 * each with departure time, duration, per-person round-trip price, and a
 * trade-off; exactly one (the morning nonstop) is Recommended with a stated
 * reason. Prices come from coarse haul tiers (same-region short, NA↔Latin
 * medium, NA↔Europe long, NA↔Japan ultra) with unknown origin/destination
 * pairs falling back to a clearly-"estimated" profile; the persisted group
 * price scales with the traveler count parsed from "Who's going". The UI
 * renders the block as "LEG 1 · <ORIGIN> → <STOP> (ARRIVAL)" above the
 * inter-city legs (which still start at LEG 2), pre-selects the recommended
 * card, persists the selection to `tripPlannerIntake.arrivalFlight`
 * immediately on click, renders for single-stop trips (their only leg
 * section), follows the selected destination option's first stop in flexible
 * mode (keeping the selection when the origin → first-stop pair survives an
 * option switch), and hides on "Edit my answers".
 *
 * Generator unit cases call the exposed pure `window.generateArrivalFlights`.
 * UI cases use specific dates Jun 1–9, 2027 so allocations are deterministic.
 */

const STORAGE_KEY = 'tripPlannerIntake';
const STOP_PLACEHOLDER = 'Add another city or country and press Enter';

const BUDGET_LABEL = '1-stop budget fare';
const MORNING_LABEL = 'Nonstop morning flight';
const AFTERNOON_LABEL = 'Nonstop afternoon flight';
const REC_REASON = 'Best balance — nonstop and lands with most of Day 1 still usable';
const ESTIMATED_SUFFIX = '(times and prices are rough estimates for this route)';

type FlightOption = {
  label: string;
  depart: string;
  duration: string;
  detail: string;
  pricePerPerson: number;
  priceGroup: number;
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
function genArrival(
  page: Page,
  from: string,
  to: string,
  whoIsGoing = '2 adults'
): Promise<FlightOption[]> {
  return page.evaluate(
    ([f, t, w]) =>
      (window as any).generateArrivalFlights(f, t, {
        travelers: { whoIsGoing: w },
      }),
    [from, to, whoIsGoing] as const
  );
}

function recommendedOf(options: FlightOption[]) {
  const recs = options.filter((o) => o.recommended);
  expect(recs).toHaveLength(1);
  return recs[0];
}

function arrivalBlock(page: Page) {
  return page.locator('#arrivalContainer .leg-block');
}

function arrivalCards(page: Page) {
  return arrivalBlock(page).locator('.option-card');
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
  departingFrom: string,
  stops: string[],
  opts: { whoIsGoing?: string } = {}
) {
  await page.getByText('Specific dates').click();
  await page.locator('#startDate').fill('2027-06-01');
  await page.locator('#endDate').fill('2027-06-09');
  await page.locator('#departingFrom').fill(departingFrom);
  for (const s of stops) await addStop(page, s);
  await page.locator('#budgetAmount').fill('3000');
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
// generateArrivalFlights — option shape and the recommended pick
// ---------------------------------------------------------------------------
test.describe('generateArrivalFlights: options and recommendation', () => {
  test('always offers 3 options with times, durations, prices, and trade-offs', async ({ page }) => {
    const options = await genArrival(page, 'Chicago', 'Austin');

    expect(options).toHaveLength(3);
    expect(options.map((o) => o.label)).toEqual([
      BUDGET_LABEL,
      MORNING_LABEL,
      AFTERNOON_LABEL,
    ]);
    expect(options.map((o) => o.depart)).toEqual(['8:10am', '9:45am', '3:15pm']);
    // Every option carries the full decision-making payload
    for (const o of options) {
      expect(o.duration).toBeTruthy();
      expect(o.tradeoff).toBeTruthy();
      expect(o.pricePerPerson).toBeGreaterThan(0);
      expect(o.priceGroup).toBeGreaterThan(0);
      expect(o.detail).toContain('Chicago–Austin');
      expect(o.estimated).toBe(false);
    }
    // The connection is slower than the nonstops, and the trade-offs say why
    // you'd pick or skip each option
    expect(options[0].detail).toContain('1 stop en route');
    expect(options[0].tradeoff).toContain('connection adds time');
    expect(options[2].tradeoff).toContain('eats into Day 1');
  });

  test('exactly one option — the morning nonstop — is recommended, with the stated reason', async ({ page }) => {
    const options = await genArrival(page, 'Chicago', 'Austin');

    const rec = recommendedOf(options);
    expect(rec.label).toBe(MORNING_LABEL);
    expect(rec.recommendedReason).toBe(REC_REASON);
    expect(options.filter((o) => o.recommendedReason !== null)).toHaveLength(1);
  });

  test('the generator is deterministic and accepts {name} stop objects', async ({ page }) => {
    const a = await genArrival(page, 'Chicago', 'Austin');
    const b = await genArrival(page, 'Chicago', 'Austin');
    expect(b).toEqual(a);

    const asObjects = await page.evaluate(() =>
      (window as any).generateArrivalFlights(
        { name: 'Chicago' },
        { name: 'Austin' },
        { travelers: { whoIsGoing: '2 adults' } }
      )
    );
    expect(asObjects).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// generateArrivalFlights — haul-tier pricing
// ---------------------------------------------------------------------------
test.describe('generateArrivalFlights: haul tiers set prices and durations', () => {
  test('same-region Chicago → Austin is a short haul ($310/$380/$410 per person)', async ({ page }) => {
    const options = await genArrival(page, 'Chicago', 'Austin');
    expect(options.map((o) => o.pricePerPerson)).toEqual([310, 380, 410]);
    expect(options[0].duration).toBe('4h35m'); // connection
    expect(options[1].duration).toBe('2h50m'); // nonstop
    expect(recommendedOf(options).pricePerPerson).toBe(380);
  });

  test('Chicago → Cancun is a medium haul ($430/$495/$545 per person)', async ({ page }) => {
    const options = await genArrival(page, 'Chicago', 'Cancun');
    expect(options.map((o) => o.pricePerPerson)).toEqual([430, 495, 545]);
    expect(options.every((o) => !o.estimated)).toBe(true);
  });

  test('Chicago → Paris is a long haul ($780/$895/$965 per person)', async ({ page }) => {
    const options = await genArrival(page, 'Chicago', 'Paris');
    expect(options.map((o) => o.pricePerPerson)).toEqual([780, 895, 965]);
    expect(recommendedOf(options).pricePerPerson).toBe(895);
  });

  test('Chicago → Tokyo is an ultra-long haul ($1160/$1345/$1440 per person)', async ({ page }) => {
    const options = await genArrival(page, 'Chicago', 'Tokyo');
    expect(options.map((o) => o.pricePerPerson)).toEqual([1160, 1345, 1440]);
    expect(options[1].duration).toBe('13h40m');
  });

  test('the haul tier is direction-insensitive: Paris → Chicago prices match Chicago → Paris', async ({ page }) => {
    const outbound = await genArrival(page, 'Chicago', 'Paris');
    const inbound = await genArrival(page, 'Paris', 'Chicago');
    expect(inbound.map((o) => o.pricePerPerson)).toEqual(
      outbound.map((o) => o.pricePerPerson)
    );
  });
});

// ---------------------------------------------------------------------------
// generateArrivalFlights — unknown routes (estimated fallback)
// ---------------------------------------------------------------------------
test.describe('generateArrivalFlights: unknown origin/destination pairs', () => {
  test('an unknown pair still yields 3 options, all clearly marked estimated', async ({ page }) => {
    const options = await genArrival(page, 'Springfield', 'Shelbyville');

    expect(options).toHaveLength(3);
    expect(options.every((o) => o.estimated)).toBe(true);
    expect(options.map((o) => o.pricePerPerson)).toEqual([420, 490, 530]);
    // "Estimated" wording is visible in the option copy itself
    for (const o of options) expect(o.duration).toContain('estimated');

    const rec = recommendedOf(options);
    expect(rec.label).toBe(MORNING_LABEL);
    expect(rec.recommendedReason).toBe(`${REC_REASON} ${ESTIMATED_SUFFIX}`);
  });

  test('a known pair never carries the estimated disclaimer', async ({ page }) => {
    const options = await genArrival(page, 'Chicago', 'Paris');
    expect(options.every((o) => !o.estimated)).toBe(true);
    expect(recommendedOf(options).recommendedReason).not.toContain('estimate');
  });
});

// ---------------------------------------------------------------------------
// generateArrivalFlights — group price scales with the traveler count
// ---------------------------------------------------------------------------
test.describe('generateArrivalFlights: group pricing', () => {
  test('priceGroup is the per-person round-trip fare times the parsed group size', async ({ page }) => {
    const four = await genArrival(page, 'Chicago', 'Paris', '4 adults');
    for (const o of four) expect(o.priceGroup).toBe(o.pricePerPerson * 4);

    const solo = await genArrival(page, 'Chicago', 'Paris', 'solo');
    for (const o of solo) expect(o.priceGroup).toBe(o.pricePerPerson);

    // A blank answer assumes a couple (2 travelers)
    const blank = await genArrival(page, 'Chicago', 'Paris', '');
    for (const o of blank) expect(o.priceGroup).toBe(o.pricePerPerson * 2);
  });

  test('the traveler count never changes the per-person fares themselves', async ({ page }) => {
    const four = await genArrival(page, 'Chicago', 'Paris', '4 adults');
    const solo = await genArrival(page, 'Chicago', 'Paris', 'solo');
    expect(four.map((o) => o.pricePerPerson)).toEqual(
      solo.map((o) => o.pricePerPerson)
    );
  });
});

// ---------------------------------------------------------------------------
// UI — the arrival block on the results page (known mode)
// ---------------------------------------------------------------------------
test.describe('Arrival flight block in the results view', () => {
  test('renders as LEG 1 above the inter-city legs, which still start at LEG 2', async ({ page }) => {
    await fillKnownForm(page, 'Chicago', ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await expect(page.locator('#arrivalSection')).toBeVisible();
    await expect(arrivalBlock(page)).toHaveCount(1);
    await expect(arrivalBlock(page).locator('.leg-label')).toHaveText(
      'LEG 1 · CHICAGO → AUSTIN (ARRIVAL)'
    );
    await expect(arrivalBlock(page)).toHaveAttribute('data-arrival-from', 'Chicago');
    await expect(arrivalBlock(page)).toHaveAttribute('data-arrival-to', 'Austin');
    await expect(arrivalBlock(page).locator('h2')).toHaveText('Flight options');
    await expect(arrivalCards(page)).toHaveCount(3);

    // Inter-city legs keep their numbering (LEG 1 is the arrival)
    await expect(
      page.locator('#legsContainer .leg-block .leg-label').first()
    ).toHaveText('LEG 2 · AUSTIN → DALLAS (INTER-CITY)');
    // ...and the arrival section sits above them in the document
    const arrivalAboveLegs = await page.evaluate(() => {
      const arrival = document.getElementById('arrivalSection') as HTMLElement;
      const legs = document.getElementById('legsSection') as HTMLElement;
      return !!(arrival.compareDocumentPosition(legs) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(arrivalAboveLegs).toBe(true);
  });

  test('the recommended card is badged, pre-selected, and priced per person round trip', async ({ page }) => {
    await fillKnownForm(page, 'Chicago', ['Austin', 'Dallas']);
    await submitBtn(page).click();

    const badged = arrivalCards(page).filter({ has: page.locator('.rec-badge') });
    await expect(badged).toHaveCount(1);
    await expect(badged).toHaveClass(/selected/);
    await expect(badged).toHaveAttribute('data-flight-option-label', MORNING_LABEL);
    await expect(badged.locator('.price')).toHaveText('$380 per person · round trip');
    await expect(badged.locator('.detail')).toHaveText(
      'Depart 9:45am · 2h50m · Nonstop, Chicago–Austin'
    );
    await expect(badged.locator('.tradeoff.rec')).toHaveText(REC_REASON);
    // Every card states its trade-off
    for (let i = 0; i < 3; i++) {
      await expect(
        arrivalCards(page).nth(i).locator('.tradeoff').first()
      ).not.toBeEmpty();
    }
  });

  test('the arrival flight is persisted at submit with the recommended option selected', async ({ page }) => {
    await fillKnownForm(page, 'Chicago', ['Austin', 'Dallas'], {
      whoIsGoing: '4 adults',
    });
    await submitBtn(page).click();

    const data = await readStored(page);
    expect(data.arrivalFlight.from).toBe('Chicago');
    expect(data.arrivalFlight.to).toBe('Austin');
    expect(data.arrivalFlight.travelers).toBe(4);
    expect(data.arrivalFlight.options).toHaveLength(3);
    expect(data.arrivalFlight.selected).toBe(MORNING_LABEL);
    const rec = data.arrivalFlight.options.filter((o: any) => o.recommended);
    expect(rec).toHaveLength(1);
    expect(rec[0].label).toBe(MORNING_LABEL);
    expect(rec[0].priceGroup).toBe(380 * 4); // group total for the budget rollup
  });

  test('clicking another card moves the selection and persists it immediately', async ({ page }) => {
    await fillKnownForm(page, 'Chicago', ['Austin', 'Dallas']);
    await submitBtn(page).click();

    const before = await readStored(page);
    const legSelected = before.legs[0].selected;

    await arrivalCards(page).filter({ hasText: BUDGET_LABEL }).click();

    await expect(
      arrivalCards(page).filter({ hasText: BUDGET_LABEL })
    ).toHaveClass(/selected/);
    await expect(arrivalBlock(page).locator('.option-card.selected')).toHaveCount(1);

    // Persisted immediately, no resubmit needed; the inter-city leg
    // selection is untouched
    const after = await readStored(page);
    expect(after.arrivalFlight.selected).toBe(BUDGET_LABEL);
    expect(after.legs[0].selected).toBe(legSelected);
  });

  test('a single-stop trip still gets its arrival flight — the only leg section', async ({ page }) => {
    await fillKnownForm(page, 'Chicago', ['Tokyo']);
    await submitBtn(page).click();

    await expect(page.locator('#arrivalSection')).toBeVisible();
    await expect(arrivalBlock(page).locator('.leg-label')).toHaveText(
      'LEG 1 · CHICAGO → TOKYO (ARRIVAL)'
    );
    await expect(arrivalCards(page)).toHaveCount(3);
    // No inter-city legs for a single stop
    await expect(page.locator('#legsSection')).toBeHidden();

    const data = await readStored(page);
    expect(data.legs).toEqual([]);
    expect(data.arrivalFlight.to).toBe('Tokyo');
    // NA → Japan is the ultra-long-haul tier
    expect(
      data.arrivalFlight.options.map((o: any) => o.pricePerPerson)
    ).toEqual([1160, 1345, 1440]);
  });

  test('"Edit my answers" hides the arrival section', async ({ page }) => {
    await fillKnownForm(page, 'Chicago', ['Austin', 'Dallas']);
    await submitBtn(page).click();
    await expect(page.locator('#arrivalSection')).toBeVisible();

    await page.locator('#editAgainBtn').click();
    await expect(page.locator('#arrivalSection')).toBeHidden();
    await expect(page.locator('#intakeForm')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// UI — flexible mode: the arrival leg follows the selected option
// ---------------------------------------------------------------------------
test.describe('Arrival flight in flexible-destination mode', () => {
  test('targets the selected option\'s first stop; rebuilds on option switch, keeping the selection when the pair survives', async ({ page }) => {
    // The Japan catalog proposes "Tokyo + Kyoto", "Tokyo", and
    // "Kyoto + Osaka" — two options share the first stop (Tokyo) and one
    // differs (Kyoto), which exercises both rebuild behaviors.
    await fillFlexibleForm(page, ['Japan']);
    await submitBtn(page).click();

    let data = await readStored(page);
    const options: Array<{ name: string; stops: Array<{ name: string }> }> =
      data.destination.options;
    const firstStopOf = (o: { stops: Array<{ name: string }> }) => o.stops[0].name;
    const selected = options.find(
      (o) => o.name === data.destination.selectedOption.name
    )!;
    const sameFirst = options.find(
      (o) => o.name !== selected.name && firstStopOf(o) === firstStopOf(selected)
    );
    const diffFirst = options.find(
      (o) => firstStopOf(o) !== firstStopOf(selected)
    );
    expect(sameFirst).toBeTruthy();
    expect(diffFirst).toBeTruthy();

    // The arrival leg targets the selected option's first stop
    expect(data.arrivalFlight.from).toBe('Austin');
    expect(data.arrivalFlight.to).toBe(firstStopOf(selected));
    await expect(arrivalBlock(page).locator('.leg-label')).toHaveText(
      `LEG 1 · AUSTIN → ${firstStopOf(selected).toUpperCase()} (ARRIVAL)`
    );

    // Pick a non-recommended flight, then switch to the option that keeps
    // the same first stop: the flight selection survives the rebuild
    await arrivalCards(page).filter({ hasText: BUDGET_LABEL }).click();
    await page
      .locator(`#destOptionsGrid .option-card[data-option-name="${sameFirst!.name}"]`)
      .click();

    data = await readStored(page);
    expect(data.arrivalFlight.to).toBe(firstStopOf(sameFirst!));
    expect(data.arrivalFlight.selected).toBe(BUDGET_LABEL);
    await expect(
      arrivalCards(page).filter({ hasText: BUDGET_LABEL })
    ).toHaveClass(/selected/);

    // Switch to the option with a different first stop: the arrival leg is
    // rebuilt for the new route and the selection resets to the recommended
    await page
      .locator(`#destOptionsGrid .option-card[data-option-name="${diffFirst!.name}"]`)
      .click();

    data = await readStored(page);
    expect(data.arrivalFlight.to).toBe(firstStopOf(diffFirst!));
    expect(data.arrivalFlight.selected).toBe(MORNING_LABEL);
    await expect(arrivalBlock(page).locator('.leg-label')).toHaveText(
      `LEG 1 · AUSTIN → ${firstStopOf(diffFirst!).toUpperCase()} (ARRIVAL)`
    );
    await expect(
      arrivalCards(page).filter({ hasText: MORNING_LABEL })
    ).toHaveClass(/selected/);
  });
});
