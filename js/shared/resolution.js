// Shared: general-window date resolution and nights allocation/recomputation helpers.
'use strict';

// ---------- General-window date resolution ----------
// Deterministic v1 heuristic: score the user's candidate months for their
// destination (small honest dataset: a handful of well-known regions plus a
// generic northern-hemisphere fallback), then pick a concrete date range in
// the best month. The one-line reason reflects the rule that actually fired.
var EVENTS_REQUIREMENT = 'Travel during key special events/holidays for that destination';
var LEAD_DAYS = 7; // don't recommend a start date less than a week away

function matchRegionProfile(destText){
  var t = String(destText).toLowerCase();
  for (var i = 0; i < REGION_PROFILES.length; i++){
    for (var k = 0; k < REGION_PROFILES[i].keywords.length; k++){
      if (t.indexOf(REGION_PROFILES[i].keywords[k]) !== -1) return REGION_PROFILES[i];
    }
  }
  return null;
}

function resolveGeneralWindow(data, now){
  now = now || new Date();
  var selectedYear = data.dates.year;
  var nights = parseTripNights(data.dates.tripLength);
  var destText = data.destination.mode === 'known'
    ? data.destination.stops.map(function(s){ return s.name; }).join(' ')
    : data.destination.regions.join(' ');
  var profile = matchRegionProfile(destText);
  var eventSeeking = (data.otherRequirements || []).indexOf(EVENTS_REQUIREMENT) !== -1;

  // Sort candidate months chronologically; drop anything unrecognized.
  var months = data.dates.months
    .filter(function(m){ return MONTH_ABBRS.indexOf(m) !== -1; })
    .sort(function(a, b){ return MONTH_ABBRS.indexOf(a) - MONTH_ABBRS.indexOf(b); });
  if (!months.length) return null;

  var earliest = new Date(now.getFullYear(), now.getMonth(), now.getDate() + LEAD_DAYS);
  function monthFeasible(y, mi){ return new Date(y, mi + 1, 0) >= earliest; }

  // Roll forward within the selected window: drop fully-past months; if the
  // whole window has passed for the selected year, use the same months next year.
  var year = selectedYear, rolled = false;
  var candidates = months.filter(function(m){ return monthFeasible(year, MONTH_ABBRS.indexOf(m)); });
  if (!candidates.length){ year = selectedYear + 1; rolled = true; candidates = months.slice(); }

  // Score each candidate month; ties go to the earlier month.
  var best = null, bestScore = -Infinity;
  candidates.forEach(function(m){
    var ev = profile && profile.events ? profile.events[m] : null;
    var hol = (profile && profile.holidays && profile.holidays[m]) || US_HOLIDAYS[m] || null;
    var score = profile ? (profile.monthScore[m] || 0) : (GENERIC_MONTH_SCORE[m] || 0);
    if (eventSeeking){ if (ev) score += 2; }        // favor known event months
    else if (hol) score -= 1;                        // mildly avoid holiday-peak months
    if (score > bestScore){ bestScore = score; best = { m: m, mi: MONTH_ABBRS.indexOf(m), ev: ev, hol: hol }; }
  });

  // Pick a start day inside the winning month: mid-month by default,
  // event-aligned when seeking events, shifted off holiday weeks otherwise.
  var daysInMonth = new Date(year, best.mi + 1, 0).getDate();
  var start = 12;
  if (eventSeeking && best.ev){
    start = Math.min(best.ev.day, daysInMonth);
  } else if (best.hol && start <= best.hol.to && start + nights >= best.hol.from){
    var before = best.hol.from - nights - 1;
    var after = best.hol.to + 2;
    if (before >= 2) start = before;
    else if (after <= daysInMonth - 1) start = after;
  }
  if (best.hol && best.hol.majorDay === start) start += 1; // never start on the holiday itself

  var startDate = new Date(year, best.mi, start);
  if (startDate < earliest) startDate = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
  var endDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + nights);

  var overlapsHoliday = !!(best.hol && startDate.getMonth() === best.mi &&
    startDate.getDate() <= best.hol.to && startDate.getDate() + nights >= best.hol.from);

  // Reason string reflects the rules that actually fired.
  var fragments = [];
  if (rolled) fragments.push('rolled forward to ' + year + ' since your ' + selectedYear + ' window has passed');
  if (eventSeeking && best.ev) fragments.push('timed for ' + best.ev.name);
  var note = (profile && profile.notes && profile.notes[best.m]) || GENERIC_NOTES[best.m];
  if (note) fragments.push(note);
  if (eventSeeking && !best.ev){
    fragments.push('best-fit month in your window (no marquee event dates on file)');
  } else if (!eventSeeking){
    if (best.hol && !overlapsHoliday) fragments.push('avoids ' + best.hol.name);
    else if (overlapsHoliday) fragments.push('note: overlaps ' + best.hol.name);
    else fragments.push('no major holiday conflicts');
  }

  return {
    startDate: toISODate(startDate),
    endDate: toISODate(endDate),
    reason: 'Recommended: ' + formatRange(startDate, endDate) + ' — ' + fragments.join(', ')
  };
}

