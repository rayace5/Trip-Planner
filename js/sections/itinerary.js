// Section: Day-by-day itinerary — hour-by-hour plan with meals, transit notes, travel days, and must-see picks.
'use strict';

// ---------- Day-by-day itinerary ----------
// Deterministic v1: the trip's days are mapped from dates.resolved.startDate
// plus the per-stop nights on the active route:
//   day 1                  = arrival day at the first stop (pacing follows the
//                            SELECTED arrival flight: morning nonstop → fuller
//                            day with an afternoon activity; 1-stop connection
//                            → light check-in evening; afternoon nonstop →
//                            light evening start),
//   interior days          = full days at a stop (4–6 timed entries),
//   travel days            = the day of each inter-city leg (transit entry
//                            built from the SELECTED leg option's mode and
//                            duration, at most 1–2 light entries after
//                            arrival),
//   final day (N nights+1) = departure day at the last stop.
// Meals anchor every day (breakfast ~9:00am where the traveler wakes up in
// the city, lunch ~1:00pm, dinner ~7:30pm) and activities never overlap them.
// Activities come from the honest per-city pool (CITY_ACTIVITIES in
// js/shared/data.js); unknown cities get clearly-generic entries with
// estimated wording. Trip style shapes the day template (relaxation → fewer
// entries + a rest block; cultural → museums/historic first; adventure →
// outdoor picks first; balanced → a mix). Free-text must-see items are parsed
// and slotted into days at the matching stop (or spread across the trip),
// tagged "(must-see pick)". Lodging choice never changes the itinerary.

var ITIN_STYLE_PREF = {
  'Relaxation': 'stroll',
  'Adventure': 'outdoor',
  'Cultural exploration': 'culture',
  'Balanced mix': null
};

// Generic realistic hop notes between entries, cycled deterministically.
var ITIN_TRANSIT_NOTES = ['15 min walk', '10 min rideshare', '5 min walk', '12 min walk', '10 min metro or rideshare'];
function itinNote(dayNumber, slot){
  return ITIN_TRANSIT_NOTES[(dayNumber + slot) % ITIN_TRANSIT_NOTES.length];
}

var ITIN_LEG_VERBS = { drive:'Drive', train:'Train', flight:'Fly', ferry:'Ferry' };

function matchCityActivities(stopName){
  var t = String(stopName || '').toLowerCase();
  for (var i = 0; i < CITY_ACTIVITIES.length; i++){
    for (var k = 0; k < CITY_ACTIVITIES[i].keywords.length; k++){
      if (t.indexOf(CITY_ACTIVITIES[i].keywords[k]) !== -1) return CITY_ACTIVITIES[i];
    }
  }
  return null;
}

// Per-stop activity source: known-city pool reordered so the trip style's
// preferred kind comes first (stable within groups), consumed sequentially
// across that stop's days; falls back to the generic pool when exhausted.
function itinActivitySource(stopName, style){
  var entry = matchCityActivities(stopName);
  var estimated = !entry;
  var base = entry ? entry.activities.slice() : GENERIC_ACTIVITIES.slice();
  var pref = ITIN_STYLE_PREF[style] || null;
  var pool = [];
  if (pref){
    base.forEach(function(a){ if (a.kind === pref) pool.push(a); });
    base.forEach(function(a){ if (a.kind !== pref) pool.push(a); });
  } else {
    pool = base;
  }
  return { pool: pool, idx: 0, estimated: estimated, city: stopName };
}

function itinNextActivity(src){
  var a = src.idx < src.pool.length
    ? src.pool[src.idx]
    : GENERIC_ACTIVITIES[(src.idx - src.pool.length) % GENERIC_ACTIVITIES.length];
  src.idx++;
  return a;
}

function itinEntry(time, title, note, extra){
  var e = { time: time, title: title, note: note || null };
  if (extra){ for (var k in extra){ if (extra.hasOwnProperty(k)) e[k] = extra[k]; } }
  return e;
}

// Pushes an activity entry and records it as a replaceable must-see slot.
function itinPushActivity(entries, meta, src, dayNumber, time, slotNo){
  var a = itinNextActivity(src);
  var note = src.estimated
    ? 'a rough suggestion — we don\'t have ' + src.city + ' activities on file'
    : itinNote(dayNumber, slotNo);
  meta.slots.push(entries.length);
  meta.slotUsed.push(false);
  entries.push(itinEntry(time, a.title, note));
}

