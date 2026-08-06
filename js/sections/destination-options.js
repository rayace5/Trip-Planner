// Section: Destination options — flexible-destination proposals, scoring, and option cards.
'use strict';

// ---------- Destination options (flexible destinations) ----------
// Deterministic v1: map each entered region/country to concrete destination
// proposals from a small honest catalog (climate scored via the same
// REGION_PROFILES used for date resolution), rank them against the intake
// (trip style, other-requirements checkboxes, month/climate fit), and return
// 2–3 options with exactly one marked recommended. Unknown entries still
// yield an option built from the entry itself.
var ENGLISH_REQ = 'English predominantly spoken';
var BUCKET_REQ = 'Looking for popular bucket list destinations and activities';
var WALKABLE_REQS = ['No rental car', 'Walkable cities preferred'];
var ACCESS_REQ = 'Accessible for people with limited mobility';
var PET_REQ = 'Pet-friendly';
var KID_REQ = 'Kid-friendly';
var SOLO_REQ = 'Female solo travel friendly';

function profileByName(name){
  for (var i = 0; i < REGION_PROFILES.length; i++){
    if (REGION_PROFILES[i].name === name) return REGION_PROFILES[i];
  }
  return null;
}

function matchCatalogEntry(text){
  var t = String(text).toLowerCase();
  for (var i = 0; i < DESTINATION_CATALOG.length; i++){
    for (var k = 0; k < DESTINATION_CATALOG[i].keywords.length; k++){
      if (t.indexOf(DESTINATION_CATALOG[i].keywords[k]) !== -1) return DESTINATION_CATALOG[i];
    }
  }
  return null;
}

// Months to score climate against: the general window's months, or the
// month of the (resolved/specific) start date.
function candidateMonths(data){
  if (data.dates.mode === 'general'){
    return (data.dates.months || []).filter(function(m){ return MONTH_ABBRS.indexOf(m) !== -1; });
  }
  var iso = (data.dates.resolved && data.dates.resolved.startDate) || data.dates.startDate;
  if (iso){
    var mi = parseInt(String(iso).split('-')[1], 10) - 1;
    if (mi >= 0 && mi < 12) return [MONTH_ABBRS[mi]];
  }
  return [];
}

function bestClimate(profileName, months){
  var profile = profileName ? profileByName(profileName) : null;
  var scores = profile ? profile.monthScore : GENERIC_MONTH_SCORE;
  var best = { score: 0, month: null };
  months.forEach(function(m){
    var s = scores[m] || 0;
    if (best.month === null || s > best.score) best = { score: s, month: m };
  });
  return best;
}

// Returns { score, reasons, gaps }. `gaps` names the checked-requirement
// dimensions this proposal is honestly a poor fit for ('english', 'walkable',
// 'access', 'kid', 'pet', 'solo') — conflict detection reads them later.
function scoreProposal(p, profileName, ctx){
  var score = 0, reasons = [], gaps = [];
  if (p.styles && p.styles.indexOf(ctx.tripStyle) !== -1){
    score += 2; reasons.push('fits your ' + ctx.tripStyle.toLowerCase() + ' trip style');
  }
  var climate = bestClimate(profileName, ctx.months);
  score += climate.score;
  if (climate.score >= 2 && climate.month) reasons.push('strong weather fit for your ' + climate.month + ' window');
  if (ctx.wantsEnglish && p.english != null){
    if (p.english === 2){ score += 2; reasons.push('English predominantly spoken'); }
    else if (p.english === 1){ score += 1; }
    else { score -= 1; gaps.push('english'); }
  }
  if (ctx.wantsWalkable && p.walkable != null){
    if (p.walkable){ score += 2; reasons.push('fully doable without a rental car'); }
    else { score -= 1; gaps.push('walkable'); }
  }
  if (ctx.wantsBucket && p.bucket){ score += 1; reasons.push('a classic bucket-list pick'); }
  if (ctx.wantsAccess && p.access != null){
    if (p.access === 2){ score += 2; reasons.push('flat, step-free-friendly getting around'); }
    else if (p.access === 1){ score += 1; }
    else { score -= 1; gaps.push('access'); }
  }
  if (ctx.wantsKid && p.kid != null){
    if (p.kid === 2){ score += 2; reasons.push('easy with kids'); }
    else if (p.kid === 1){ score += 1; }
    else { score -= 1; gaps.push('kid'); }
  }
  if (ctx.wantsPet && p.pet != null){
    if (p.pet === 2){ score += 2; reasons.push('genuinely pet-friendly'); }
    else if (p.pet === 1){ score += 1; }
    else { score -= 1; gaps.push('pet'); }
  }
  if (ctx.wantsSolo && p.solo != null){
    if (p.solo === 2){ score += 2; reasons.push('a strong fit for solo female travel'); }
    else if (p.solo === 1){ score += 1; }
    else { score -= 1; gaps.push('solo'); }
  }
  return { score: score, reasons: reasons, gaps: gaps };
}

