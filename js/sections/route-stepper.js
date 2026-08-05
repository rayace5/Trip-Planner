// Section: Route stepper — horizontal route overview with editable per-stop nights.
'use strict';

// ---------- Route/stop overview (results) ----------
// Horizontal stepper of the active route (departure endpoint → each stop
// with its night allocation → home endpoint). Nights are adjustable in
// place (min 1/stop); every change writes through to storage, recomputes
// dates.resolved.endDate from startDate + total nights, and refreshes the
// trip summary's dates line and total-nights readout live.
function updateRouteTotals(data){
  var total = totalStopNights(activeStops(data));
  var r = data.dates.resolved;
  var text = pluralNights(total) + ' total';
  if (r && r.startDate && r.endDate){
    text += ' · ' + formatRange(parseISODateLocal(r.startDate), parseISODateLocal(r.endDate));
  }
  $('routeTotal').textContent = text;
}

function commitNights(data, index, value, rerenderStepper){
  var stops = activeStops(data);
  var stop = stops[index];
  if (!stop) return;
  var v = parseInt(value, 10);
  if (isNaN(v)) return;
  if (v < 1) v = 1; // min 1 night per stop
  stop.nights = v;
  recomputeResolvedEnd(data);
  persistData(data);
  // Live recalcs: summary, dates line, option cards' nights, totals.
  $('confirmationSummary').textContent = summarize(data);
  renderDateLine(data);
  if (data.destination.mode === 'flexible') renderDestinationOptions(data);
  if (rerenderStepper) renderRouteStepper(data);
  else updateRouteTotals(data);
}

function renderRouteStepper(data){
  var section = $('routeSection');
  var stepper = $('routeStepper');
  stepper.innerHTML = '';
  var stops = activeStops(data);
  if (!stops.length){
    section.classList.remove('visible');
    return;
  }

  function connector(){
    var c = document.createElement('div');
    c.className = 'route-connector';
    c.textContent = '→';
    return c;
  }
  function endpoint(label){
    var el = document.createElement('div');
    el.className = 'route-stop route-endpoint';
    var city = document.createElement('div');
    city.className = 'city';
    city.textContent = '✈ ' + label;
    el.appendChild(city);
    return el;
  }

  var from = data.departingFrom;
  if (from){
    stepper.appendChild(endpoint('Departure — ' + from));
    stepper.appendChild(connector());
  }

  stops.forEach(function(stop, i){
    if (i > 0) stepper.appendChild(connector());
    var el = document.createElement('div');
    el.className = 'route-stop';
    el.setAttribute('data-stop-index', String(i));
    el.innerHTML =
      '<div class="city">' + escapeHtml(stop.name) + '</div>' +
      '<div class="nights">' + pluralNights(stop.nights) + '</div>' +
      '<div class="nights-adjust">' +
        '<button type="button" class="nights-minus" aria-label="Decrease nights in ' + escapeHtml(stop.name) + '"' + (stop.nights <= 1 ? ' disabled' : '') + '>−</button>' +
        '<input class="route-nights-input" type="number" min="1" step="1" value="' + stop.nights + '" aria-label="Nights in ' + escapeHtml(stop.name) + '">' +
        '<button type="button" class="nights-plus" aria-label="Increase nights in ' + escapeHtml(stop.name) + '">+</button>' +
      '</div>';
    el.querySelector('.nights-minus').addEventListener('click', function(){
      commitNights(data, i, stop.nights - 1, true);
    });
    el.querySelector('.nights-plus').addEventListener('click', function(){
      commitNights(data, i, stop.nights + 1, true);
    });
    var input = el.querySelector('.route-nights-input');
    input.addEventListener('input', function(e){
      var v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 1) return; // incomplete/invalid — normalized on change
      commitNights(data, i, v, false); // no re-render, so typing keeps focus
      el.querySelector('.nights').textContent = pluralNights(stop.nights);
      el.querySelector('.nights-minus').disabled = stop.nights <= 1;
    });
    input.addEventListener('change', function(e){
      var v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      commitNights(data, i, v, true); // full re-render normalizes the input
    });
    stepper.appendChild(el);
  });

  if (from){
    stepper.appendChild(connector());
    stepper.appendChild(endpoint('Home — ' + from));
  }

  updateRouteTotals(data);
  section.classList.add('visible');
}