function itinPushLunch(entries, meta, dayNumber, title, note){
  meta.lunchIdx = entries.length;
  entries.push(itinEntry('1:00pm', title || 'Lunch at a local spot', note || itinNote(dayNumber, 1), { meal:'lunch' }));
}

function itinNewMeta(){
  return { slots: [], slotUsed: [], lunchIdx: null, lunchUsed: false };
}

// Full day at a stop (interior day). 5–6 entries depending on style; meals
// at 9:00am / 1:00pm / 7:30pm with activities strictly between them.
function itinFullDay(dayNumber, stop, stopIndex, src, style){
  var entries = [], meta = itinNewMeta();
  entries.push(itinEntry('9:00am', 'Breakfast near your lodging'));
  if (style === 'Relaxation'){
    itinPushActivity(entries, meta, src, dayNumber, '10:30am', 0);
    itinPushLunch(entries, meta, dayNumber);
    entries.push(itinEntry('3:00pm', 'Rest block / free time'));
  } else if (style === 'Cultural exploration'){
    itinPushActivity(entries, meta, src, dayNumber, '10:00am', 0);
    itinPushLunch(entries, meta, dayNumber);
    itinPushActivity(entries, meta, src, dayNumber, '2:30pm', 2);
    itinPushActivity(entries, meta, src, dayNumber, '4:30pm', 3);
  } else if (style === 'Adventure'){
    itinPushActivity(entries, meta, src, dayNumber, '10:00am', 0);
    itinPushLunch(entries, meta, dayNumber);
    itinPushActivity(entries, meta, src, dayNumber, '2:30pm', 2);
  } else { // Balanced mix
    itinPushActivity(entries, meta, src, dayNumber, '10:00am', 0);
    itinPushLunch(entries, meta, dayNumber);
    itinPushActivity(entries, meta, src, dayNumber, '3:00pm', 2);
  }
  entries.push(itinEntry('7:30pm', 'Dinner at a local spot', itinNote(dayNumber, 4), { meal:'dinner' }));
  return {
    day: { dayNumber: dayNumber, date: null, stop: stop.name, stopIndex: stopIndex, isTravelDay: false, entries: entries },
    meta: meta
  };
}

// Day 1: arrival at the first stop, paced by the selected arrival flight.
function itinArrivalDay(dayNumber, stop, src, data){
  var af = data.arrivalFlight;
  var sel = null;
  if (af && af.options){
    af.options.forEach(function(o){ if (!sel && o.label === af.selected) sel = o; });
  }
  var origin = (af && af.from) || String(data.departingFrom || '').trim() || 'home';
  var city = stop.name;
  var entries = [], meta = itinNewMeta();

  var kind = 'morning'; // fuller-day default (matches the recommended pick)
  if (sel && /afternoon/i.test(sel.label)) kind = 'evening';
  else if (sel && /1-stop|connect/i.test(sel.label + ' ' + (sel.detail || ''))) kind = 'connect';

  if (kind === 'evening'){
    // Afternoon nonstop → light evening start; lunch happens pre-flight.
    entries.push(itinEntry('1:00pm', 'Lunch before your flight', 'near the airport, ahead of your ' + (sel ? sel.depart : '3:15pm') + ' departure', { meal:'lunch' }));
    entries.push(itinEntry(sel ? sel.depart : '3:15pm', 'Fly ' + origin + ' → ' + city, (sel ? sel.duration : '') || 'nonstop'));
    entries.push(itinEntry('7:00pm', 'Land in ' + city + ' — hotel check-in', 'drop bags and settle in'));
    entries.push(itinEntry('8:30pm', 'Late dinner near your lodging', 'light evening start after an afternoon arrival', { meal:'dinner' }));
    // Lunch is pre-flight at the origin — not a must-see slot in this city.
  } else if (kind === 'connect'){
    // 1-stop connection → most of the day in transit, easy first evening.
    entries.push(itinEntry(sel ? sel.depart : '8:10am', 'Fly ' + origin + ' → ' + city + ' (1 stop)', (sel ? sel.duration : '') || '1 stop en route'));
    entries.push(itinEntry('1:00pm', 'Lunch during your layover', 'at the connecting airport', { meal:'lunch' }));
    entries.push(itinEntry('4:30pm', 'Land in ' + city + ' — hotel check-in', 'drop bags and settle in'));
    entries.push(itinEntry('7:30pm', 'Dinner near your lodging', 'easy first night after a connecting flight', { meal:'dinner' }));
  } else {
    // Morning nonstop → lands with usable Day-1 time: fuller afternoon.
    entries.push(itinEntry(sel ? sel.depart : '9:45am', 'Fly ' + origin + ' → ' + city, (sel ? sel.duration : '') || 'nonstop'));
    itinPushLunch(entries, meta, dayNumber, 'Lunch near your lodging', 'arrival day — keep it close by');
    entries.push(itinEntry('3:00pm', 'Hotel check-in and drop bags'));
    itinPushActivity(entries, meta, src, dayNumber, '4:30pm', 3);
    entries.push(itinEntry('7:30pm', 'Dinner near your lodging', itinNote(dayNumber, 4), { meal:'dinner' }));
  }
  return {
    day: { dayNumber: dayNumber, date: null, stop: stop.name, stopIndex: 0, isTravelDay: false, entries: entries },
    meta: meta
  };
}

