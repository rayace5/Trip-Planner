import { test, expect, Page } from '@playwright/test';

/**
 * Story: "As a traveler, I want a day-by-day, hour-by-hour itinerary — with
 * meals and transit notes every day, my must-see items worked in, and travel
 * days between stops shown as their own lighter entries — so I can see how
 * the trip actually flows."
 *
 * Covers the itinerary requirements: total days = total nights + 1, days
 * grouped by stop with per-day pill navigation; day 1 paced by the SELECTED
 * arrival flight (morning nonstop → fuller day, 1-stop connection → light
 * evening, afternoon nonstop → late-dinner evening start); interior days
 * shaped by trip style (relaxation rest block, cultural 3-activity days,
 * adventure outdoor-first, balanced mix) with meals anchoring every day;
 * travel days as lighter entries built from the SELECTED inter-city leg
 * option (mode verb, duration note, arrival-adjusted check-in and pacing);
 * a final departure day; honest per-city activity pools with a clearly-
 * estimated fallback for unknown cities; must-see free text parsed and
 * slotted at the matching stop (food-like items take a lunch slot), tagged
 * "(must-see pick)" and never loaded onto travel days; regeneration on
 * arrival-flight / leg / nights / destination-option changes (viewed day
 * preserved where valid, clamped when the trip shrinks, reset on fresh
 * submit); lodging clicks deliberately don't regenerate; persisted to
 * `tripPlannerIntake.itinerary`.
 *
 * Generator unit cases call the exposed pure `window.generateItinerary`.
 * UI cases use specific dates Jun 1–9, 2027 (8 nights → 4/4 across two
 * stops → 9 itinerary days, travel day = Day 5).
 */

const STORAGE_KEY = 'tripPlannerIntake';
const STOP_PLACEHOLDER = 'Add another city or country and press Enter';

type ItinEntry = {
  time: string;
  title: string;
  note: string | null;
  meal?: string;
  travel?: boolean;
  mode?: string | null;
  mustSee?: boolean;
};

type ItinDay = {
  dayNumber: number;
  date: string | null;
  stop: string;
  stopIndex: number;
  isTravelDay: boolean;
  travelFrom?: string;
  travelTo?: string;
  entries: ItinEntry[];
};

type GenConfig = {
  stops?: Array<{ name: string; nights: number }>;
  tripStyle?: string;
  startDate?: string | null;
  departingFrom?: string;
  /** Arrival flight selection by label; null omits the arrivalFlight block. */
  arrivalSelected?: string | null;
  /** Full legs array; null omits legs entirely. */
  legs?: any[] | null;
  mustSee?: string;
};

const ARRIVAL_OPTIONS = [
  { label: '1-stop budget fare', depart: '8:10am', duration: '4h35m', detail: '1 stop en route, Chicago–Austin' },
  { label: 'Nonstop morning flight', depart: '9:45am', duration: '2h50m', detail: 'Nonstop, Chicago–Austin' },
  { label: 'Nonstop afternoon flight', depart: '3:15pm', duration: '2h50m', detail: 'Nonstop, Chicago–Austin' },
];

const AUS_DAL_LEG = {
  from: 'Austin',
  to: 'Dallas',
  options: [
    { mode: 'drive', label: 'Drive (rental car)', hrs: 3.2, duration: '3h10m', detail: 'I-35 N' },
    { mode: 'train', label: 'Amtrak Texas Eagle', hrs: 5.7, duration: '5h40m', detail: 'One daily departure each way' },
    { mode: 'flight', label: 'Nonstop flight', hrs: 2.5, duration: '55m flight · ≈2h30m door-to-door', detail: 'AUS–DAL (Love Field)' },
  ],
  selected: 'Drive (rental car)',
};

/** Generic transit-hop notes the generator cycles between entries. */
const HOP_NOTES = ['15 min walk', '10 min rideshare', '5 min walk', '12 min walk', '10 min metro or rideshare'];

function submitBtn(page: Page) {
  return page.getByRole('button', { name: /Build My Trip/i });
}

function readStored(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) as string),
    STORAGE_KEY
  );
}

