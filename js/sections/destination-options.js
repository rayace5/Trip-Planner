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

function scoreProposal(p, profileName, ctx){
  var score = 0, reasons = [];
  if (p.styles && p.styles.indexOf(ctx.tripStyle) !== -1){
    score += 2; reasons.push('fits your ' + ctx.tripStyle.toLowerCase() + ' trip style');
  }
  var climate = bestClimate(profileName, ctx.months);
  score += climate.score;
  if (climate.score >= 2 && climate.month) reasons.push('strong weather fit for your ' + climate.month + ' window');
  if (ctx.wantsEnglish && p.english != null){
    if (p.english === 2){ score += 2; reasons.push('English predominantly spoken'); }
    else if (p.english === 1){ score += 1; }
    else { score -= 1; }
  }
  if (ctx.wantsWalkable && p.walkable != null){
    if (p.walkable){ score += 2; reasons.push('fully doable without a rental car'); }
    else { score -= 1; }
  }
  if (ctx.wantsBucket && p.bucket){ score += 1; reasons.push('a classic bucket-list pick'); }
  return { score: score, reasons: reasons };
}

// One-line rationale: the base blurb plus only the requirement claims that
// are honestly true for this proposal.
function buildRationale(p, ctx){
  var extras = [];
  if (ctx.wantsEnglish && p.english === 2) extras.push('English is the main language');
  else if (ctx.wantsEnglish && p.english === 1) extras.push('English is widely spoken in visitor areas');
  if (ctx.wantsWalkable && p.walkable) extras.push('no rental car needed');
  return extras.length ? p.why + ' — ' + extras.join(', ') : p.why;
}

function buildTradeoff(p, ctx){
  var extras = [];
  if (ctx.wantsEnglish && p.english === 0) extras.push('English is not widely spoken');
  if (ctx.wantsWalkable && p.walkable === false) extras.push('easiest with a rental car');
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
    wantsBucket: reqs.indexOf(BUCKET_REQ) !== -1
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
          score: s.score, reasons: s.reasons
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
        score: climate.score, reasons: reasons
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
            score: s.score, reasons: s.reasons
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
      recommended: recommended,
      recommendedReason: recommended
        ? 'Best overall fit — ' + (c.reasons.length ? c.reasons.slice(0, 3).join('; ') : 'the closest match to what you told us')
        : null
    };
  });
}

// Exposed for testing (pure/deterministic given the intake data).
window.generateDestinationOptions = generateDestinationOptions;

function selectDestinationOption(data, opt){
  data.destination.selectedOption = {
    name: opt.name, stops: opt.stops, rationale: opt.rationale, recommended: !!opt.recommended
  };
  // The new option's per-stop allocation now drives the trip length.
  recomputeResolvedEnd(data);
  // Switching options can change the route's cities, so the inter-city
  // legs are rebuilt (keeping selections for legs that still exist).
  data.legs = buildLegs(data, data.legs);
  persistData(data);
  // Keep the confirmation card's route + dates, the route stepper, and the
  // inter-city legs in sync with the chosen option.
  $('confirmationSummary').textContent = summarize(data);
  renderDateLine(data);
  renderRouteStepper(data);
  renderLegs(data);
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