function itinSelectedLeg(data, fromName, toName){
  var legs = data.legs || [];
  for (var i = 0; i < legs.length; i++){
    if (legs[i].from === fromName && legs[i].to === toName){
      var sel = null;
      (legs[i].options || []).forEach(function(o){ if (!sel && o.label === legs[i].selected) sel = o; });
      return sel || (legs[i].options && legs[i].options[0]) || null;
    }
  }
  return null;
}

// Travel day: check out of the previous stop, the selected leg's transit
// entry, then arrival-adjusted pacing (check-in + at most one light entry).
function itinTravelDay(dayNumber, fromStop, toStop, stopIndex, data){
  var from = fromStop.name, to = toStop.name;
  var sel = itinSelectedLeg(data, from, to);
  var hrs = sel && typeof sel.hrs === 'number' ? sel.hrs : 4.5;
  var entries = [], meta = itinNewMeta();

  entries.push(itinEntry('9:00am', 'Breakfast, pack, and check out of ' + from, null, { meal:'breakfast' }));
  var title = sel
    ? (ITIN_LEG_VERBS[sel.mode] || 'Travel') + ' ' + from + ' → ' + to
    : 'Travel ' + from + ' → ' + to;
  var note = sel
    ? sel.duration + (sel.detail ? ' · ' + sel.detail : '') + ' · light activity day for arrival pacing'
    : 'transit day · light activity day for arrival pacing';
  entries.push(itinEntry('10:00am', title, note, { travel: true, mode: sel ? sel.mode : null }));
  if (hrs <= 3){
    entries.push(itinEntry('1:00pm', 'Lunch in ' + to, 'you arrive with the afternoon free', { meal:'lunch' }));
  } else {
    entries.push(itinEntry('1:00pm', 'Lunch en route', 'pack snacks or eat along the way', { meal:'lunch' }));
  }
  entries.push(itinEntry(hrs >= 6 ? '5:00pm' : '3:00pm', 'Hotel check-in in ' + to, 'drop bags and settle in'));
  if (hrs <= 4.5){
    entries.push(itinEntry('4:30pm', 'Easy first look around ' + to, itinNote(dayNumber, 3)));
  }
  entries.push(itinEntry('7:30pm', 'Dinner near your lodging', itinNote(dayNumber, 4), { meal:'dinner' }));
  return {
    day: { dayNumber: dayNumber, date: null, stop: to, stopIndex: stopIndex, isTravelDay: true,
      travelFrom: from, travelTo: to, entries: entries },
    meta: meta
  };
}

// Final day: last morning at the last stop, then the evening flight home.
function itinFinalDay(dayNumber, stop, stopIndex, src){
  var entries = [], meta = itinNewMeta();
  entries.push(itinEntry('9:00am', 'Breakfast near your lodging'));
  itinPushActivity(entries, meta, src, dayNumber, '10:00am', 0);
  entries.push(itinEntry('12:00pm', 'Check out and store your bags'));
  itinPushLunch(entries, meta, dayNumber, 'Lunch at a local spot', 'one last meal in ' + stop.name);
  entries.push(itinEntry('4:00pm', 'Head to the airport — evening flight home', 'return leg of your round-trip flight'));
  entries.push(itinEntry('7:30pm', 'Dinner at the airport before your flight', null, { meal:'dinner' }));
  return {
    day: { dayNumber: dayNumber, date: null, stop: stop.name, stopIndex: stopIndex, isTravelDay: false, entries: entries },
    meta: meta
  };
}

