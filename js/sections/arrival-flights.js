// Section: Arrival flight options — LEG 1 (origin → first stop) with 2–3 fares and one recommended pick.
'use strict';

// ---------- Arrival flight options (LEG 1) ----------
// Deterministic v1: coarse distance tiering between the departure city and
// the first stop (keyword/region-profile matching — no fabricated airline
// schedules), producing 3 generic-but-plausible fare options per trip:
// a 1-stop budget fare, a nonstop morning flight, and a nonstop afternoon
// flight. Exactly one is Recommended with a stated reason (mockup logic:
// the nonstop arriving with usable Day-1 time beats cheapest-with-connection
// and pricier-later). Prices are honest round numbers PER PERSON, ROUND TRIP;
// the group total (per-person × traveler count) is persisted alongside for
// the budget rollup ("Flights — arrival leg (N travelers)"). Unknown
// origin/destination pairs fall back to a clearly-"estimated" medium-haul
// profile rather than pretending we know the route.

// Coarse world regions for haul tiering. The keyword lists cover common
// origin cities/airports that the destination-focused REGION_PROFILES don't.
var ORIGIN_REGIONS = [
  { key:'north-america', keywords:['chicago','ord','mdw','new york','nyc','jfk','lga','newark','ewr','boston','philadelphia',
    'washington','baltimore','atlanta','miami','orlando','tampa','charlotte','nashville','memphis','new orleans','detroit',
    'cleveland','columbus','pittsburgh','minneapolis','st louis','st. louis','kansas city','oklahoma city','denver','seattle',
    'portland','san francisco','sfo','oakland','san jose','sacramento','los angeles','lax','san diego','salt lake',
    'raleigh','indianapolis','cincinnati','milwaukee','honolulu','anchorage','toronto','vancouver','montreal','calgary',
    'usa','u.s.','united states','america','canada'] },
  { key:'east-asia', keywords:['korea','seoul','china','beijing','shanghai','hong kong','taiwan','taipei'] }
];

// Map the destination-focused REGION_PROFILES onto the same coarse keys.
var PROFILE_REGION_KEYS = {
  'Japan':'east-asia',
  'Europe':'europe',
  'Southeast Asia':'southeast-asia',
  'Mexico & Caribbean':'latin',
  'Australia & New Zealand':'oceania',
  'US Southwest & Texas':'north-america'
};

function regionKeyFor(placeText){
  var t = String(placeText || '').toLowerCase();
  if (!t) return null;
  for (var i = 0; i < ORIGIN_REGIONS.length; i++){
    for (var k = 0; k < ORIGIN_REGIONS[i].keywords.length; k++){
      if (t.indexOf(ORIGIN_REGIONS[i].keywords[k]) !== -1) return ORIGIN_REGIONS[i].key;
    }
  }
  var profile = matchRegionProfile(t);
  return profile ? (PROFILE_REGION_KEYS[profile.name] || null) : null;
}

// Symmetric haul matrix between coarse regions; null = unknown → estimated.
var HAUL_BY_REGION_PAIR = {
  'latin|north-america':'medium',
  'east-asia|southeast-asia':'medium',
  'oceania|southeast-asia':'medium',
  'europe|north-america':'long',
  'europe|latin':'long',
  'east-asia|oceania':'long',
  'east-asia|north-america':'ultra',
  'north-america|southeast-asia':'ultra',
  'north-america|oceania':'ultra',
  'east-asia|europe':'ultra',
  'europe|southeast-asia':'ultra',
  'europe|oceania':'ultra',
  'east-asia|latin':'ultra',
  'latin|southeast-asia':'ultra',
  'latin|oceania':'ultra'
};

function haulTier(fromKey, toKey){
  if (!fromKey || !toKey) return null;
  if (fromKey === toKey) return 'short'; // same-region hop
  return HAUL_BY_REGION_PAIR[[fromKey, toKey].sort().join('|')] || null;
}

// Per-tier durations and honest round-number PER-PERSON ROUND-TRIP fares.
var ARRIVAL_HAUL_PROFILES = {
  short:  { nonstopDur:'2h50m',  connectDur:'4h35m',  budgetFare:310,  nonstopFare:380,  lateFare:410 },
  medium: { nonstopDur:'3h50m',  connectDur:'6h20m',  budgetFare:430,  nonstopFare:495,  lateFare:545 },
  long:   { nonstopDur:'8h05m',  connectDur:'10h50m', budgetFare:780,  nonstopFare:895,  lateFare:965 },
  ultra:  { nonstopDur:'13h40m', connectDur:'17h30m', budgetFare:1160, nonstopFare:1345, lateFare:1440 },
  estimated: { nonstopDur:'≈4h (estimated)', connectDur:'≈6h30m (estimated)',
    budgetFare:420, nonstopFare:490, lateFare:530 }
};

function buildArrivalOption(spec, route, travelers, estimated){
  return {
    label: spec.label,
    depart: spec.depart,
    duration: spec.dur,
    detail: spec.detail + ', ' + route,
    pricePerPerson: spec.fare,
    priceGroup: spec.fare * travelers,
    tradeoff: spec.tradeoff,
    estimated: !!estimated,
    recommended: false,
    recommendedReason: null
  };
}