/** Calls the exposed pure generator with an intake-shaped object. */
function genItin(page: Page, cfg: GenConfig = {}): Promise<{ days: ItinDay[] }> {
  const full = {
    stops: cfg.stops ?? [
      { name: 'Austin', nights: 3 },
      { name: 'Dallas', nights: 4 },
    ],
    tripStyle: cfg.tripStyle ?? 'Balanced mix',
    startDate: cfg.startDate === undefined ? '2027-06-01' : cfg.startDate,
    departingFrom: cfg.departingFrom ?? 'Chicago',
    arrivalSelected: cfg.arrivalSelected === undefined ? 'Nonstop morning flight' : cfg.arrivalSelected,
    arrivalOptions: ARRIVAL_OPTIONS,
    legs: cfg.legs === undefined ? [{ ...AUS_DAL_LEG }] : cfg.legs,
    mustSee: cfg.mustSee ?? '',
  };
  return page.evaluate((c) => {
    return (window as any).generateItinerary({
      destination: { mode: 'known', stops: c.stops },
      tripStyle: c.tripStyle,
      dates: { resolved: { startDate: c.startDate } },
      departingFrom: c.departingFrom,
      arrivalFlight:
        c.arrivalSelected == null
          ? null
          : { from: c.departingFrom, to: c.stops[0].name, options: c.arrivalOptions, selected: c.arrivalSelected },
      legs: c.legs,
      mustSee: c.mustSee,
    });
  }, full);
}

function times(day: ItinDay) {
  return day.entries.map((e) => e.time);
}

function titles(day: ItinDay) {
  return day.entries.map((e) => e.title);
}

function dayPills(page: Page) {
  return page.locator('#itinDayPills .day-pill');
}

function activePill(page: Page) {
  return page.locator('#itinDayPills .day-pill.active');
}

function panelRows(page: Page) {
  return page.locator('#itinDayPanel .itin-item');
}

