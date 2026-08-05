# Trip Planner — Product Requirements Document

## Overview

A single-page web app that takes a traveler's trip preferences through an intake form and produces a complete, bookable trip plan — destination options (if flexible), flight options, lodging options, a day-by-day itinerary, advance-booking flags, and an itemized budget. Trips may span a single destination or **multiple cities/countries in one itinerary** (e.g., Austin + Dallas, or London + Paris + Amsterdam). Selections the user makes (flight, lodging, destination, or per-stop choices on a multi-city trip) update the itinerary and budget live, in the same view. Built as a static HTML/JS/CSS app, deployed for a persistent, reopenable URL.

**Hosting:** GitHub Pages, via a GitHub connector/MCP in Claude Code, is the primary hosting target for this build — if that connector is available in the Claude Code environment. Netlify (as specified in the project's default instructions) is the fallback if no GitHub connector is available. Whichever is used, the requirement is the same: a persistent, reopenable URL, no regeneration needed on revisit.

This PRD covers building the app in Claude Code, based on the UX wireframe and Airbnb-style visual mockup already approved in this project.

---

## Problem Statement

Planning a genuinely good trip requires juggling five to seven interdependent decisions (dates, destination, flights, lodging, activities, budget) across a dozen browser tabs, and most travelers either under-research (missing sold-out bookings, bad pacing) or spend many hours doing it themselves. This tool collapses that research into one guided form and one interactive results view, producing a plan detailed enough to book from directly — without the user doing their own research afterward.

---

## Goals

1. A user can go from a filled-out intake form to a complete, itemized trip plan (flights, lodging, itinerary, budget) in a single session with no additional research required.
2. Changing a flight, lodging, or destination selection updates the itinerary and budget in place, with no page reload and no re-planning delay.
3. Every advance-booking-required item (timed entry, sold-out-risk restaurants, transport passes) is flagged with a direct purchase link, not just mentioned.
4. The budget rollup is accurate enough (itemized, not a single estimate) that the user trusts it against their stated budget, including a clear over/under flag.
5. The finished plan is reachable via a persistent URL the user can reopen later without regenerating anything.

---

## Non-Goals

1. **User accounts / saved trip history** — out of scope for v1. One session is sufficient per the project's stated requirement; no login, no multi-trip dashboard.
2. **Real-time booking/checkout inside the app** — the app links out to booking sources (airline sites, hotels.com, Viator, etc.); it does not process payments or hold reservations itself.
3. **Live flight/hotel pricing APIs** — v1 uses researched-and-static options (via web search / connected MCPs at planning time), not a live pricing engine the user can re-query inside the deployed page. Prices shown are accurate as of research time, not live.
4. **Unbounded/open-ended multi-city routing** — v1 supports a user-specified, ordered list of stops (e.g., Austin → Dallas, or London → Paris → Amsterdam) with per-stop night allocation. It does not auto-generate an optimal route from a loose list of "places I might want to see" or auto-suggest additional stops the user didn't name — that's a future consideration (see P2).
5. **Collaborative/shared planning (multiple users editing one trip)** — v1 is single-user, single-session; no sharing/commenting/co-editing.

---

## User Stories

**Primary traveler (form submitter)**
- As a traveler, I want to enter my dates, budget, and preferences once so that I don't have to repeat myself across multiple tools.
- As a traveler with flexible dates, I want to select multiple candidate months and a year so that the plan can find the best window rather than forcing me to pick one date range upfront.
- As a traveler with a flexible destination, I want to list several regions/countries I'm interested in so that the plan can propose and compare specific destinations rather than assuming one.
- As a traveler planning a multi-stop trip, I want to enter multiple cities or countries in the order I'd visit them (e.g., Austin then Dallas; London, then Paris, then Amsterdam) so that the plan covers my whole route, not just one destination.
- As a traveler with a multi-stop trip, I want to control (or let the plan suggest) how many nights I spend at each stop so that the pacing across the whole trip is realistic, not just within one city.
- As a traveler with a multi-stop trip, I want to see the inter-city transport options (flight, train, or drive) between each stop, with a recommended pick and trade-offs, the same way I'd see flight options for a single-destination trip.
- As a traveler, I want to specify special requirements (accessibility, pet-friendly, kid-friendly, no rental car, walkable cities, avoiding/targeting local holidays, bucket-list activities, English-speaking, solo-female-friendly) so that the recommendations actually fit my situation instead of generic defaults.
- As a traveler, I want to see 2–3 flight options with a clear recommended pick and stated trade-offs so that I can decide quickly without comparing raw search results myself.
- As a traveler, I want to see 2–3 lodging options matched to my trip style (relaxation vs. cultural vs. adventure) so that where I stay actually fits how I want to spend my time.
- As a traveler, I want to click a different flight or lodging option and see the itinerary and budget update immediately so that I can compare full scenarios, not just prices in isolation.
- As a traveler, I want a day-by-day, hour-by-hour itinerary that accounts for travel time and meals so that the plan is realistic, not overpacked.
- As a traveler, I want anything that requires advance booking clearly flagged with a direct link so that I don't show up and find out it's sold out.
- As a traveler, I want an itemized budget compared to what I said I could spend, with a clear flag if it's over, so that I know before I book anything.

**Edge cases**
- As a traveler, if I submit the form with required fields missing, I want to be told exactly what's missing so that the plan doesn't proceed on a wrong assumption.
- As a traveler, if my "other requirements" conflict with my destination choices (e.g., "no rental car" + a car-dependent region), I want that surfaced rather than silently ignored.
- As a traveler, if the itemized budget exceeds my stated budget, I want that flagged clearly at both the summary level and the line-item level, not buried.
- As a traveler on a multi-stop trip, if my requested stops don't have a reasonable inter-city connection (e.g., no direct flight/train and a very long drive), I want that surfaced as a trade-off rather than silently routed around.

---

## Requirements

### Must-Have (P0)

**Intake form**
- Dates: toggle between "specific dates" (start/end date pickers) and "general window" (multi-select month chips + year selector + trip-length text field).
  - *Acceptance:* Submitting with "general window" selected requires at least one month and a year; submitting with "specific dates" requires both a start and end date.
  - **General-window resolution:** when the user selects multiple candidate months (rather than specific dates), the plan resolves to one concrete date range to build the itinerary against — recommending the best month(s)/dates within the selected window based on factors like typical weather/best-time-to-visit for the destination, known special events or holidays at the destination (especially relevant if "travel during key special events/holidays" is checked in Other Requirements), and general price/crowd patterns. The chosen date range and a one-line reason ("Recommended: Oct 12–19 — shoulder season, mild weather, no major holiday conflicts") is shown in the trip summary.
- Departure location: single free-text field.
  - *Acceptance:* Required; form blocks submission if empty.
- Destination: toggle between "I know where" and "I'm flexible."
  - **"I know where"** supports one or more stops, entered as an ordered, reorderable list (add via text input + Enter, each stop becomes a removable/draggable row — e.g., "Austin" → "Dallas", or "London" → "Paris" → "Amsterdam"). A single stop is just a list of one. Each stop optionally takes a "nights here" number; if left blank, nights are auto-allocated evenly across the trip length and shown back to the user as editable.
  - **"I'm flexible"** keeps the existing multi-entry chip list of candidate regions/countries (unordered, used for destination *option* generation — see Destination options below). A flexible search can still resolve to a multi-stop recommended itinerary (e.g., user enters "Europe," plan proposes a London + Paris combination as one destination option).
  - *Acceptance:* "I know where" requires at least one stop; multi-stop order is preserved from entry order unless the user drags to reorder. "I'm flexible" requires at least one region/country entry before submission. **Maximum 6 stops per trip** — the add-stop input disables (with a brief inline message) once 6 stops are entered; this cap applies to both "I know where" entries and any multi-stop combination proposed under "I'm flexible."
- Budget: total amount field, per-person/group toggle, included/separate (flights & lodging) toggle.
  - *Acceptance:* All three required; amount must be a positive number.
- Trip goal & travelers: purpose text field, traveler count/ages field, optional mobility/dietary constraints field.
  - *Acceptance:* Purpose and traveler count required; constraints field optional.
- Trip style: single weighted control ordered Relaxation → Adventure → Cultural Exploration → Balanced Mix (per approved mockup), with balanced mix as the rightmost/default option.
  - *Acceptance:* A style weighting value is always present at submission (default to balanced mix if untouched).
- Must-see/must-do: optional free-text field.
- Other requirements: checkbox group with exactly these options — accessible for people with limited mobility, pet-friendly, kid-friendly, no rental car, walkable cities preferred, travel during key special events/holidays for that destination, looking for popular bucket-list destinations and activities, English predominantly spoken, female solo travel friendly.
  - *Acceptance:* Multi-select, all optional, no default selections (mockup's default-checked "walkable cities" was illustrative only — v1 ships with none pre-checked).
- Missing/ambiguous required fields block submission and surface which fields need attention (banner + inline field highlighting), rather than the plan proceeding on assumptions.
- **Other-requirements conflict handling:** if the combination of "other requirements" checkboxes (and/or flexible-destination criteria) meaningfully narrows or eliminates good-fit destination/option matches (e.g., "no rental car" + "walkable cities preferred" ruling out a car-dependent candidate), the plan **warns and continues** — it does not block submission or force the user to loosen constraints. The warning is surfaced on the results page (see below), not the intake form, since the conflict is only fully knowable after research.

**Results view**
- Trip summary block: full route (all stops in order, e.g., "Austin → Dallas" or "London → Paris → Amsterdam"), dates, travelers, style, one-paragraph overview, budget-vs-total pill.
- Destination options (2–3, only rendered if destination was flexible): each option may itself be a single city or a proposed multi-stop combination; each with one-line rationale; one marked "Recommended" with a stated reason; selecting one drives all downstream sections.
- **Route/stop overview**: for multi-stop trips, a visual sequence of stops (e.g., a horizontal stepper: Austin (3 nights) → Dallas (4 nights)) sits above the flight/lodging sections, showing night allocation per stop and letting the user adjust nights per stop (recalculates itinerary/budget live).
- Flight & inter-city transport options: for the arrival leg (origin → first stop) and each inter-city leg between stops, show 2–3 options (price, times, duration, mode — flight/train/drive — trade-offs), each with one marked "Recommended" and a stated reason. A single-destination trip has just the one arrival-leg section, same as before; a multi-stop trip repeats this per leg, clearly labeled by leg (e.g., "Austin → Dallas"). **Ground transport (drive/rental car and train, where available) is always included as options for inter-city legs alongside flights** — not gated to a later phase — so short hops (e.g., Austin → Dallas) show realistic drive/train alternatives, not just flights. If "no rental car" is checked in Other Requirements, drive options are excluded/deprioritized for that leg.
- **Conflict warning banner**: if the "other-requirements conflict handling" case above is triggered, the results page shows a visible (non-blocking) warning near the trip summary or affected section — e.g., "⚠ Limited walkable, no-rental-car options fit your other criteria near Dallas — showing the closest available matches" — and still renders best-effort options rather than stopping.
- Lodging options: price/night, location, trade-offs, one marked "Recommended" — shown **per stop** for multi-stop trips (e.g., separate lodging option sets for Austin and for Dallas), matched to trip style and traveler mix for that specific stop.
- Day-by-day itinerary: hour-by-hour, per-day navigation (day pills/tabs), includes meals and transit-time notes between stops, incorporates the user's must-see items, reflects currently selected destination/flight/lodging/inter-city transport. For multi-stop trips, days are grouped/labeled by which stop they belong to, and travel days (the day of an inter-city leg) are shown as their own itinerary entry with transit time and arrival-adjusted pacing (lighter activity load that day).
- Advance bookings required: item, why it needs booking ahead, direct purchase link — for anything timed-entry, high-demand, or reservation-only, aggregated across all stops and labeled by which stop/city it belongs to.
- Budget rollup: itemized line items — flights/arrival transport, **inter-city transport (its own line item for multi-stop trips)**, lodging (summed across all stops, with a per-stop breakdown available), activities/tickets, food, local transport, misc/buffer — total, and explicit comparison against stated budget with an over/under flag.
- **Live updates:** changing the selected flight, lodging, inter-city transport, destination option, or per-stop night allocation recalculates and re-renders the itinerary and budget sections without a page reload.
- **Price cross-verification:** for each flight, inter-city transport, and lodging option (across all legs/stops on a multi-stop trip), check price against the available sources for that category (e.g., Google Flights, airline site, other flight search results for flights; hotels.com, property site, other lodging listings for lodging) — not limited to exactly 2. As soon as **any 2 of the checked sources agree within 5%** of each other, mark the option "✓ Matches 2+ sources." If fewer than 2 sources agree within 5% after checking what's available, show "⚠ Prices vary: $X–$Y across sources" with the range instead.
  - *Acceptance:* Every flight and lodging option shown carries a match/mismatch indicator. "Match" = at least 2 checked sources within 5% of each other (whichever 2, not a fixed pair). A mismatch shows the observed range and does not silently pick one source's number as "the" price. This is the data-accuracy signal for v0 — it replaces relying on user feedback after the fact.
- **Price freshness disclaimer:** the results page displays a visible "Prices as of [research date]" note (e.g., in the trip summary or near the budget section), since v1 has no live pricing connector and all prices are researched at planning time.

**Non-functional**
- Single self-contained HTML file (inline CSS/JS) per the project's static-site requirement.
- Desktop-first responsive layout (per approved mockup), usable on mobile without being mobile-optimized first.
- Deployed to GitHub Pages (via a GitHub connector in Claude Code, if available) to a persistent URL; falls back to Netlify if no GitHub connector is available. Redeploying an updated plan should not require the user to regenerate a new URL each time within a session.
- Visual design matches the approved Airbnb-style mockup (coral accent `#FF385C`, Nunito Sans, rounded cards, pill/chip controls).
- Currency conversion: all prices shown in the user's home currency alongside local currency when the destination is non-domestic.
- **No analytics/tracking**: v1 ships with no analytics integration (no Netlify Analytics or equivalent) — confirmed out of scope. Engagement-related success metrics below are directional/aspirational only and are not instrumented in v1.

### Nice-to-Have (P1)
- Inline editing of the day-by-day itinerary (drag to reorder, remove an activity) with budget auto-recalculating.
- "Why this pick" expandable detail on each recommended option (more than the one-line rationale).
- Export the finished plan as a shareable PDF or printable view.
- Conflict warnings when "other requirements" checkboxes are in tension with the destination/options shown (e.g., "no rental car" flagged against a car-dependent destination option).
- Alternate-date suggestions if the budget comes in over, based on the "general window" months selected.
- Auto-suggested night allocation across stops based on typical dwell time for each city/region (v0 defaults to an even split, editable by the user).
- Route-order suggestions (e.g., flagging that the user's entered order backtracks geographically and offering a more efficient sequence) — v0 respects the user's entered order as-is.

### Future Considerations (P2)
- Auto-generating an optimal multi-city route from a loose list of "places I'd like to see," including suggesting additional worthwhile stops the user didn't name.
- Saved trips / account system, so a user can return to past plans.
- Live pricing via a connected flights/lodging booking API (once such a connector exists), replacing the researched-and-static v1 approach.
- Collaborative planning (shared link, multiple editors).
- In-app booking/checkout.

---

## Success Metrics

**Leading indicators**
- **Form completion rate**: % of users who start the intake form and reach a valid submission (target: 80%+ — the missing-field guardrails should prevent silent drop-off, not cause it).
- **Selection interaction rate / openness to other recommendations**: % of finished plans where the user views or selects a non-recommended flight, lodging, or destination option rather than accepting the default recommended pick (target: 50%+ — signals users are actually weighing the trade-offs shown, not just rubber-stamping the "Recommended" tag). Track both "expanded/viewed alternate option" and "selected alternate option" separately — viewing without switching still indicates the trade-off framing is being used.
- **Time to finished plan**: time from form submission to full results render (target: under 2 minutes of generation time for a first version; this is a planning-session tool, not instant).
- **Advance-booking click-through**: % of "advance bookings required" links clicked per session (directional signal the flags are useful, not just decorative).
- **Flights booked after initial search**: % of sessions where the user clicks through to book the selected flight option (via the airline/booking link) after viewing results (target: 20%+ click-through as a v1 proxy for booking intent). *Caveat: v1 has no booking-confirmation connector, and no analytics is being built (confirmed — see Timeline/decisions), so this metric is not instrumented in v1; it remains a target to design toward if analytics is added later.*

**Lagging indicators**
- **Data accuracy**: % of shown flight/lodging options that achieve "✓ Matches 2+ sources" (any 2 checked sources within 5% of each other) during research (target: 90%+ of options shown). Unlike the earlier post-click feedback-prompt approach, this is now measured directly at research/render time via the price cross-verification requirement above — no user action required to capture it.
- **Budget accuracy**: for trips actually taken, itemized estimate vs. actual spend (target: within 15%) — only measurable if the user reports back; treat as a v2+ feedback loop, not a v1-measurable metric.
- **Repeat use**: % of users who return to plan a second trip (directional; no accounts in v1, so this is only measurable by repeat sessions from the same user manually, not tracked automatically).

*Note: v1 confirmed ships with no analytics/tracking infrastructure, so most of these metrics are aspirational targets to design toward, not instrumented dashboards. Data accuracy is the exception: it's measurable directly from the price cross-verification requirement without any tracking infrastructure — everything else here (form completion, selection interaction, flights-booked, advance-booking click-through) would require analytics to actually measure, and that's explicitly out of scope for v1.*

---

## Open Questions

Resolved as of this update:

1. ~~**Analytics**~~ — **Resolved: not needed.** V1 ships with no analytics/tracking integration.
2. ~~**Price mismatch tolerance & source pairing**~~ — **Resolved**: match tolerance is 5%; check all available sources for the category (not a fixed pair) and mark "✓ Matches 2+ sources" as soon as any 2 agree within 5%, otherwise show the observed range.
3. ~~**Data source freshness**~~ — **Resolved: yes.** The results page shows a "prices as of [research date]" disclaimer.
4. ~~**Multiple "other requirements" conflicts**~~ — **Resolved: warn and continue.** The results page shows a non-blocking warning banner and still renders best-effort options.
5. ~~**General-window date resolution**~~ — **Resolved**: the plan recommends the best specific date range within the user's selected months, based on best-time-to-visit factors (weather, special events/holidays at the destination, crowd/price patterns) — see the updated Dates requirement above.
7. ~~**Max stops per trip**~~ — **Resolved: 6 stops max.** Enforced in the intake form.
8. ~~**Ground transport between nearby stops**~~ — **Resolved: yes, always shown.** Drive and train options appear alongside flights for every inter-city leg (respecting "no rental car" when checked).

Still open:

6. **Hosting connector availability & redeploy behavior**: does Claude Code have a working GitHub connector to publish to GitHub Pages, or should this default straight to Netlify? Either way — does each new trip-planning session create a new URL/repo, or does it overwrite/update a single persistent site the user reuses across sessions? *(engineering — affects Claude Code implementation approach; check connector availability first)*

---

## Timeline Considerations

- No hard external deadline stated by the user.
- Dependency: flights and lodging currently have no dedicated MCP connector (per project connector list) — research relies on web search, which is slower and less structured than a connector would be. If an Expedia/Booking.com-style connector becomes available mid-build, flight/lodging research should switch to it.
- Suggested phasing:
  - **Phase 1 (this build):** P0 scope above — full intake form (including multi-stop destination entry), multi-stop results view (route overview, per-leg transport, per-stop lodging, grouped itinerary), live updates, GitHub Pages/Netlify deployment.
  - **Phase 2:** P1 nice-to-haves, prioritized after the first real trip is planned end-to-end and any UX friction is identified.
