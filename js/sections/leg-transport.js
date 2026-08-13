// Section: Inter-city transport legs — 2–3 options per consecutive stop pair with one recommended pick,
// plus unreasonable/unverified-connection flagging (classifyLegConnection).
'use strict';

// ---------- Inter-city transport legs ----------
// Deterministic v1: for each consecutive pair of stops in the active route,
// propose 2–3 transport options across modes (drive / train / flight — plus
// ferry for one island pair) from a small honest city-pair dataset, with a
// generic clearly-"estimated" fallback for unknown pairs. Exactly one option
// per leg is Recommended with a stated reason:
//   1. short hop (drive ≤ ~4.5h and no faster train) → drive, most flexible;
//   2. usable train (≤ ~4.5h city-center to city-center) → train;
//   3. otherwise → fastest door-to-door option (usually flight).
// "No rental car" in Other Requirements excludes drive options entirely; if
// drive would have won, the recommendation falls to the next best and the
// reason says so. Prices are honest round numbers PER GROUP: per-person
// fares × traveler count for train/flight/ferry, per-car pricing for drive
// (one rental per 4 travelers).
var NO_RENTAL_REQ = 'No rental car';

var LEG_MODE_LABELS = { drive:'Drive (rental car)', train:'Train', flight:'Nonstop flight', ferry:'Ferry' };
var LEG_MODE_TRADEOFFS = {
  drive:'Full flexibility for detours, but fuel, tolls, and parking are on you',
  train:'Relaxed and city-center to city-center, but fixed departure times',
  flight:'Shortest time in the air, but airport time and luggage limits add up',
  ferry:'Scenic and cheap, but slow and weather-dependent'
};

function matchCityPair(fromName, toName){
  var f = String(fromName || '').toLowerCase();
  var t = String(toName || '').toLowerCase();
  function hits(keys, text){
    return keys.some(function(k){ return text.indexOf(k) !== -1; });
  }
  for (var i = 0; i < CITY_PAIRS.length; i++){
    var p = CITY_PAIRS[i];
    if ((hits(p.a, f) && hits(p.b, t)) || (hits(p.a, t) && hits(p.b, f))) return p;
  }
  return null;
}

function legOptionPrice(spec, travelers){
  if (spec.base != null) return roundTo5(spec.base * Math.ceil(travelers / 4)); // per rental car
  return roundTo5(spec.fare * travelers); // per-person fare × group
}

function buildLegOption(mode, spec, travelers, estimated){
  return {
    mode: mode,
    label: spec.label || LEG_MODE_LABELS[mode],
    hrs: spec.hrs,
    duration: spec.dur,
    price: legOptionPrice(spec, travelers),
    detail: spec.detail || '',
    tradeoff: spec.tradeoff || LEG_MODE_TRADEOFFS[mode],
    estimated: !!estimated,
    recommended: false,
    recommendedReason: null
  };
}

// Recommendation rules (see block comment above). Returns { index, reason }.
function pickRecommendedLegOption(options){
  var drive = null, train = null;
  options.forEach(function(o, i){
    if (o.mode === 'drive' && !drive) drive = { o: o, i: i };
    if (o.mode === 'train' && !train) train = { o: o, i: i };
  });
  if (drive && drive.o.hrs <= 4.5 && (!train || train.o.hrs >= drive.o.hrs)){
    var cheapest = options.every(function(o){ return o === drive.o || o.price >= drive.o.price; });
    var approxH = Math.max(1, Math.round(drive.o.hrs));
    return { index: drive.i, reason: (cheapest ? 'Cheapest and most flexible' : 'Most flexible') +
      ' for a ~' + approxH + '-hour hop — door-to-door on your own schedule' };
  }
  if (train && train.o.hrs <= 4.5){
    return { index: train.i, reason: 'Fast city-center to city-center — no airport overhead' };
  }
  var fi = 0;
  options.forEach(function(o, i){ if (o.hrs < options[fi].hrs) fi = i; });
  return { index: fi, reason: 'Fastest door-to-door option for this leg' };
}