async function addStop(page: Page, name: string) {
  const input = page.getByPlaceholder(STOP_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
}

/**
 * Fills the whole form in known-destination mode with specific dates
 * Jun 1–9, 2027 (8 nights; nights left on auto → 4/4 for two stops).
 */
async function fillKnownForm(
  page: Page,
  stops: string[],
  opts: { style?: string; mustSee?: string } = {}
) {
  await page.getByText('Specific dates').click();
  await page.locator('#startDate').fill('2027-06-01');
  await page.locator('#endDate').fill('2027-06-09');
  await page.locator('#departingFrom').fill('Chicago');
  for (const s of stops) await addStop(page, s);
  await page.locator('#budgetAmount').fill('3000');
  await page.locator('#tripPurpose').fill('Anniversary');
  await page.locator('#whoIsGoing').fill('2 adults');
  if (opts.style) {
    await page.locator('#styleLabels span', { hasText: opts.style }).click();
  }
  if (opts.mustSee) {
    await page.locator('#mustSee').fill(opts.mustSee);
  }
}

/** Fills the form in flexible mode (general window, Apr 2027). */
async function fillFlexibleForm(page: Page, regions: string[]) {
  await page.locator('#monthChips .chip[data-month="Apr"]').click();
  await page.locator('#yearPills .pill[data-year="2027"]').click();
  await page.locator('#departingFrom').fill('Chicago');
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
// generateItinerary — day mapping and structure
// ---------------------------------------------------------------------------
test.describe('generateItinerary: day mapping', () => {
  test('a 3+4-night 2-stop trip maps to 8 days grouped by stop with one travel day', async ({ page }) => {
    const { days } = await genItin(page);

    // Total days = total nights + 1
    expect(days).toHaveLength(8);
    expect(days.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Grouped by stop: arrival + 2 interior in Austin, travel day + 3
    // interior in Dallas, departure day at the last stop
    expect(days.map((d) => d.stop)).toEqual([
      'Austin', 'Austin', 'Austin', 'Dallas', 'Dallas', 'Dallas', 'Dallas', 'Dallas',
    ]);
    expect(days.map((d) => d.stopIndex)).toEqual([0, 0, 0, 1, 1, 1, 1, 1]);
    expect(days.map((d) => d.isTravelDay)).toEqual([
      false, false, false, true, false, false, false, false,
    ]);
    // The travel day names its leg
    expect(days[3].travelFrom).toBe('Austin');
    expect(days[3].travelTo).toBe('Dallas');
    // ISO dates advance one day at a time from the resolved start date
    expect(days.map((d) => d.date)).toEqual([
      '2027-06-01', '2027-06-02', '2027-06-03', '2027-06-04',
      '2027-06-05', '2027-06-06', '2027-06-07', '2027-06-08',
    ]);
  });

  test('1-night stops produce the minimal arrival / travel / departure trip', async ({ page }) => {
    const { days } = await genItin(page, {
      stops: [
        { name: 'Austin', nights: 1 },
        { name: 'Dallas', nights: 1 },
      ],
    });
    expect(days).toHaveLength(3);
    expect(days.map((d) => d.isTravelDay)).toEqual([false, true, false]);
    expect(days.map((d) => d.stop)).toEqual(['Austin', 'Dallas', 'Dallas']);
  });

  test('a missing resolved start date yields null dates rather than fabricated ones', async ({ page }) => {
    const { days } = await genItin(page, { startDate: null });
    expect(days.length).toBeGreaterThan(0);
    for (const d of days) expect(d.date).toBeNull();
  });

  test('meals anchor every day: lunch and dinner daily, breakfast on every day after arrival', async ({ page }) => {
    const { days } = await genItin(page);
    for (const d of days) {
      const lunches = d.entries.filter((e) => e.meal === 'lunch');
      const dinners = d.entries.filter((e) => e.meal === 'dinner');
      expect(lunches, `day ${d.dayNumber} lunch`).toHaveLength(1);
      expect(lunches[0].time).toBe('1:00pm');
      expect(dinners, `day ${d.dayNumber} dinner`).toHaveLength(1);
      const breakfasts = d.entries.filter((e) => /^Breakfast/.test(e.title));
      if (d.dayNumber === 1) {
        // Arrival day starts in the air — no breakfast in the city
        expect(breakfasts).toHaveLength(0);
      } else {
        expect(breakfasts, `day ${d.dayNumber} breakfast`).toHaveLength(1);
        expect(breakfasts[0].time).toBe('9:00am');
      }
    }
  });

  test('every day stays within the 4–6 timed-entry band', async ({ page }) => {
    for (const style of ['Relaxation', 'Adventure', 'Cultural exploration', 'Balanced mix']) {
      const { days } = await genItin(page, { tripStyle: style });
      for (const d of days) {
        expect(d.entries.length, `${style} day ${d.dayNumber}`).toBeGreaterThanOrEqual(4);
        expect(d.entries.length, `${style} day ${d.dayNumber}`).toBeLessThanOrEqual(6);
      }
    }
  });

  test('the generator is deterministic for identical inputs', async ({ page }) => {
    const cfg: GenConfig = {
      tripStyle: 'Cultural exploration',
      mustSee: 'Franklin Barbecue in Austin; Dealey Plaza in Dallas',
    };
    const a = await genItin(page, cfg);
    const b = await genItin(page, cfg);
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// generateItinerary — Day 1 paced by the selected arrival flight
// ---------------------------------------------------------------------------
test.describe('generateItinerary: Day 1 follows the selected arrival flight', () => {
  test('a morning nonstop lands with usable Day-1 time: fuller day with a 4:30pm activity', async ({ page }) => {
    const { days } = await genItin(page, { arrivalSelected: 'Nonstop morning flight' });
    const day1 = days[0];
    expect(day1.entries).toHaveLength(5);
    expect(day1.entries[0].time).toBe('9:45am');
    expect(day1.entries[0].title).toBe('Fly Chicago → Austin');
    expect(day1.entries[0].note).toBe('2h50m');
    expect(times(day1)).toEqual(['9:45am', '1:00pm', '3:00pm', '4:30pm', '7:30pm']);
    expect(day1.entries[1].title).toBe('Lunch near your lodging');
    expect(day1.entries[2].title).toBe('Hotel check-in and drop bags');
    // 4:30pm slot holds a real Austin activity (Balanced pool starts with the Capitol)
    expect(day1.entries[3].title).toBe('Texas State Capitol tour');
    expect(day1.entries[4].meal).toBe('dinner');
  });

  test('a 1-stop budget fare spends the day in transit: 4 light entries, no activity', async ({ page }) => {
    const { days } = await genItin(page, { arrivalSelected: '1-stop budget fare' });
    const day1 = days[0];
    expect(day1.entries).toHaveLength(4);
    expect(day1.entries[0].time).toBe('8:10am');
    expect(day1.entries[0].title).toBe('Fly Chicago → Austin (1 stop)');
    expect(day1.entries[1].title).toBe('Lunch during your layover');
    expect(day1.entries[2].title).toBe('Land in Austin — hotel check-in');
    expect(day1.entries[2].time).toBe('4:30pm');
    expect(day1.entries[3].note).toBe('easy first night after a connecting flight');
    // No afternoon activity squeezed in around the connection
    expect(titles(day1).some((t) => t.includes('Capitol') || t.includes('stroll'))).toBe(false);
  });

  test('an afternoon nonstop starts the evening light: late dinner at 8:30pm', async ({ page }) => {
    const { days } = await genItin(page, { arrivalSelected: 'Nonstop afternoon flight' });
    const day1 = days[0];
    expect(day1.entries).toHaveLength(4);
    expect(day1.entries[0].title).toBe('Lunch before your flight');
    expect(day1.entries[0].meal).toBe('lunch');
    expect(day1.entries[1].time).toBe('3:15pm');
    expect(day1.entries[1].title).toBe('Fly Chicago → Austin');
    expect(day1.entries[2].title).toBe('Land in Austin — hotel check-in');
    const dinner = day1.entries[3];
    expect(dinner.time).toBe('8:30pm');
    expect(dinner.title).toBe('Late dinner near your lodging');
    expect(dinner.note).toBe('light evening start after an afternoon arrival');
  });
});

// ---------------------------------------------------------------------------
// generateItinerary — trip style shapes the interior days
// ---------------------------------------------------------------------------
test.describe('generateItinerary: trip style templates', () => {
  // The 1-stop arrival consumes no activities, so Day 2 starts the city pool.
  const base: GenConfig = { arrivalSelected: '1-stop budget fare' };

  test('Relaxation: one activity plus an afternoon rest block (5 entries)', async ({ page }) => {
    const { days } = await genItin(page, { ...base, tripStyle: 'Relaxation' });
    const day2 = days[1];
    expect(times(day2)).toEqual(['9:00am', '10:30am', '1:00pm', '3:00pm', '7:30pm']);
    // Stroll-first ordering for relaxation
    expect(day2.entries[1].title).toBe('South Congress stroll and shops');
    expect(day2.entries[3].title).toBe('Rest block / free time');
  });

  test('Cultural exploration: three activities, museums/historic first (6 entries)', async ({ page }) => {
    const { days } = await genItin(page, { ...base, tripStyle: 'Cultural exploration' });
    const day2 = days[1];
    expect(times(day2)).toEqual(['9:00am', '10:00am', '1:00pm', '2:30pm', '4:30pm', '7:30pm']);
    expect(day2.entries[1].title).toBe('Texas State Capitol tour');
    expect(day2.entries[3].title).toBe('Blanton Museum of Art');
    // Third slot falls through to the non-culture remainder of the pool
    expect(day2.entries[4].title).toBe('Barton Springs Pool swim');
  });

  test('Adventure: outdoor picks come first', async ({ page }) => {
    const { days } = await genItin(page, { ...base, tripStyle: 'Adventure' });
    const day2 = days[1];
    expect(times(day2)).toEqual(['9:00am', '10:00am', '1:00pm', '2:30pm', '7:30pm']);
    expect(day2.entries[1].title).toBe('Barton Springs Pool swim');
    expect(day2.entries[3].title).toBe('Lady Bird Lake trail or kayak loop');
  });

  test('Balanced mix: two activities spread through the day', async ({ page }) => {
    const { days } = await genItin(page, { ...base, tripStyle: 'Balanced mix' });
    const day2 = days[1];
    expect(times(day2)).toEqual(['9:00am', '10:00am', '1:00pm', '3:00pm', '7:30pm']);
    // Unre-ordered pool for balanced
    expect(day2.entries[1].title).toBe('Texas State Capitol tour');
    expect(day2.entries[3].title).toBe('Barton Springs Pool swim');
  });
});

// ---------------------------------------------------------------------------
// generateItinerary — travel days from the SELECTED leg option
// ---------------------------------------------------------------------------
test.describe('generateItinerary: travel days', () => {
  test('the travel day builds its transit entry from the selected drive option', async ({ page }) => {
    const { days } = await genItin(page); // Drive (rental car) selected, 3.2h
    const travel = days[3];
    expect(travel.isTravelDay).toBe(true);
    expect(travel.entries[0].title).toBe('Breakfast, pack, and check out of Austin');
    const transit = travel.entries[1];
    expect(transit.time).toBe('10:00am');
    expect(transit.title).toBe('Drive Austin → Dallas');
    expect(transit.travel).toBe(true);
    expect(transit.mode).toBe('drive');
    expect(transit.note).toContain('3h10m');
    expect(transit.note).toContain('light activity day for arrival pacing');
    // 3.2h leg: lunch en route, normal 3:00pm check-in, room for an easy look
    expect(travel.entries[2].title).toBe('Lunch en route');
    expect(travel.entries[3]).toMatchObject({ time: '3:00pm', title: 'Hotel check-in in Dallas' });
    expect(travel.entries[4]).toMatchObject({ time: '4:30pm', title: 'Easy first look around Dallas' });
    expect(travel.entries[5].meal).toBe('dinner');
  });

  test('switching the selected leg option switches the travel-day transit entry', async ({ page }) => {
    const { days } = await genItin(page, {
      legs: [{ ...AUS_DAL_LEG, selected: 'Amtrak Texas Eagle' }], // train, 5.7h
    });
    const travel = days[3];
    const transit = travel.entries[1];
    expect(transit.title).toBe('Train Austin → Dallas');
    expect(transit.mode).toBe('train');
    expect(transit.note).toContain('5h40m');
    expect(transit.note).toContain('light activity day for arrival pacing');
    // 5.7h leg: too late for the easy first look, check-in still 3:00pm (< 6h)
    expect(titles(travel).some((t) => t.startsWith('Easy first look'))).toBe(false);
    expect(travel.entries.find((e) => e.title.startsWith('Hotel check-in'))?.time).toBe('3:00pm');
  });

  test('the transit verb follows the mode: drive / train / fly / ferry', async ({ page }) => {
    const cases: Array<[string, string]> = [
      ['drive', 'Drive Austin → Dallas'],
      ['train', 'Train Austin → Dallas'],
      ['flight', 'Fly Austin → Dallas'],
      ['ferry', 'Ferry Austin → Dallas'],
    ];
    for (const [mode, title] of cases) {
      const { days } = await genItin(page, {
        legs: [{ from: 'Austin', to: 'Dallas', options: [{ mode, label: 'X', hrs: 3, duration: '3h00m' }], selected: 'X' }],
      });
      expect(days[3].entries[1].title).toBe(title);
      expect(days[3].entries[1].note).toBe('3h00m · light activity day for arrival pacing');
    }
  });

  test('a long leg (≥ 6h) pushes check-in to 5:00pm; a short one (≤ 3h) frees the afternoon', async ({ page }) => {
    const long = await genItin(page, {
      legs: [{ from: 'Austin', to: 'Dallas', options: [{ mode: 'train', label: 'Slow train', hrs: 7.5, duration: '7h30m' }], selected: 'Slow train' }],
    });
    const longTravel = long.days[3];
    expect(longTravel.entries.find((e) => e.title.startsWith('Hotel check-in'))?.time).toBe('5:00pm');
    expect(titles(longTravel).some((t) => t.startsWith('Easy first look'))).toBe(false);

    const short = await genItin(page, {
      legs: [{ from: 'Austin', to: 'Dallas', options: [{ mode: 'train', label: 'Quick train', hrs: 2.8, duration: '2h45m' }], selected: 'Quick train' }],
    });
    const shortTravel = short.days[3];
    const lunch = shortTravel.entries.find((e) => e.meal === 'lunch') as ItinEntry;
    expect(lunch.title).toBe('Lunch in Dallas');
    expect(lunch.note).toBe('you arrive with the afternoon free');
    expect(titles(shortTravel).some((t) => t.startsWith('Easy first look'))).toBe(true);
  });

  test('a leg with no data falls back to an honest generic transit entry', async ({ page }) => {
    const { days } = await genItin(page, { legs: [] });
    const transit = days[3].entries[1];
    expect(transit.title).toBe('Travel Austin → Dallas');
    expect(transit.travel).toBe(true);
    expect(transit.note).toBe('transit day · light activity day for arrival pacing');
  });
});

// ---------------------------------------------------------------------------
// generateItinerary — final departure day
// ---------------------------------------------------------------------------
test.describe('generateItinerary: final day', () => {
  test('the last day checks out at noon and heads to the airport for the flight home', async ({ page }) => {
    const { days } = await genItin(page);
    const last = days[days.length - 1];
    expect(last.dayNumber).toBe(8);
    expect(last.stop).toBe('Dallas');
    expect(last.isTravelDay).toBe(false);
    expect(times(last)).toEqual(['9:00am', '10:00am', '12:00pm', '1:00pm', '4:00pm', '7:30pm']);
    expect(last.entries[2].title).toBe('Check out and store your bags');
    const lunch = last.entries[3];
    expect(lunch.meal).toBe('lunch');
    expect(lunch.note).toBe('one last meal in Dallas');
    expect(last.entries[4].title).toBe('Head to the airport — evening flight home');
    expect(last.entries[5].title).toBe('Dinner at the airport before your flight');
    expect(last.entries[5].meal).toBe('dinner');
  });
});

// ---------------------------------------------------------------------------
// generateItinerary — activity pools: known vs unknown cities
// ---------------------------------------------------------------------------
test.describe('generateItinerary: activity honesty', () => {
  test('known cities draw real activities with generic hop notes between entries', async ({ page }) => {
    const { days } = await genItin(page);
    const day2 = days[1]; // Balanced Austin interior day
    // The morning-arrival Day 1 already consumed the pool's first pick
    // (the Capitol tour), so Day 2 continues from the second
    expect(day2.entries[1].title).toBe('Barton Springs Pool swim');
    expect(HOP_NOTES).toContain(day2.entries[1].note as string);
    expect(HOP_NOTES).toContain(day2.entries[4].note as string); // dinner hop note
  });

  test('unknown cities fall back to generic activities with the honesty note', async ({ page }) => {
    const { days } = await genItin(page, {
      stops: [{ name: 'Springfield', nights: 2 }],
      legs: [],
    });
    // Single stop: 3 days, no travel days at all
    expect(days).toHaveLength(3);
    expect(days.every((d) => !d.isTravelDay)).toBe(true);
    const genericTitles = [
      'Explore the old town / central district',
      'Local market visit',
      'Top local museum or gallery',
      'City park or waterfront walk',
      'Main square and landmark viewpoint',
      'Free time to explore at your own pace',
    ];
    const day2 = days[1];
    expect(genericTitles).toContain(day2.entries[1].title);
    expect(day2.entries[1].note).toBe(
      "a rough suggestion — we don't have Springfield activities on file"
    );
  });
});

// ---------------------------------------------------------------------------
// generateItinerary — must-see items
// ---------------------------------------------------------------------------
test.describe('generateItinerary: must-see slotting', () => {
  test('items are split on commas/semicolons and land at their matching stop', async ({ page }) => {
    const { days } = await genItin(page, {
      mustSee: 'Franklin Barbecue in Austin; Dealey Plaza in Dallas',
    });
    // Food-like Austin item takes an Austin lunch slot (Day 1 lunch first)
    const lunch = days[0].entries.find((e) => e.meal === 'lunch') as ItinEntry;
    expect(lunch.title).toBe('Lunch — Franklin Barbecue in Austin (must-see pick)');
    expect(lunch.mustSee).toBe(true);
    // Non-food Dallas item replaces the first free activity slot at the
    // Dallas stop (Day 5, the first non-travel Dallas day)
    const day5 = days[4];
    expect(day5.stop).toBe('Dallas');
    expect(day5.entries[1].title).toBe('Dealey Plaza in Dallas (must-see pick)');
    expect(day5.entries[1].mustSee).toBe(true);
    // Nothing must-see lands on the travel day
    for (const e of days[3].entries) expect(e.mustSee).toBeUndefined();
  });

  test('unmatched items are spread across the trip exactly once, never on a travel day', async ({ page }) => {
    const { days } = await genItin(page, { mustSee: 'Sunset drone photography' });
    const tagged: Array<{ day: ItinDay; entry: ItinEntry }> = [];
    for (const d of days) {
      for (const e of d.entries) {
        if (e.mustSee) tagged.push({ day: d, entry: e });
      }
    }
    expect(tagged).toHaveLength(1);
    expect(tagged[0].entry.title).toBe('Sunset drone photography (must-see pick)');
    expect(tagged[0].day.isTravelDay).toBe(false);
  });

  test('an empty must-see field adds no tagged entries', async ({ page }) => {
    const { days } = await genItin(page, { mustSee: '   ' });
    for (const d of days) {
      for (const e of d.entries) {
        expect(e.mustSee).toBeUndefined();
        expect(e.title).not.toContain('(must-see pick)');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// UI — pills + panel on the results page (known mode, Jun 1–9 2027 → 9 days)
// ---------------------------------------------------------------------------
test.describe('Itinerary section in the results view', () => {
  test('day pills render one per day, grouped by stop, starting on Day 1', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await expect(page.locator('#itinerarySection')).toBeVisible();
    await expect(dayPills(page)).toHaveCount(9);
    await expect(dayPills(page).nth(0)).toHaveText('Day 1 · Austin');
    await expect(dayPills(page).nth(3)).toHaveText('Day 4 · Austin');
    await expect(dayPills(page).nth(4)).toHaveText('Day 5 · Travel');
    await expect(dayPills(page).nth(4)).toHaveAttribute('data-itin-travel-day', 'true');
    await expect(dayPills(page).nth(4)).toHaveAttribute('data-itin-day-stop', 'Dallas');
    await expect(dayPills(page).nth(8)).toHaveText('Day 9 · Dallas');

    // Day 1 opens by default: heading, date line, and hour-by-hour rows
    await expect(activePill(page)).toHaveAttribute('data-itin-day-index', '0');
    await expect(page.locator('#itinDayPanel .stop-heading')).toContainText('Austin — Day 1');
    await expect(page.locator('#itinDayPanel .itin-date')).toHaveText('Jun 1, 2027');
    await expect(page.locator('#itinDayPanel .itin-card')).toHaveAttribute('data-itin-day-number', '1');
    await expect(panelRows(page)).toHaveCount(5); // morning nonstop is the default pick
    await expect(panelRows(page).first().locator('.itin-time')).toHaveText('9:45am');
    await expect(panelRows(page).first().locator('.itin-title')).toHaveText('Fly Chicago → Austin');
  });

  test('clicking the travel-day pill shows the lighter travel day with the selected leg\'s amber transit row', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await dayPills(page).nth(4).click();
    await expect(activePill(page)).toHaveText('Day 5 · Travel');
    await expect(page.locator('#itinDayPanel .stop-heading')).toContainText('Day 5 — Travel to Dallas');
    // Exactly one amber transit row, built from the recommended (= selected) drive
    const amber = page.locator('#itinDayPanel .itin-item.travel-day-item');
    await expect(amber).toHaveCount(1);
    await expect(amber.locator('.itin-title')).toHaveText('Drive Austin → Dallas');
    await expect(amber.locator('.itin-note')).toContainText('3h10m');
    await expect(amber.locator('.itin-note')).toContainText('light activity day for arrival pacing');
  });

  test('picking a different arrival flight re-paces Day 1 in place', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await expect(panelRows(page)).toHaveCount(5);
    await page
      .locator('#arrivalContainer .option-card[data-flight-option-label="1-stop budget fare"]')
      .click();

    // Still viewing Day 1, now with the light connection pacing
    await expect(activePill(page)).toHaveAttribute('data-itin-day-index', '0');
    await expect(panelRows(page)).toHaveCount(4);
    await expect(panelRows(page).first().locator('.itin-title')).toHaveText('Fly Chicago → Austin (1 stop)');

    const data = await readStored(page);
    expect(data.itinerary.days[0].entries).toHaveLength(4);
  });

  test('picking a different leg option updates the travel day and keeps it in view', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await dayPills(page).nth(4).click();
    await page
      .locator('#legsContainer .option-card[data-leg-option-label="Amtrak Texas Eagle"]')
      .click();

    // The viewed day survived the regeneration and reflects the new mode
    await expect(activePill(page)).toHaveText('Day 5 · Travel');
    const amber = page.locator('#itinDayPanel .itin-item.travel-day-item');
    await expect(amber.locator('.itin-title')).toHaveText('Train Austin → Dallas');
    await expect(amber.locator('.itin-note')).toContainText('5h40m');

    const data = await readStored(page);
    const transit = data.itinerary.days[4].entries.find((e: any) => e.travel);
    expect(transit.title).toBe('Train Austin → Dallas');
    expect(transit.mode).toBe('train');
  });

  test('editing nights regenerates the day count while preserving the viewed day', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await dayPills(page).nth(2).click();
    await page.getByRole('button', { name: 'Increase nights in Austin' }).click();

    await expect(dayPills(page)).toHaveCount(10);
    await expect(activePill(page)).toHaveAttribute('data-itin-day-index', '2');
    const data = await readStored(page);
    expect(data.itinerary.days).toHaveLength(10);
    expect(data.itinerary.days[5].isTravelDay).toBe(true); // travel day moved to Day 6
  });

  test('shrinking the trip clamps a now-invalid viewed day to the last day', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await dayPills(page).nth(8).click(); // view Day 9 (the last day)
    await page.getByRole('button', { name: 'Decrease nights in Austin' }).click();

    await expect(dayPills(page)).toHaveCount(8);
    await expect(activePill(page)).toHaveAttribute('data-itin-day-index', '7');
    await expect(activePill(page)).toHaveText('Day 8 · Dallas');
  });

  test('lodging clicks deliberately do not touch the itinerary', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await dayPills(page).nth(2).click();
    const before = await readStored(page);

    await page
      .locator('#lodgingContainer .leg-block')
      .first()
      .locator('.option-card:not(.selected)')
      .first()
      .click();

    const after = await readStored(page);
    expect(after.itinerary).toEqual(before.itinerary);
    // The panel didn't re-render away from the viewed day either
    await expect(activePill(page)).toHaveAttribute('data-itin-day-index', '2');
  });

  test('"Edit my answers" hides the itinerary; resubmitting starts back on Day 1', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    await dayPills(page).nth(3).click();
    await page.locator('#editAgainBtn').click();
    await expect(page.locator('#itinerarySection')).toBeHidden();
    await expect(page.locator('#intakeForm')).toBeVisible();

    await submitBtn(page).click();
    await expect(page.locator('#itinerarySection')).toBeVisible();
    await expect(activePill(page)).toHaveAttribute('data-itin-day-index', '0');
    await expect(page.locator('#itinDayPanel .stop-heading')).toContainText('Austin — Day 1');
  });

  test('the itinerary is persisted with the full day/entry shape', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas']);
    await submitBtn(page).click();

    const data = await readStored(page);
    const days = data.itinerary.days;
    expect(days).toHaveLength(9);
    days.forEach((d: any, i: number) => {
      expect(d.dayNumber).toBe(i + 1);
      expect(typeof d.stop).toBe('string');
      expect(typeof d.stopIndex).toBe('number');
      expect(typeof d.isTravelDay).toBe('boolean');
      expect(Array.isArray(d.entries)).toBe(true);
      for (const e of d.entries) {
        expect(typeof e.time).toBe('string');
        expect(typeof e.title).toBe('string');
      }
    });
    // Dates run Jun 1 → Jun 9, 2027
    expect(days[0].date).toBe('2027-06-01');
    expect(days[8].date).toBe('2027-06-09');
    expect(days.filter((d: any) => d.isTravelDay)).toHaveLength(1);
  });

  test('must-see items typed into the form show up tagged in the itinerary', async ({ page }) => {
    await fillKnownForm(page, ['Austin', 'Dallas'], {
      mustSee: 'Franklin Barbecue in Austin, Dealey Plaza in Dallas',
    });
    await submitBtn(page).click();

    // Day 1's lunch became the Austin food pick, visible in the panel
    await expect(
      page.locator('#itinDayPanel .itin-title', { hasText: 'Franklin Barbecue in Austin (must-see pick)' })
    ).toBeVisible();

    const data = await readStored(page);
    const tagged = data.itinerary.days.flatMap((d: any) =>
      d.entries.filter((e: any) => e.mustSee).map((e: any) => ({ stop: d.stop, travel: d.isTravelDay, title: e.title }))
    );
    expect(tagged.some((t: any) => t.stop === 'Austin' && t.title.includes('Franklin Barbecue'))).toBe(true);
    expect(tagged.some((t: any) => t.stop === 'Dallas' && t.title.includes('Dealey Plaza'))).toBe(true);
    expect(tagged.every((t: any) => !t.travel)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UI — flexible mode: the itinerary follows the selected destination option
// ---------------------------------------------------------------------------
test.describe('Itinerary in flexible-destination mode', () => {
  test('switching the destination option rebuilds the itinerary for the new route, preserving the viewed day', async ({ page }) => {
    await fillFlexibleForm(page, ['Europe']);
    await submitBtn(page).click();

    let data = await readStored(page);
    let stops = data.destination.selectedOption.stops as Array<{ name: string; nights: number }>;
    const totalNights = (s: typeof stops) => s.reduce((sum, x) => sum + x.nights, 0);
    expect(data.itinerary.days).toHaveLength(totalNights(stops) + 1);
    expect(data.itinerary.days[0].stop).toBe(stops[0].name);
    expect(data.itinerary.days.filter((d: any) => d.isTravelDay)).toHaveLength(stops.length - 1);
    await expect(dayPills(page)).toHaveCount(totalNights(stops) + 1);

    // View Day 3, then switch options: the route (and itinerary) rebuild
    await dayPills(page).nth(2).click();
    const otherCard = page.locator('#destOptionsGrid .option-card:not(.selected)').first();
    const otherName = await otherCard.getAttribute('data-option-name');
    await otherCard.click();

    data = await readStored(page);
    expect(data.destination.selectedOption.name).toBe(otherName);
    stops = data.destination.selectedOption.stops;
    expect(data.itinerary.days).toHaveLength(totalNights(stops) + 1);
    expect(data.itinerary.days[0].stop).toBe(stops[0].name);
    expect(
      data.itinerary.days[data.itinerary.days.length - 1].stop
    ).toBe(stops[stops.length - 1].name);
    expect(data.itinerary.days.filter((d: any) => d.isTravelDay)).toHaveLength(stops.length - 1);
    await expect(dayPills(page)).toHaveCount(totalNights(stops) + 1);
    // The viewed day survived the switch (Day 3 is still valid)
    await expect(activePill(page)).toHaveAttribute('data-itin-day-index', '2');
  });
});