// ---------- Must-see parsing + slotting ----------
function itinParseMustSee(text){
  return String(text || '')
    .split(/[,;\n]+/)
    .map(function(s){ return s.trim(); })
    .filter(function(s){ return s.length > 0; });
}

function itinFoodLike(item){
  return /\b(bbq|barbecue|restaurants?|caf[eé]s?|coffee|bakery|brunch|breakfast|lunch|dinner|food|eats?|tacos?|pizza|sushi|ramen|steak(?:house)?|seafood|winery|brewery|tapas|bistro|diner)\b/i.test(item);
}

// Which stop does a must-see item belong to? Matches when the item text
// contains the stop's name or any of that city's activity-dataset keywords.
function itinStopForItem(item, stops){
  var t = String(item).toLowerCase();
  for (var i = 0; i < stops.length; i++){
    var name = String(stops[i].name || '').toLowerCase();
    if (name && t.indexOf(name) !== -1) return i;
    var entry = matchCityActivities(stops[i].name);
    if (entry){
      for (var k = 0; k < entry.keywords.length; k++){
        if (t.indexOf(entry.keywords[k]) !== -1) return i;
      }
    }
  }
  return -1;
}

// Slot must-see items into days: food-like items take the day's lunch slot
// ("Lunch — X (must-see pick)"); others replace an unused activity slot; a
// day under 6 entries can take one extra late-afternoon entry. Matched items
// go to the relevant stop's days, unmatched items spread across the trip —
// travel days are never loaded up.
function itinAssignMustSee(days, meta, items, stops){
  if (!items.length) return;
  var perStop = {}, spread = [];
  items.forEach(function(item){
    var si = itinStopForItem(item, stops);
    if (si === -1){ spread.push(item); return; }
    if (!perStop[si]) perStop[si] = [];
    perStop[si].push(item);
  });

  function candidateDays(stopIndex){
    var out = [];
    days.forEach(function(d, i){
      if (d.isTravelDay) return;
      if (stopIndex != null && d.stopIndex !== stopIndex) return;
      if (!meta[i].slots.length && meta[i].lunchIdx == null) return;
      out.push(i);
    });
    return out;
  }

  function place(dayIdx, item){
    var d = days[dayIdx], m = meta[dayIdx];
    if (itinFoodLike(item) && m.lunchIdx != null && !m.lunchUsed){
      var le = d.entries[m.lunchIdx];
      le.title = 'Lunch — ' + item + ' (must-see pick)';
      le.mustSee = true;
      m.lunchUsed = true;
      return true;
    }
    for (var s = 0; s < m.slots.length; s++){
      if (m.slotUsed[s]) continue;
      var e = d.entries[m.slots[s]];
      e.title = item + ' (must-see pick)';
      e.mustSee = true;
      m.slotUsed[s] = true;
      return true;
    }
    if (d.entries.length < 6){
      // One extra late-afternoon entry, inserted just before dinner.
      d.entries.splice(d.entries.length - 1, 0,
        itinEntry('5:30pm', item + ' (must-see pick)', 'from your must-see list', { mustSee: true }));
      return true;
    }
    return false;
  }

  var placedCount = 0;
  function assignRound(itemList, dayIdxs, offset){
    itemList.forEach(function(item, j){
      for (var t = 0; t < dayIdxs.length; t++){
        if (place(dayIdxs[(offset + j + t) % dayIdxs.length], item)){
          placedCount++;
          return;
        }
      }
    });
  }

  Object.keys(perStop)
    .map(function(k){ return parseInt(k, 10); })
    .sort(function(a, b){ return a - b; })
    .forEach(function(si){
      var cds = candidateDays(si);
      if (!cds.length){ spread = spread.concat(perStop[si]); return; }
      assignRound(perStop[si], cds, 0);
    });
  // Unmatched items spread across the whole trip, offset past days that
  // already picked up a stop-matched item.
  var allDays = candidateDays(null);
  if (allDays.length) assignRound(spread, allDays, placedCount);
}