function generateLegOptions(fromStop, toStop, data){
  var fromName = (fromStop && fromStop.name) || fromStop || '';
  var toName = (toStop && toStop.name) || toStop || '';
  data = data || {};
  var travelers = parseTravelerCount(data.travelers && data.travelers.whoIsGoing);
  var noRental = (data.otherRequirements || []).indexOf(NO_RENTAL_REQ) !== -1;
  var pair = matchCityPair(fromName, toName);
  var src = pair || GENERIC_LEG;
  var estimated = !pair;

  var all = [];
  ['drive', 'train', 'flight', 'ferry'].forEach(function(mode){
    if (src[mode]) all.push(buildLegOption(mode, src[mode], travelers, estimated));
  });

  // PRD: "no rental car" checked -> drive options excluded for the leg.
  var driveExcluded = noRental && all.some(function(o){ return o.mode === 'drive'; });
  var options = noRental ? all.filter(function(o){ return o.mode !== 'drive'; }) : all.slice();

  // Every leg gets at least 2 options: top up from the generic set with a
  // mode the leg doesn't already have (clearly marked as estimated).
  ['train', 'flight'].forEach(function(mode){
    if (options.length >= 2) return;
    if (options.some(function(o){ return o.mode === mode; })) return;
    options.push(buildLegOption(mode, GENERIC_LEG[mode], travelers, true));
  });

  var pick = pickRecommendedLegOption(options);
  var reason = pick.reason;
  var noRentalCompromise = false;
  if (driveExcluded){
    // Disclose the constraint whenever the drive would have won the
    // pre-exclusion recommendation (length comparisons don't work here:
    // the generic top-up can restore the option count).
    var unfiltered = pickRecommendedLegOption(all);
    if (all[unfiltered.index].mode === 'drive'){
      reason += ' — drive excluded per your "No rental car" preference';
      noRentalCompromise = true;
    }
  }
  if (options[pick.index].estimated){
    reason += ' (times and prices are rough estimates for this route)';
  }
  options[pick.index].recommended = true;
  options[pick.index].recommendedReason = reason;
  // Flag the compromise for the results-page conflict banner (see
  // detectConflictWarnings in js/sections/destination-options.js).
  if (noRentalCompromise) options[pick.index].noRentalCompromise = true;
  return options;
}

// Exposed for testing (pure/deterministic given the intake data).
window.generateLegOptions = generateLegOptions;

// ---------- Unreasonable-connection detection ----------
// PRD edge case: stops with no reasonable inter-city connection are surfaced
// as a trade-off — never silently routed around. A leg is flagged when the
// best it can offer is a very long haul (> LONG_LEG_HRS door-to-door) and
// there is no verified (non-estimated) flight or train to shortcut it:
//   verified-long   — real data shows the connection is genuinely long
//                     (fastest verified option > 8h, e.g. a drive-only pair,
//                     or a known pair whose fastest real option runs long);
//   unverified-long — the pair isn't on file at all and every estimated
//                     option runs long, so the app honestly cannot promise a
//                     reasonable connection exists. The wording says the leg
//                     is UNVERIFIED (the options are guesses) rather than
//                     claiming the route is bad.
// Known CITY_PAIRS are all reasonable by construction today, so this mainly
// guards long drive-only combinations and long estimated fallbacks; the
// verified-long paths also cover future data. Classification looks only at
// the leg's option set, so switching the selected option never changes it.
// Warn-and-continue: the options still render and stay selectable.
var LONG_LEG_HRS = 8;

var LEG_SLOW_MODE_NOUNS = { drive:'drive', ferry:'ferry crossing', train:'train ride', flight:'flight' };

// Returns null (reasonable / nothing to flag) or { kind, reason }.
function classifyLegConnection(options, fromName, toName){
  if (!options || !options.length) return null;
  var route = fromName + ' → ' + toName;
  var fastest = options[0];
  options.forEach(function(o){ if (o.hrs < fastest.hrs) fastest = o; });
  var real = options.filter(function(o){ return !o.estimated; });
  var hasRealFast = real.some(function(o){ return o.mode === 'flight' || o.mode === 'train'; });

  if (hasRealFast){
    // A direct flight/train is on file: only flag if even the fastest
    // option is a genuinely long day (verified — the data is real).
    if (fastest.hrs <= LONG_LEG_HRS) return null;
    return { kind: 'verified-long', reason:
      'Even the fastest option on file for ' + route + ' runs ≈' + Math.round(fastest.hrs) +
      'h door-to-door — a long travel day. Consider an intermediate stop to break it up.' };
  }
  if (real.length){
    // No direct flight/train on file, but real data exists (e.g. a
    // drive-only pair): flag when the fastest VERIFIED option runs long —
    // estimated top-ups are guesses and don't count as a shortcut.
    var fastestReal = real[0];
    real.forEach(function(o){ if (o.hrs < fastestReal.hrs) fastestReal = o; });
    if (fastestReal.hrs <= LONG_LEG_HRS) return null;
    var hasEstimates = options.some(function(o){ return o.estimated; });
    return { kind: 'verified-long', reason:
      'No direct flight or train on file for ' + route + ' — the only verified option is a ≈' +
      Math.round(fastestReal.hrs) + 'h ' + (LEG_SLOW_MODE_NOUNS[fastestReal.mode] || 'trip') +
      (hasEstimates ? ', and the other options shown are unverified estimates' : '') +
      '. Consider checking real flight or train schedules, or adding an intermediate stop.' };
  }
  // Unknown pair — everything is estimated. We can't know real durations,
  // so only flag when even the guesses run long, and say so honestly.
  if (fastest.hrs <= LONG_LEG_HRS) return null;
  return { kind: 'unverified-long', reason:
    "We don't have route data for " + route + ' — no direct flight or train is on file, and every ' +
    'estimated option runs ≈' + Math.round(fastest.hrs) + 'h or more, so the options above are ' +
    'long-haul guesses. Check real schedules, or consider an intermediate stop.' };
}

