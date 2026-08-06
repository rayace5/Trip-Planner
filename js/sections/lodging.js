// Section: Lodging options — 2–3 per-stop stays matched to trip style and traveler mix, one recommended.
'use strict';

// ---------- Lodging options (per stop) ----------
// Deterministic v1: honest archetype stays (never fabricated hotel names)
// built from a per-city dataset of real neighborhoods (CITY_LODGING in
// js/shared/data.js), with a clearly-"estimated" generic fallback for cities
// we don't have on file. Prices are honest round numbers PER NIGHT, scaled by
// the destination's cost level (LODGING_COST_BASES × per-archetype factor).
// Exactly one option per stop is Recommended:
//   - the trip style picks the winning archetype (relaxation → the quiet/
//     resort-ish stay; cultural → the walkable central/historic base;
//     adventure → the best activities base; balanced → the best
//     price-for-location balance), and
//   - the traveler mix nudges the scoring — kids (checkbox or parsed from
//     "who's going") boost family-suitable options, accessibility needs
//     (checkbox or parsed from constraints) boost step-free-friendly ones —
// with the reason and option wording reflecting only what actually fired.
var LODGING_KID_REQ = 'Kid-friendly';
var LODGING_ACCESS_REQ = 'Accessible for people with limited mobility';

// Archetype defaults: display name, honest generic trade-off, and the price
// factor applied to the city's per-night cost base. Per-city options override
// name/location (and occasionally the trade-off) with real neighborhoods.
var LODGING_ROLE_DEFAULTS = {
  central: { name:'City-center hotel', factor:1.3,
    tradeoff:'Most central, but the priciest of the three and busiest at street level' },
  quiet:   { name:'Quiet neighborhood guesthouse', factor:1.0,
    tradeoff:'Calmer nights and more character, but a walk or short ride to the main sights' },
  value:   { name:'Budget-friendly chain near transit', factor:0.7,
    tradeoff:'Best price of the three, but plainer and a commute to the center' }
};

// Trip style → favored archetype + recommendation wording. Adventure's role
// is resolved per city (entry.activityBase, default 'central').
var LODGING_STYLE_RULES = {
  'Relaxation': { role:'quiet',
    reason:'Quietest of the three — the easiest place to actually unwind, matching your relaxation focus' },
  'Adventure': { role:null,
    reason:'Well-placed base for early starts and day activities — matching your adventure focus' },
  'Cultural exploration': { role:'central',
    reason:'Walkable to the historic center and the main sights — the best base for cultural exploration' },
  'Balanced mix': { role:'quiet',
    reason:'Best price-for-location balance of the three for a balanced trip' }
};

function matchCityLodging(stopName){
  var t = String(stopName || '').toLowerCase();
  for (var i = 0; i < CITY_LODGING.length; i++){
    for (var k = 0; k < CITY_LODGING[i].keywords.length; k++){
      if (t.indexOf(CITY_LODGING[i].keywords[k]) !== -1) return CITY_LODGING[i];
    }
  }
  return null;
}

// Kids in the party: the Kid-friendly checkbox, or kids parsed out of the
// free-text "who's going" answer.
function lodgingHasKids(data){
  if ((data.otherRequirements || []).indexOf(LODGING_KID_REQ) !== -1) return true;
  var who = (data.travelers && data.travelers.whoIsGoing) || '';
  return /\b(kids?|child(?:ren)?|toddlers?|bab(?:y|ies)|infants?|family)\b/i.test(who);
}

// Accessibility need: the accessibility checkbox, or mobility keywords in the
// free-text constraints answer.
function lodgingWantsAccess(data){
  if ((data.otherRequirements || []).indexOf(LODGING_ACCESS_REQ) !== -1) return true;
  var c = (data.travelers && data.travelers.constraints) || '';
  return /wheelchair|mobilit|step[- ]?free|stairs|walker|accessib/i.test(c);
}

function lodgingCostLevel(stopName, entry){
  if (entry && entry.cost) return entry.cost;
  var prof = matchRegionProfile(String(stopName || ''));
  return (prof && LODGING_REGION_COST[prof.name]) || 'mid';
}

