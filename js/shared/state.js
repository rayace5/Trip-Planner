// Shared: app state, constants, persistence (localStorage + window.tripPlannerData), and full-form data collection.
'use strict';

var MAX_STOPS = 6;
var STYLE_VALUES = ['Relaxation', 'Adventure', 'Cultural exploration', 'Balanced mix'];
var STORAGE_KEY = 'tripPlannerIntake';

// ---------- App state ----------
var state = {
  dateMode: 'general',           // 'general' | 'specific'
  destMode: 'known',             // 'known' | 'flexible'
  stops: [],                     // [{ name, nights (number|null) }]
  regions: []                    // ['Portugal', ...]
};

function persistData(data){
  window.tripPlannerData = data;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) { /* storage unavailable — in-memory copy still set */ }
}

// ---------- Collect + submit ----------
function collectFormData(){
  var months = [];
  $('monthChips').querySelectorAll('.chip.selected').forEach(function(c){ months.push(c.getAttribute('data-month')); });
  var yearEl = $('yearPills').querySelector('.pill.selected');
  var scopeEl = $('budgetScopePills').querySelector('.pill.selected');
  var includesEl = $('budgetIncludesPills').querySelector('.pill.selected');
  var otherReqs = [];
  $('otherReqs').querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb){ otherReqs.push(cb.value); });

  var data = {
    dates: {
      mode: state.dateMode,
      months: state.dateMode === 'general' ? months : [],
      year: state.dateMode === 'general' && yearEl ? parseInt(yearEl.getAttribute('data-year'), 10) : null,
      tripLength: state.dateMode === 'general' ? $('tripLength').value.trim() : '',
      startDate: state.dateMode === 'specific' ? $('startDate').value : null,
      endDate: state.dateMode === 'specific' ? $('endDate').value : null
    },
    departingFrom: $('departingFrom').value.trim(),
    destination: {
      mode: state.destMode,
      stops: state.destMode === 'known' ? state.stops.map(function(s){ return { name: s.name, nights: s.nights }; }) : [],
      regions: state.destMode === 'flexible' ? state.regions.slice() : []
    },
    budget: {
      amount: parseFloat($('budgetAmount').value.replace(/[$,\s]/g, '')),
      scope: scopeEl ? scopeEl.getAttribute('data-budget-scope') : 'per-person',
      flightsLodging: includesEl ? includesEl.getAttribute('data-budget-includes') : 'included'
    },
    travelers: {
      purpose: $('tripPurpose').value.trim(),
      whoIsGoing: $('whoIsGoing').value.trim(),
      constraints: $('constraints').value.trim()
    },
    tripStyle: STYLE_VALUES[parseInt($('styleRange').value, 10)] || 'Balanced mix',
    mustSee: $('mustSee').value.trim(),
    otherRequirements: otherReqs,
    submittedAt: new Date().toISOString()
  };
  // Resolve the general window to one concrete date range (or mirror the
  // user's own specific dates) so later stories can consume dates.resolved.
  data.dates.resolved = resolveDates(data);
  // Flexible destinations get 2–3 concrete proposals; the recommended one
  // starts selected so downstream sections always have a destination.
  if (data.destination.mode === 'flexible'){
    data.destination.options = generateDestinationOptions(data);
    var rec = null;
    data.destination.options.forEach(function(o){ if (!rec && o.recommended) rec = o; });
    if (!rec) rec = data.destination.options[0] || null;
    data.destination.selectedOption = rec
      ? { name: rec.name, stops: rec.stops, rationale: rec.rationale, recommended: !!rec.recommended }
      : null;
  }
  // Known-mode stops with blank nights get an even auto-allocation from
  // the resolved trip length (PRD: "auto-allocated evenly across the trip
  // length and shown back to the user as editable").
  if (data.destination.mode === 'known' && data.destination.stops.length){
    data.destination.stops = fillBlankNights(data.destination.stops, nightsFromResolved(data));
  }
  // If the per-stop allocation sums differently than the resolved range
  // (e.g. user-specified nights), the end date follows the nights.
  recomputeResolvedEnd(data);
  // Inter-city transport legs between consecutive stops (empty for
  // single-stop trips), each with the recommended option pre-selected.
  // Resubmission regenerates from scratch.
  data.legs = buildLegs(data, null);
  // Non-blocking requirement-conflict warnings (PRD: warn and continue).
  // Always an array; empty when nothing had to be compromised.
  data.conflictWarnings = detectConflictWarnings(data);
  return data;
}