// ---------- Generation ----------
function generateItinerary(data){
  var stops = activeStops(data);
  if (!stops || !stops.length) return { days: [] };
  var style = data.tripStyle || 'Balanced mix';
  var startISO = data.dates && data.dates.resolved && data.dates.resolved.startDate;
  var start = startISO ? parseISODateLocal(startISO) : null;
  function dateFor(n){
    if (!start) return null;
    var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (n - 1));
    return toISODate(d);
  }

  var sources = stops.map(function(s){ return itinActivitySource(s.name, style); });
  var days = [], meta = [];
  function push(r){
    r.day.date = dateFor(r.day.dayNumber);
    days.push(r.day);
    meta.push(r.meta);
  }

  var dayNo = 1;
  stops.forEach(function(stop, si){
    var nights = Math.max(1, parseInt(stop.nights, 10) || 1);
    if (si === 0){
      push(itinArrivalDay(dayNo++, stop, sources[si], data));
    } else {
      push(itinTravelDay(dayNo++, stops[si - 1], stop, si, data));
    }
    // Interior full days: the stop's remaining nights after its first day.
    for (var d = 1; d < nights; d++){
      push(itinFullDay(dayNo++, stop, si, sources[si], style));
    }
  });
  // Departure day at the last stop (total days = total nights + 1).
  var last = stops.length - 1;
  push(itinFinalDay(dayNo, stops[last], last, sources[last]));

  itinAssignMustSee(days, meta, itinParseMustSee(data.mustSee), stops);
  return { days: days };
}

// Exposed for testing (pure/deterministic given the intake data).
window.generateItinerary = generateItinerary;

// ---------- Rendering ----------
// Day pills navigate a single visible per-day panel (mockup .day-pills /
// .stop-heading / .itin-item; travel days use the amber .travel-day-item
// row). The viewed day survives regenerations where still valid.
var itinViewDayIdx = 0;

function renderItinerary(data, resetView){
  var section = $('itinerarySection');
  var pills = $('itinDayPills');
  var panel = $('itinDayPanel');
  pills.innerHTML = '';
  panel.innerHTML = '';
  var days = (data.itinerary && data.itinerary.days) || [];
  if (!days.length){
    section.classList.remove('visible');
    return;
  }
  if (resetView) itinViewDayIdx = 0;
  if (itinViewDayIdx >= days.length) itinViewDayIdx = days.length - 1;
  if (itinViewDayIdx < 0) itinViewDayIdx = 0;

  days.forEach(function(day, i){
    var pill = document.createElement('div');
    pill.className = 'day-pill' + (i === itinViewDayIdx ? ' active' : '');
    pill.setAttribute('role', 'button');
    pill.setAttribute('data-itin-day-index', String(i));
    pill.setAttribute('data-itin-day-stop', day.stop);
    pill.setAttribute('data-itin-travel-day', day.isTravelDay ? 'true' : 'false');
    pill.textContent = 'Day ' + day.dayNumber + ' · ' + (day.isTravelDay ? 'Travel' : day.stop);
    pill.addEventListener('click', function(){
      itinViewDayIdx = i;
      renderItinerary(data);
    });
    pills.appendChild(pill);
  });

  var day = days[itinViewDayIdx];
  var heading = document.createElement('div');
  heading.className = 'stop-heading';
  if (day.isTravelDay){
    heading.innerHTML = '<span class="stop-num">→</span>' +
      escapeHtml('Day ' + day.dayNumber + ' — Travel to ' + day.stop);
  } else {
    heading.innerHTML = '<span class="stop-num">' + (day.stopIndex + 1) + '</span>' +
      escapeHtml(day.stop + ' — Day ' + day.dayNumber);
  }
  panel.appendChild(heading);
  if (day.date){
    var dateLine = document.createElement('div');
    dateLine.className = 'itin-date';
    dateLine.textContent = formatISODate(day.date);
    panel.appendChild(dateLine);
  }
  var card = document.createElement('div');
  card.className = 'section-card itin-card';
  card.setAttribute('data-itin-day-number', String(day.dayNumber));
  day.entries.forEach(function(entry, ei){
    var row = document.createElement('div');
    row.className = 'itin-item' + (entry.travel ? ' travel-day-item' : '');
    row.setAttribute('data-itin-entry-index', String(ei));
    row.innerHTML =
      '<div class="itin-time">' + escapeHtml(entry.time) + '</div>' +
      '<div class="itin-body"><div class="itin-title">' + escapeHtml(entry.title) + '</div>' +
      (entry.note ? '<div class="itin-note">' + escapeHtml(entry.note) + '</div>' : '') +
      '</div>';
    card.appendChild(row);
  });
  panel.appendChild(card);
  section.classList.add('visible');
}

// Regenerate + persist + re-render in one step — called whenever a selection
// the itinerary depends on changes (destination option, arrival flight,
// inter-city leg, nights). Lodging changes deliberately don't call this.
function refreshItinerary(data){
  data.itinerary = generateItinerary(data);
  persistData(data);
  renderItinerary(data);
}
