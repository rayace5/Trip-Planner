// Section: Budget rollup — itemized estimate vs the stated budget with clear over/under flags.
'use strict';

// ---------- Budget rollup ----------
// Deterministic v1: every line is computed from data the trip already carries —
//   flights      the SELECTED arrival option's group price (per-person × travelers),
//   inter-city   the SELECTED option's group price per leg, summed (own line
//                only when the trip has inter-city legs),
//   lodging      selected option's price/night × that stop's nights, summed
//                across stops with a per-stop breakdown,
//   activities   $10/$20/$30/$35 per activity per person by the city's cost
//                level (low/mid/high/premium — the same levels the lodging
//                story uses), counting the itinerary's non-meal, non-logistics
//                entries,
//   food         $25/$45/$65/$80 per day per person by the day's city cost
//                level (naturally blended across stops by nights),
//   local        $8/$12/$16/$18 per day per person by the day's city cost level,
//   misc         8% of the subtotal, rounded to $5.
// The stated budget is normalized for a like-for-like comparison: a per-person
// budget is multiplied by the traveler count, and when the user said flights &
// lodging are budgeted separately the comparison subtotal EXCLUDES the
// flights/inter-city/lodging lines (the lines still render — the vs row and a
// footnote say exactly what was compared, so the logic isn't buried).
// Over-budget is flagged at the summary level (confirmation-card budget
// badge), on the total/vs rows, and at the line level: comparison lines whose
// amount exceeds an equal share of the stated budget get a warn-colored
// "top overage driver" tag.

// Per-activity, per-day-food, and per-day-local-transport estimates per
// person by destination cost level.
var BUDGET_ACTIVITY_TIERS = { low: 10, mid: 20, high: 30, premium: 35 };
var BUDGET_FOOD_TIERS = { low: 25, mid: 45, high: 65, premium: 80 };
var BUDGET_LOCAL_TIERS = { low: 8, mid: 12, high: 16, premium: 18 };

var BUDGET_MISC_RATE = 0.08; // misc/buffer share of the subtotal

// Itinerary entries that are logistics, not paid activities: transit,
// check-in/out, airport runs, rest blocks. Meals are excluded via entry.meal.
var BUDGET_LOGISTICS_RE = /check[ -]?in|check out|store your bags|airport|rest block|free time|drop bags|\bfly\b|\bland\b/i;

// Same cost level the lodging options use (per-city dataset, else the
// region profile mapping, else 'mid').
function budgetCostLevel(stopName){
  return lodgingCostLevel(stopName, matchCityLodging(stopName));
}

function budgetIsActivityEntry(entry){
  if (!entry || entry.meal || entry.travel) return false;
  return !BUDGET_LOGISTICS_RE.test(String(entry.title || ''));
}

function budgetSelectedOption(options, selected, field){
  var sel = null;
  (options || []).forEach(function(o){ if (!sel && o[field] === selected) sel = o; });
  return sel || (options && options[0]) || null;
}