// One-line rationale: the base blurb plus only the requirement claims that
// are honestly true for this proposal.
function buildRationale(p, ctx){
  var extras = [];
  if (ctx.wantsEnglish && p.english === 2) extras.push('English is the main language');
  else if (ctx.wantsEnglish && p.english === 1) extras.push('English is widely spoken in visitor areas');
  if (ctx.wantsWalkable && p.walkable) extras.push('no rental car needed');
  if (ctx.wantsAccess && p.access === 2) extras.push('flat and modern with step-free options for limited mobility');
  if (ctx.wantsKid && p.kid === 2) extras.push('an easy destination with kids');
  if (ctx.wantsPet && p.pet === 2) extras.push('road-trip-friendly with plenty of pet-friendly lodging');
  if (ctx.wantsSolo && p.solo === 2) extras.push('well-suited to solo female travelers (compact, well-trafficked areas and reliable public transit)');
  return extras.length ? p.why + ' — ' + extras.join(', ') : p.why;
}

function buildTradeoff(p, ctx){
  var extras = [];
  if (ctx.wantsEnglish && p.english === 0) extras.push('English is not widely spoken');
  if (ctx.wantsWalkable && p.walkable === false) extras.push('easiest with a rental car');
  if (ctx.wantsAccess && p.access === 0) extras.push('stairs, hills, or uneven streets make it tough with limited mobility');
  if (ctx.wantsKid && p.kid === 0) extras.push('not a natural fit for young kids');
  if (ctx.wantsPet && p.pet === 0) extras.push('bringing a pet is impractical (long flights and pet-entry rules)');
  return extras.length ? p.tradeoff + '; ' + extras.join('; ') : p.tradeoff;
}

function allocateNights(cities, totalNights){
  var n = cities.length;
  var base = Math.floor(totalNights / n), rem = totalNights % n;
  return cities.map(function(c, i){
    return { name: c, nights: Math.max(1, base + (i < rem ? 1 : 0)) };
  });
}