// Exposed for testing (pure given an option set).
window.classifyLegConnection = classifyLegConnection;

// One leg per consecutive stop pair on the active route. Selection defaults
// to the recommended option; when rebuilding (e.g. after switching a flexible
// destination option), a previous selection is kept if the same from→to leg
// still exists and still offers that option.
function buildLegs(data, prevLegs){
  var stops = activeStops(data);
  var legs = [];
  for (var i = 0; i + 1 < stops.length; i++){
    var from = stops[i].name, to = stops[i + 1].name;
    var options = generateLegOptions(from, to, data);
    var rec = null;
    options.forEach(function(o){ if (!rec && o.recommended) rec = o; });
    var selected = rec ? rec.label : (options[0] ? options[0].label : null);
    if (prevLegs){
      for (var k = 0; k < prevLegs.length; k++){
        var p = prevLegs[k];
        if (p.from === from && p.to === to &&
            options.some(function(o){ return o.label === p.selected; })){
          selected = p.selected;
          break;
        }
      }
    }
    // Unreasonable/unverified-connection flag (null when the leg is fine).
    // Recomputed on every rebuild (submit, destination-option switch); it
    // depends only on the option set, so in-leg selection changes never
    // alter it.
    legs.push({ from: from, to: to, options: options, selected: selected,
      connectionWarning: classifyLegConnection(options, from, to) });
  }
  return legs;
}

// Leg numbering starts at 2: leg 1 is reserved for the arrival flight
// (origin → first stop), which is a separate later story — matching the
// mockup's "LEG 2 · AUSTIN → DALLAS (INTER-CITY)" labeling.
function renderLegs(data){
  var section = $('legsSection');
  var container = $('legsContainer');
  container.innerHTML = '';
  var legs = data.legs || [];
  if (!legs.length){
    section.classList.remove('visible');
    return;
  }
  legs.forEach(function(leg, li){
    var block = document.createElement('div');
    block.className = 'leg-block';
    block.setAttribute('data-leg-index', String(li));
    block.setAttribute('data-leg-from', leg.from);
    block.setAttribute('data-leg-to', leg.to);

    var label = document.createElement('div');
    label.className = 'leg-label';
    label.textContent = 'LEG ' + (li + 2) + ' · ' + leg.from.toUpperCase() + ' → ' + leg.to.toUpperCase() + ' (INTER-CITY)';
    block.appendChild(label);

    var heading = document.createElement('div');
    heading.className = 'section-heading';
    heading.innerHTML = '<h2>Inter-city transport options</h2>';
    block.appendChild(heading);

    var grid = document.createElement('div');
    grid.className = 'card-grid';
    var selIdx = 0;
    for (var si = 0; si < leg.options.length; si++){
      if (leg.options[si].label === leg.selected){ selIdx = si; break; }
    }
    leg.options.forEach(function(opt, oi){
      var card = document.createElement('div');
      card.className = 'option-card' + (oi === selIdx ? ' selected' : '');
      card.setAttribute('role', 'button');
      card.setAttribute('data-leg-option-index', String(oi));
      card.setAttribute('data-leg-option-mode', opt.mode);
      card.setAttribute('data-leg-option-label', opt.label);
      card.innerHTML =
        (opt.recommended ? '<span class="rec-badge">RECOMMENDED</span>' : '') +
        '<div class="select-dot"></div>' +
        '<div class="name">' + escapeHtml(opt.label) + '</div>' +
        '<div class="price">$' + opt.price + ' <span>total</span></div>' +
        '<div class="detail">' + escapeHtml(opt.duration + (opt.detail ? ' · ' + opt.detail : '')) + '</div>' +
        '<div class="tradeoff">' + escapeHtml(opt.tradeoff) + '</div>' +
        (opt.recommended ? '<div class="tradeoff rec">' + escapeHtml(opt.recommendedReason) + '</div>' : '');
      card.addEventListener('click', function(){
        grid.querySelectorAll('.option-card').forEach(function(c){ c.classList.remove('selected'); });
        card.classList.add('selected');
        leg.selected = opt.label;
        // The travel day's transit entry follows the selected leg option.
        refreshItinerary(data);
      });
      grid.appendChild(card);
    });
    block.appendChild(grid);

    // Inline connection warning under the leg's cards (warn-and-continue:
    // the options above stay fully selectable).
    if (leg.connectionWarning && leg.connectionWarning.reason){
      var warn = document.createElement('div');
      warn.className = 'leg-connection-warning';
      warn.setAttribute('role', 'note');
      warn.setAttribute('data-connection-warning-kind', leg.connectionWarning.kind);
      warn.innerHTML = '<span class="icon">⚠</span><span>' +
        escapeHtml(leg.connectionWarning.reason) + '</span>';
      block.appendChild(warn);
    }
    container.appendChild(block);
  });
  section.classList.add('visible');
}