// Pure/deterministic given the intake data. Returns:
//   { lines: [{ key, label, amount, perStop?, overShare?, excludedFromComparison }],
//     total, statedBudget, delta, over, comparisonTotal, travelers, scope,
//     flightsLodging, statedAmount }
// delta = comparisonTotal − statedBudget (positive means over budget).
function computeBudget(data){
  data = data || {};
  var travelers = parseTravelerCount(data.travelers && data.travelers.whoIsGoing);
  var stops = data.destination ? activeStops(data) : [];
  var lines = [];

  // Flights — arrival leg (group price of the selected option).
  var af = data.arrivalFlight;
  if (af && af.options && af.options.length){
    var flightSel = budgetSelectedOption(af.options, af.selected, 'label');
    lines.push({
      key: 'flights',
      label: 'Flights — arrival leg (' + travelers + (travelers === 1 ? ' traveler' : ' travelers') + ')',
      amount: flightSel.priceGroup
    });
  }

  // Inter-city transport (own line only for multi-stop trips with legs).
  var legs = data.legs || [];
  if (legs.length){
    var legSum = 0;
    legs.forEach(function(leg){
      var sel = budgetSelectedOption(leg.options, leg.selected, 'label');
      if (sel) legSum += sel.price;
    });
    var route = legs[0].from + legs.map(function(l){ return ' → ' + l.to; }).join('');
    lines.push({ key: 'intercity', label: 'Inter-city transport — ' + route, amount: legSum });
  }

  // Lodging: selected option's price/night × the stop's nights, summed with
  // a per-stop breakdown (rendered as per-stop rows like the mockup).
  var lodging = data.lodging || [];
  if (lodging.length){
    function nightsFor(stopName){
      for (var i = 0; i < stops.length; i++){
        if (stops[i].name === stopName) return Math.max(1, parseInt(stops[i].nights, 10) || 1);
      }
      return 1;
    }
    var perStop = lodging.map(function(entry){
      var opt = budgetSelectedOption(entry.options, entry.selected, 'name');
      var nights = nightsFor(entry.stop);
      var rate = opt ? opt.pricePerNight : 0;
      return { stop: entry.stop, nights: nights, pricePerNight: rate, amount: rate * nights };
    });
    var lodgingSum = perStop.reduce(function(s, p){ return s + p.amount; }, 0);
    lines.push({ key: 'lodging', label: 'Lodging', amount: lodgingSum, perStop: perStop });
  }

  // Itinerary-driven estimates: each day is priced at its own city's cost
  // level, so multi-stop trips blend across stops by nights automatically.
  var days = (data.itinerary && data.itinerary.days) || [];
  if (days.length){
    var actAmount = 0, foodAmount = 0, localAmount = 0;
    days.forEach(function(day){
      var level = budgetCostLevel(day.stop);
      foodAmount += BUDGET_FOOD_TIERS[level] || BUDGET_FOOD_TIERS.mid;
      localAmount += BUDGET_LOCAL_TIERS[level] || BUDGET_LOCAL_TIERS.mid;
      (day.entries || []).forEach(function(e){
        if (budgetIsActivityEntry(e)) actAmount += BUDGET_ACTIVITY_TIERS[level] || BUDGET_ACTIVITY_TIERS.mid;
      });
    });
    lines.push({ key: 'activities', label: 'Activities & tickets', amount: actAmount * travelers });
    lines.push({ key: 'food', label: 'Food', amount: foodAmount * travelers });
    lines.push({ key: 'local', label: 'Local transport', amount: localAmount * travelers });
  }

  var subtotal = lines.reduce(function(s, l){ return s + l.amount; }, 0);
  if (lines.length){
    lines.push({ key: 'misc', label: 'Misc / buffer', amount: roundTo5(subtotal * BUDGET_MISC_RATE) });
  }
  var total = lines.reduce(function(s, l){ return s + l.amount; }, 0);

  // Stated-budget normalization for a like-for-like comparison.
  var statedAmount = data.budget ? data.budget.amount : null;
  var scope = (data.budget && data.budget.scope) || 'per-person';
  var flightsLodging = (data.budget && data.budget.flightsLodging) || 'included';
  var statedBudget = (typeof statedAmount === 'number' && isFinite(statedAmount) && statedAmount > 0)
    ? (scope === 'per-person' ? statedAmount * travelers : statedAmount)
    : null;

  var excludedKeys = flightsLodging === 'separate' ? ['flights', 'intercity', 'lodging'] : [];
  var comparisonTotal = 0;
  lines.forEach(function(l){
    l.excludedFromComparison = excludedKeys.indexOf(l.key) !== -1;
    if (!l.excludedFromComparison) comparisonTotal += l.amount;
  });

  var delta = statedBudget != null ? comparisonTotal - statedBudget : null;
  var over = delta != null && delta > 0;

  // Line-item-level flags (only when over): comparison lines whose amount
  // exceeds an equal share of the stated budget are the top overage drivers.
  if (over){
    var compLines = lines.filter(function(l){ return !l.excludedFromComparison; });
    var share = statedBudget / compLines.length;
    compLines.forEach(function(l){ if (l.amount > share) l.overShare = true; });
  }

  return {
    lines: lines,
    total: total,
    statedBudget: statedBudget,
    delta: delta,
    over: over,
    comparisonTotal: comparisonTotal,
    travelers: travelers,
    scope: scope,
    flightsLodging: flightsLodging,
    statedAmount: statedAmount
  };
}

// Exposed for testing (pure/deterministic given the intake data).
window.computeBudget = computeBudget;

// Persisted shape: computeBudget(...) plus the research date (PRD freshness
// disclaimer: prices are as of the planning session, not live).
function buildBudgetRollup(data){
  var b = computeBudget(data);
  b.asOf = toISODate(new Date());
  return b;
}