function generateDestinationOptions(data){
  var entries = ((data.destination && data.destination.regions) || [])
    .map(function(r){ return String(r).trim(); })
    .filter(function(r){ return r.length > 0; });
  if (!entries.length) return [];

  var reqs = data.otherRequirements || [];
  var ctx = {
    tripStyle: data.tripStyle || 'Balanced mix',
    months: candidateMonths(data),
    wantsEnglish: reqs.indexOf(ENGLISH_REQ) !== -1,
    wantsWalkable: reqs.some(function(r){ return WALKABLE_REQS.indexOf(r) !== -1; }),
    wantsBucket: reqs.indexOf(BUCKET_REQ) !== -1,
    wantsAccess: reqs.indexOf(ACCESS_REQ) !== -1,
    wantsPet: reqs.indexOf(PET_REQ) !== -1,
    wantsKid: reqs.indexOf(KID_REQ) !== -1,
    wantsSolo: reqs.indexOf(SOLO_REQ) !== -1
  };
  var totalNights = nightsFromResolved(data);

  // Candidate pool: catalog proposals for recognized entries, or an honest
  // fallback built from the entry text itself (so no entry yields nothing).
  var pool = [];
  entries.forEach(function(entry, entryIndex){
    var cat = matchCatalogEntry(entry);
    if (cat){
      cat.proposals.forEach(function(p){
        var s = scoreProposal(p, cat.profile, ctx);
        pool.push({
          entryIndex: entryIndex, order: pool.length, supplement: false,
          cities: p.cities.slice(), name: p.cities.join(' + '),
          rationale: buildRationale(p, ctx), tradeoff: buildTradeoff(p, ctx),
          score: s.score, reasons: s.reasons, gaps: s.gaps
        });
      });
    } else {
      var prof = matchRegionProfile(entry);
      var climate = bestClimate(prof ? prof.name : null, ctx.months);
      var reasons = [];
      if (climate.score >= 2 && climate.month) reasons.push('workable weather in your ' + climate.month + ' window');
      pool.push({
        entryIndex: entryIndex, order: pool.length, supplement: false,
        cities: [entry], name: entry,
        rationale: 'Straight from your list — we\'ll plan ' + entry + ' exactly as you entered it',
        tradeoff: 'We have limited destination data for this entry, so expect broader estimates',
        // No fit data for unknown entries — never fabricate a requirement gap.
        score: climate.score, reasons: reasons, gaps: []
      });
    }
  });

  function byScore(a, b){ return b.score - a.score || a.order - b.order; }

  // Pick the best proposal per entered region first (so every listed region
  // is represented while there's room), then backfill to 3 with the
  // next-best remaining proposals overall. Overlapping regions (e.g.
  // "Thailand" + "Vietnam") can nominate the same proposal, so dedupe by
  // name here too — higher-scored copy wins, backfill restores the count.
  var bestPerEntry = {};
  pool.forEach(function(c){
    var cur = bestPerEntry[c.entryIndex];
    if (!cur || c.score > cur.score) bestPerEntry[c.entryIndex] = c;
  });
  var chosen = [];
  Object.keys(bestPerEntry)
    .map(function(k){ return bestPerEntry[k]; })
    .sort(byScore)
    .forEach(function(c){
      if (chosen.length >= 3) return;
      if (chosen.some(function(o){ return o.name === c.name; })) return;
      chosen.push(c);
    });
  pool.slice().sort(byScore).forEach(function(c){
    if (chosen.length >= 3) return;
    var dupe = chosen.some(function(o){ return o.name === c.name; });
    if (!dupe) chosen.push(c);
  });

  // Still short (e.g. a single unrecognized entry): add the best catalog-wide
  // fit as an explicit alternative so there are always 2–3 options.
  if (chosen.length < 2){
    var best = null;
    DESTINATION_CATALOG.forEach(function(cat){
      cat.proposals.forEach(function(p){
        var name = p.cities.join(' + ');
        if (chosen.some(function(o){ return o.name === name; })) return;
        var s = scoreProposal(p, cat.profile, ctx);
        if (!best || s.score > best.score){
          best = {
            entryIndex: -1, order: 9999, supplement: true,
            cities: p.cities.slice(), name: name,
            rationale: 'Popular alternative to compare against your list — ' + p.why,
            tradeoff: buildTradeoff(p, ctx),
            score: s.score, reasons: s.reasons, gaps: s.gaps
          };
        }
      });
    });
    if (best) chosen.push(best);
  }

  // Rank; the user's own entries always outrank supplemented alternatives,
  // so the recommended option is never something they didn't ask about.
  chosen.sort(function(a, b){
    return (a.supplement === b.supplement) ? byScore(a, b) : (a.supplement ? 1 : -1);
  });

  return chosen.slice(0, 3).map(function(c, i){
    var cities = c.cities.slice(0, Math.max(1, Math.min(MAX_STOPS, totalNights)));
    var recommended = i === 0;
    return {
      name: cities.join(' + '),
      stops: allocateNights(cities, totalNights),
      rationale: c.rationale,
      tradeoff: c.tradeoff,
      requirementGaps: (c.gaps || []).slice(),
      recommended: recommended,
      recommendedReason: recommended
        ? 'Best overall fit — ' + (c.reasons.length ? c.reasons.slice(0, 3).join('; ') : 'the closest match to what you told us')
        : null
    };
  });
}

// Exposed for testing (pure/deterministic given the intake data).
window.generateDestinationOptions = generateDestinationOptions;

// ---------- Conflict detection (PRD: warn and continue — never block) ----------
// A checked requirement is "in conflict" when the results had to compromise on
// it: in flexible mode, when the recommended option is honestly a poor fit for
// it, or every generated option is; in any mode, when "No rental car" forced
// out a drive that would otherwise have been the recommended way to make a
// leg. Unknown entries/city pairs carry no fit data and never fabricate a
// conflict. Returns an array of human-readable warning strings (empty = none).
var CONFLICT_GAP_LABELS = {
  english: 'English-speaking',
  access: 'limited-mobility-accessible',
  pet: 'pet-friendly',
  kid: 'kid-friendly',
  solo: 'solo-female-friendly'
};

function walkableConflictLabel(reqs){
  var noCar = reqs.indexOf(WALKABLE_REQS[0]) !== -1;      // 'No rental car'
  var walkable = reqs.indexOf(WALKABLE_REQS[1]) !== -1;   // 'Walkable cities preferred'
  if (noCar && walkable) return 'walkable, no-rental-car';
  return noCar ? 'no-rental-car' : 'walkable';
}