function generateArrivalFlights(departingFrom, firstStop, data){
  var fromName = String((departingFrom && departingFrom.name) || departingFrom || '').trim();
  var toName = String((firstStop && firstStop.name) || firstStop || '').trim();
  data = data || {};
  var travelers = parseTravelerCount(data.travelers && data.travelers.whoIsGoing);
  var tier = haulTier(regionKeyFor(fromName), regionKeyFor(toName));
  var estimated = !tier;
  var prof = ARRIVAL_HAUL_PROFILES[tier || 'estimated'];
  var route = fromName + '–' + toName;

  // Generic-but-plausible option shapes (mockup: cheapest-with-connection /
  // recommended morning nonstop / pricier afternoon nonstop) — labels never
  // claim a specific airline or schedule we haven't verified.
  var options = [
    buildArrivalOption({ label:'1-stop budget fare', depart:'8:10am', dur:prof.connectDur,
      detail:'1 stop en route', fare:prof.budgetFare,
      tradeoff:'Cheapest fare, but the connection adds time and misconnect risk' }, route, travelers, estimated),
    buildArrivalOption({ label:'Nonstop morning flight', depart:'9:45am', dur:prof.nonstopDur,
      detail:'Nonstop', fare:prof.nonstopFare,
      tradeoff:'Costs more than the 1-stop fare' }, route, travelers, estimated),
    buildArrivalOption({ label:'Nonstop afternoon flight', depart:'3:15pm', dur:prof.nonstopDur,
      detail:'Nonstop', fare:prof.lateFare,
      tradeoff:'Pricier, and the later arrival eats into Day 1' }, route, travelers, estimated)
  ];

  // Recommendation: the morning nonstop — best balance of price and a
  // usable first day (beats the cheaper connection and the pricier
  // later departure).
  var reason = 'Best balance — nonstop and lands with most of Day 1 still usable';
  if (estimated) reason += ' (times and prices are rough estimates for this route)';
  options[1].recommended = true;
  options[1].recommendedReason = reason;
  return options;
}

// Exposed for testing (pure/deterministic given the intake data).
window.generateArrivalFlights = generateArrivalFlights;

// The arrival leg is origin → first stop of the active route (known-mode
// stop list, or the selected flexible option). Selection defaults to the
// recommended option; when rebuilding (e.g. after switching a flexible
// destination option), a previous selection is kept if the origin →
// first-stop pair survived and still offers that option.
function buildArrivalFlight(data, prev){
  var from = String(data.departingFrom || '').trim();
  var stops = activeStops(data);
  if (!from || !stops.length) return null;
  var to = stops[0].name;
  var options = generateArrivalFlights(from, to, data);
  var rec = null;
  options.forEach(function(o){ if (!rec && o.recommended) rec = o; });
  var selected = rec ? rec.label : (options[0] ? options[0].label : null);
  if (prev && prev.from === from && prev.to === to &&
      options.some(function(o){ return o.label === prev.selected; })){
    selected = prev.selected;
  }
  return { from: from, to: to, travelers: parseTravelerCount(data.travelers && data.travelers.whoIsGoing),
    options: options, selected: selected };
}

// Rendered above the inter-city legs as "LEG 1 · <ORIGIN> → <FIRST STOP>
// (ARRIVAL)" — single-stop trips have just this section (no inter-city legs).
function renderArrivalFlight(data){
  var section = $('arrivalSection');
  var container = $('arrivalContainer');
  container.innerHTML = '';
  var af = data.arrivalFlight;
  if (!af || !af.options || !af.options.length){
    section.classList.remove('visible');
    return;
  }
  var block = document.createElement('div');
  block.className = 'leg-block';
  block.setAttribute('data-arrival-from', af.from);
  block.setAttribute('data-arrival-to', af.to);

  var label = document.createElement('div');
  label.className = 'leg-label';
  label.textContent = 'LEG 1 · ' + af.from.toUpperCase() + ' → ' + af.to.toUpperCase() + ' (ARRIVAL)';
  block.appendChild(label);

  var heading = document.createElement('div');
  heading.className = 'section-heading';
  heading.innerHTML = '<h2>Flight options</h2>';
  block.appendChild(heading);

  var grid = document.createElement('div');
  grid.className = 'card-grid';
  var selIdx = 0;
  for (var si = 0; si < af.options.length; si++){
    if (af.options[si].label === af.selected){ selIdx = si; break; }
  }
  af.options.forEach(function(opt, oi){
    var card = document.createElement('div');
    card.className = 'option-card' + (oi === selIdx ? ' selected' : '');
    card.setAttribute('role', 'button');
    card.setAttribute('data-flight-option-index', String(oi));
    card.setAttribute('data-flight-option-label', opt.label);
    card.innerHTML =
      (opt.recommended ? '<span class="rec-badge">RECOMMENDED</span>' : '') +
      '<div class="select-dot"></div>' +
      '<div class="name">' + escapeHtml(opt.label) + '</div>' +
      '<div class="price">$' + opt.pricePerPerson + ' <span>per person · round trip</span></div>' +
      '<div class="detail">' + escapeHtml('Depart ' + opt.depart + ' · ' + opt.duration + ' · ' + opt.detail) + '</div>' +
      '<div class="tradeoff">' + escapeHtml(opt.tradeoff) + '</div>' +
      (opt.recommended ? '<div class="tradeoff rec">' + escapeHtml(opt.recommendedReason) + '</div>' : '');
    card.addEventListener('click', function(){
      grid.querySelectorAll('.option-card').forEach(function(c){ c.classList.remove('selected'); });
      card.classList.add('selected');
      af.selected = opt.label;
      // Day 1's pacing follows the selected arrival flight.
      refreshItinerary(data);
    });
    grid.appendChild(card);
  });
  block.appendChild(grid);
  container.appendChild(block);
  section.classList.add('visible');
}