function fmtBudgetMoney(n){
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ---------- Rendering ----------
// Mockup budget-box after the itinerary: line rows (lodging as per-stop
// rows), total row, "vs. stated budget" row (green under / warn-red over),
// plus the summary-level budget badge on the confirmation card and the
// "Prices as of" freshness note.
function renderBudgetRollup(data){
  var section = $('budgetRollupSection');
  var box = $('budgetBox');
  var note = $('budgetFreshnessNote');
  var badge = $('budgetBadge');
  box.innerHTML = '';
  var b = data.budgetRollup;
  if (!b || !b.lines || !b.lines.length){
    section.classList.remove('visible');
    badge.classList.remove('visible');
    badge.textContent = '';
    note.textContent = '';
    return;
  }

  function row(cls, labelHtml, amtHtml, attrs){
    var r = document.createElement('div');
    r.className = 'budget-row' + (cls ? ' ' + cls : '');
    r.innerHTML = '<div class="label">' + labelHtml + '</div><div class="amt">' + amtHtml + '</div>';
    if (attrs){ for (var k in attrs){ if (attrs.hasOwnProperty(k)) r.setAttribute(k, attrs[k]); } }
    box.appendChild(r);
    return r;
  }
  var overTag = '<span class="over-flag">top overage driver</span>';

  b.lines.forEach(function(line){
    if (line.key === 'lodging' && line.perStop){
      // Per-stop lodging rows (mockup's separate Austin/Dallas lodging lines).
      line.perStop.forEach(function(ps){
        row(line.overShare ? 'over-share' : '',
          escapeHtml('Lodging — ' + ps.stop + ' (' + pluralNights(ps.nights) + ')') + (line.overShare ? overTag : ''),
          '$' + fmtBudgetMoney(ps.amount),
          { 'data-budget-line': 'lodging', 'data-budget-stop': ps.stop, 'data-budget-amount': String(ps.amount) });
      });
      return;
    }
    row(line.overShare ? 'over-share' : '',
      escapeHtml(line.label) + (line.overShare ? overTag : ''),
      '$' + fmtBudgetMoney(line.amount),
      { 'data-budget-line': line.key, 'data-budget-amount': String(line.amount) });
  });

  row('total' + (b.over ? ' over' : ''), 'Total estimate', '$' + fmtBudgetMoney(b.total),
    { 'data-budget-total': String(b.total), 'data-budget-over': b.over ? 'true' : 'false' });

  if (b.statedBudget != null){
    // Flights & lodging budgeted separately → the comparison uses the
    // on-the-ground subtotal, shown explicitly so the logic isn't buried.
    if (b.flightsLodging === 'separate'){
      row('compare-subtotal', 'On-the-ground subtotal (what your budget covers)',
        '$' + fmtBudgetMoney(b.comparisonTotal),
        { 'data-budget-line': 'comparison-subtotal', 'data-budget-amount': String(b.comparisonTotal) });
    }
    var vsLabel = 'vs. stated budget (' + (b.scope === 'per-person'
      ? '$' + fmtBudgetMoney(b.statedAmount) + '/person × ' + b.travelers +
        (b.travelers === 1 ? ' traveler' : ' travelers') + ' = $' + fmtBudgetMoney(b.statedBudget)
      : '$' + fmtBudgetMoney(b.statedBudget)) + ')';
    if (b.flightsLodging === 'separate') vsLabel += ' — flights & lodging excluded (budgeted separately)';
    var amtCls, amtText;
    if (b.delta > 0){ amtCls = 'over'; amtText = '+$' + fmtBudgetMoney(b.delta) + ' over'; }
    else if (b.delta < 0){ amtCls = 'under'; amtText = '−$' + fmtBudgetMoney(-b.delta) + ' under'; }
    else { amtCls = 'under'; amtText = 'right at budget'; }
    var vs = row('vs', escapeHtml(vsLabel), escapeHtml(amtText),
      { 'data-budget-vs': 'true', 'data-budget-delta': String(b.delta), 'data-budget-over': b.over ? 'true' : 'false' });
    vs.querySelector('.amt').classList.add(amtCls);

    if (b.flightsLodging === 'separate'){
      var fn = document.createElement('div');
      fn.className = 'budget-footnote';
      fn.textContent = 'You told us flights & lodging are budgeted separately — the flight, inter-city transport, and lodging lines above are shown for reference but aren\'t counted against your stated budget.';
      box.appendChild(fn);
    }
  }

  // PRD freshness disclaimer, dated to the persisted research date.
  note.innerHTML = '🕒 Prices as of ' + escapeHtml(formatISODate(b.asOf)) +
    ' — research is refreshed each planning session, not live.';

  // Summary-level flag: the confirmation card's budget badge (mockup
  // trip-hero .budget-badge) — green under budget, warn-red over.
  if (b.statedBudget != null){
    var badgeText = '$' + fmtBudgetMoney(b.comparisonTotal) + ' / $' + fmtBudgetMoney(b.statedBudget);
    if (b.over) badgeText += ' — $' + fmtBudgetMoney(b.delta) + ' over';
    badge.textContent = badgeText;
    badge.classList.toggle('over', b.over);
    badge.setAttribute('data-budget-over', b.over ? 'true' : 'false');
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
    badge.textContent = '';
  }

  section.classList.add('visible');
}

// Recompute + persist + re-render in one step — called whenever a selection
// the budget depends on changes (lodging picks; other paths recompute inline
// alongside the itinerary refresh).
function refreshBudgetRollup(data){
  data.budgetRollup = buildBudgetRollup(data);
  persistData(data);
  renderBudgetRollup(data);
}