function detectConflictWarnings(data){
  var warnings = [];
  var reqs = data.otherRequirements || [];

  // Flexible-mode destination options: compare each checked requirement
  // against the options' recorded poor-fit gaps.
  var options = (data.destination && data.destination.mode === 'flexible' &&
    data.destination.options) || [];
  if (options.length){
    var rec = null;
    options.forEach(function(o){ if (!rec && o.recommended) rec = o; });
    if (!rec) rec = options[0];
    var activeKeys = [];
    if (reqs.indexOf(ENGLISH_REQ) !== -1) activeKeys.push('english');
    if (reqs.some(function(r){ return WALKABLE_REQS.indexOf(r) !== -1; })) activeKeys.push('walkable');
    if (reqs.indexOf(ACCESS_REQ) !== -1) activeKeys.push('access');
    if (reqs.indexOf(PET_REQ) !== -1) activeKeys.push('pet');
    if (reqs.indexOf(KID_REQ) !== -1) activeKeys.push('kid');
    if (reqs.indexOf(SOLO_REQ) !== -1) activeKeys.push('solo');
    activeKeys.forEach(function(key){
      function hasGap(o){ return (o.requirementGaps || []).indexOf(key) !== -1; }
      if (hasGap(rec) || options.every(hasGap)){
        var label = key === 'walkable' ? walkableConflictLabel(reqs) : CONFLICT_GAP_LABELS[key];
        warnings.push('Limited ' + label + ' options fit your other criteria — showing the closest available matches.');
      }
    });
  }

  // Legs (known or flexible mode) where "No rental car" excluded the drive
  // that would otherwise have been recommended.
  var squeezedLegs = [];
  (data.legs || []).forEach(function(leg){
    (leg.options || []).forEach(function(o){
      if (o.noRentalCompromise) squeezedLegs.push(leg.from + ' → ' + leg.to);
    });
  });
  if (squeezedLegs.length){
    warnings.push('"No rental car" is a squeeze on the ' + squeezedLegs.join(' and ') +
      ' leg' + (squeezedLegs.length > 1 ? 's' : '') +
      ' — driving would otherwise be the most practical option; showing the best non-drive alternatives.');
  }
  return warnings;
}

// Exposed for testing (pure given the intake data).
window.detectConflictWarnings = detectConflictWarnings;

function selectDestinationOption(data, opt){
  data.destination.selectedOption = {
    name: opt.name, stops: opt.stops, rationale: opt.rationale, recommended: !!opt.recommended
  };
  // The new option's per-stop allocation now drives the trip length.
  recomputeResolvedEnd(data);
  // Switching options can change the route's cities, so the arrival flight,
  // inter-city legs, and per-stop lodging are rebuilt (keeping selections
  // where the same from→to pairing or city survives) and the conflict
  // warnings re-evaluated against the new legs.
  data.arrivalFlight = buildArrivalFlight(data, data.arrivalFlight);
  data.legs = buildLegs(data, data.legs);
  data.lodging = buildLodging(data, data.lodging);
  data.conflictWarnings = detectConflictWarnings(data);
  persistData(data);
  // Keep the confirmation card's route + dates, the route stepper, the
  // arrival flight, the inter-city legs, the per-stop lodging, and the
  // conflict banner in sync with the chosen option.
  $('confirmationSummary').textContent = summarize(data);
  renderDateLine(data);
  renderRouteStepper(data);
  renderArrivalFlight(data);
  renderLegs(data);
  renderLodging(data);
  renderConflictWarnings(data);
}

function renderDestinationOptions(data){
  var section = $('destOptionsSection');
  var grid = $('destOptionsGrid');
  grid.innerHTML = '';
  var options = (data.destination && data.destination.options) || [];
  if (data.destination.mode !== 'flexible' || !options.length){
    section.classList.remove('visible');
    return;
  }
  // Index-keyed selection: exactly one card can be selected even if two
  // options ever shared a display name.
  var selectedName = data.destination.selectedOption && data.destination.selectedOption.name;
  var selectedIndex = 0;
  for (var si = 0; si < options.length; si++){
    if (options[si].name === selectedName){ selectedIndex = si; break; }
  }
  options.forEach(function(opt, i){
    var card = document.createElement('div');
    card.className = 'option-card' + (i === selectedIndex ? ' selected' : '');
    card.setAttribute('data-option-name', opt.name);
    card.setAttribute('data-option-index', String(i));
    card.setAttribute('role', 'button');
    var stopsLine = opt.stops.map(function(s){
      return s.nights + (s.nights === 1 ? ' night ' : ' nights ') + s.name;
    }).join(' · ');
    card.innerHTML =
      (opt.recommended ? '<span class="rec-badge">RECOMMENDED</span>' : '') +
      '<div class="select-dot"></div>' +
      '<div class="name">' + escapeHtml(opt.name) + '</div>' +
      '<div class="detail">' + escapeHtml(stopsLine) + '</div>' +
      '<div class="rationale">' + escapeHtml(opt.rationale) + '</div>' +
      '<div class="tradeoff">' + escapeHtml(opt.tradeoff) + '</div>' +
      (opt.recommended ? '<div class="tradeoff rec">' + escapeHtml(opt.recommendedReason) + '</div>' : '');
    card.addEventListener('click', function(){
      grid.querySelectorAll('.option-card').forEach(function(c){ c.classList.remove('selected'); });
      card.classList.add('selected');
      selectDestinationOption(data, opt);
    });
    grid.appendChild(card);
  });
  section.classList.add('visible');
}