function resolveDates(data){
  if (data.dates.mode === 'specific'){
    return { startDate: data.dates.startDate, endDate: data.dates.endDate, reason: null };
  }
  return resolveGeneralWindow(data);
}

// Exposed for testing (pure/deterministic given a fixed `now`).
window.resolveGeneralWindow = resolveGeneralWindow;

function nightsFromResolved(data){
  var r = data.dates && data.dates.resolved;
  if (r && r.startDate && r.endDate){
    var n = Math.round((new Date(r.endDate) - new Date(r.startDate)) / 86400000);
    if (n >= 1) return Math.min(n, 30);
  }
  return parseTripNights(data.dates && data.dates.tripLength);
}

// Fills in any blank ("auto") nights on an ordered stop list from the
// resolved trip length: user-specified nights are kept as-is and the
// remaining nights are split evenly across the blank stops with the same
// rule allocateNights uses (remainder to earlier stops, min 1 per stop).
function fillBlankNights(stops, totalNights){
  var fixedSum = 0, blankCount = 0;
  stops.forEach(function(s){
    if (s.nights == null) blankCount++;
    else fixedSum += s.nights;
  });
  if (!blankCount){
    return stops.map(function(s){ return { name: s.name, nights: s.nights }; });
  }
  var remaining = Math.max(blankCount, totalNights - fixedSum);
  var base = Math.floor(remaining / blankCount), rem = remaining % blankCount;
  var bi = 0;
  return stops.map(function(s){
    if (s.nights != null) return { name: s.name, nights: s.nights };
    var nights = Math.max(1, base + (bi < rem ? 1 : 0));
    bi++;
    return { name: s.name, nights: nights };
  });
}

// Exposed for testing (pure/deterministic).
window.fillBlankNights = fillBlankNights;

function activeStops(data){
  if (data.destination.mode === 'known') return data.destination.stops;
  return data.destination.selectedOption ? data.destination.selectedOption.stops : [];
}

function totalStopNights(stops){
  return stops.reduce(function(sum, s){ return sum + (s.nights || 0); }, 0);
}

// Per-stop nights are the source of truth for total trip length once the
// plan exists: whenever they change, the resolved end date is recomputed
// as startDate + total nights, and a general-window reason line is
// rewritten to show the updated range.
function recomputeResolvedEnd(data){
  var r = data.dates && data.dates.resolved;
  if (!r || !r.startDate) return;
  var total = totalStopNights(activeStops(data));
  if (total < 1) return;
  var s = parseISODateLocal(r.startDate);
  var e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + total);
  var newEnd = toISODate(e);
  if (newEnd === r.endDate) return;
  r.endDate = newEnd;
  if (r.reason){
    var sep = r.reason.indexOf(' — ');
    var basis = sep !== -1 ? r.reason.slice(sep + 3) : '';
    r.reason = 'Recommended: ' + formatRange(s, e) + (basis ? ' — ' + basis : '');
  }
}