function generateLodgingOptions(stop, data){
  var stopName = String((stop && stop.name) || stop || '').trim();
  data = data || {};
  var entry = matchCityLodging(stopName);
  var estimated = !entry;
  var base = LODGING_COST_BASES[lodgingCostLevel(stopName, entry)] || LODGING_COST_BASES.mid;
  var hasKids = lodgingHasKids(data);
  var wantsAccess = lodgingWantsAccess(data);
  var style = data.tripStyle || 'Balanced mix';
  var rule = LODGING_STYLE_RULES[style] || LODGING_STYLE_RULES['Balanced mix'];
  var favoredRole = rule.role || (entry && entry.activityBase) || 'central';

  // Unknown cities get honest generic archetypes — no invented neighborhoods.
  var specs = entry ? entry.options : [
    { role:'central', name:'City-center hotel',
      location:'Central ' + stopName + ', walkable to the main sights' },
    { role:'quiet', name:'Quiet neighborhood guesthouse',
      location:'Residential neighborhood, a short ride to the center' },
    { role:'value', name:'Budget-friendly chain near transit',
      location:'Near a transit stop with a quick connection to the center' }
  ];

  var options = specs.map(function(spec){
    var d = LODGING_ROLE_DEFAULTS[spec.role];
    // Role defaults: quiet stays (guesthouses/resorts) suit families; central
    // and value stays (modern hotels/chains) are the step-free-friendly ones.
    // Per-city data overrides both (e.g. historic/hilly stays → access:false).
    var familyFit = spec.family != null ? !!spec.family : spec.role === 'quiet';
    var accessFit = spec.access != null ? !!spec.access : spec.role !== 'quiet';
    var location = spec.location;
    var tradeoff = spec.tradeoff || d.tradeoff;
    if (wantsAccess){
      if (accessFit) location += ' · elevator and step-free rooms typically available';
      else tradeoff += '; stairs are likely and elevators aren\'t a given — confirm step-free access before booking';
    }
    if (hasKids && familyFit) location += ' · family rooms and extra space are easier to find here';
    if (estimated) tradeoff += ' — typical rates for the area, not a checked listing';
    return {
      role: spec.role,
      name: spec.name || d.name,
      pricePerNight: roundTo5(base * d.factor),
      location: location,
      tradeoff: tradeoff,
      familyFit: familyFit,
      accessFit: accessFit,
      estimated: estimated,
      recommended: false,
      recommendedReason: null
    };
  });

  // Score: style +3 to the favored archetype; traveler mix +2 boosts for
  // family fit (kids present) and step-free fit (accessibility need).
  // Highest score wins; ties go to the earlier option in the list.
  var bestIdx = 0, bestScore = -1;
  options.forEach(function(o, i){
    var score = 0;
    if (o.role === favoredRole) score += 3;
    if (hasKids && o.familyFit) score += 2;
    if (wantsAccess && o.accessFit) score += 2;
    o.matchScore = score;
    if (score > bestScore){ bestScore = score; bestIdx = i; }
  });

  var win = options[bestIdx];
  var reason = rule.reason;
  if (hasKids && win.familyFit) reason += ' — and a comfortable fit with kids in tow';
  if (wantsAccess && win.accessFit) reason += ' — with step-free access typically available';
  if (estimated){
    reason += ' (we don\'t have ' + stopName + ' lodging on file — areas and rates are rough estimates)';
  }
  win.recommended = true;
  win.recommendedReason = reason;
  return options;
}

// Exposed for testing (pure/deterministic given the intake data).
window.generateLodgingOptions = generateLodgingOptions;

// One lodging set per stop on the active route (known-mode stop list, or the
// selected flexible option) — single-stop trips get one set. Selection
// defaults to the recommended option; when rebuilding (e.g. after switching a
// flexible destination option), a previous selection is kept for any city
// that survived and still offers that option. Nights edits never regenerate
// lodging (same cities — the budget story multiplies nights × price/night).
function buildLodging(data, prevLodging){
  var stops = activeStops(data);
  return stops.map(function(stop){
    var options = generateLodgingOptions(stop, data);
    var rec = null;
    options.forEach(function(o){ if (!rec && o.recommended) rec = o; });
    var selected = rec ? rec.name : (options[0] ? options[0].name : null);
    if (prevLodging){
      for (var k = 0; k < prevLodging.length; k++){
        var p = prevLodging[k];
        if (p.stop === stop.name &&
            options.some(function(o){ return o.name === p.selected; })){
          selected = p.selected;
          break;
        }
      }
    }
    return { stop: stop.name, options: options, selected: selected };
  });
}

// Rendered after the inter-city legs (mockup order): "STOP N · <CITY>" pill +
// "Lodging options" heading + option cards per stop, recommended pre-selected,
// click-to-select per stop.
function renderLodging(data){
  var section = $('lodgingSection');
  var container = $('lodgingContainer');
  container.innerHTML = '';
  var lodging = data.lodging || [];
  if (!lodging.length){
    section.classList.remove('visible');
    return;
  }
  lodging.forEach(function(entry, li){
    var block = document.createElement('div');
    block.className = 'leg-block';
    block.setAttribute('data-lodging-stop-index', String(li));
    block.setAttribute('data-lodging-stop', entry.stop);

    var label = document.createElement('div');
    label.className = 'leg-label';
    label.textContent = 'STOP ' + (li + 1) + ' · ' + entry.stop.toUpperCase();
    block.appendChild(label);

    var heading = document.createElement('div');
    heading.className = 'section-heading';
    heading.innerHTML = '<h2>Lodging options</h2>';
    block.appendChild(heading);

    var grid = document.createElement('div');
    grid.className = 'card-grid';
    var selIdx = 0;
    for (var si = 0; si < entry.options.length; si++){
      if (entry.options[si].name === entry.selected){ selIdx = si; break; }
    }
    entry.options.forEach(function(opt, oi){
      var card = document.createElement('div');
      card.className = 'option-card' + (oi === selIdx ? ' selected' : '');
      card.setAttribute('role', 'button');
      card.setAttribute('data-lodging-option-index', String(oi));
      card.setAttribute('data-lodging-option-role', opt.role);
      card.setAttribute('data-lodging-option-name', opt.name);
      card.innerHTML =
        (opt.recommended ? '<span class="rec-badge">RECOMMENDED</span>' : '') +
        '<div class="select-dot"></div>' +
        '<div class="name">' + escapeHtml(opt.name) + '</div>' +
        '<div class="price">$' + opt.pricePerNight + ' <span>/ night</span></div>' +
        '<div class="detail">' + escapeHtml(opt.location) + '</div>' +
        '<div class="tradeoff">' + escapeHtml(opt.tradeoff) + '</div>' +
        (opt.recommended ? '<div class="tradeoff rec">' + escapeHtml(opt.recommendedReason) + '</div>' : '');
      card.addEventListener('click', function(){
        grid.querySelectorAll('.option-card').forEach(function(c){ c.classList.remove('selected'); });
        card.classList.add('selected');
        entry.selected = opt.name;
        persistData(data);
      });
      grid.appendChild(card);
    });
    block.appendChild(grid);
    container.appendChild(block);
  });
  section.classList.add('visible');
}
