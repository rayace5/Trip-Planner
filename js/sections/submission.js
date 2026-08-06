// Section: Submission — validation, error banner, submit flow, and the confirmation/summary card.
'use strict';

// ---------- Validation ----------
function markInvalid(el){
  if (el) el.classList.add(el.classList.contains('input') || el.classList.contains('nights-input') ? 'invalid' : 'invalid-group');
}
function clearInvalid(scope){
  (scope || document).querySelectorAll('.invalid, .invalid-group').forEach(function(el){
    el.classList.remove('invalid');
    el.classList.remove('invalid-group');
  });
}

// Clear inline highlight as the user fixes a field
['departingFrom', 'budgetAmount', 'tripPurpose', 'whoIsGoing', 'startDate', 'endDate'].forEach(function(id){
  $(id).addEventListener('input', function(){ $(id).classList.remove('invalid'); });
});

function validate(){
  var errors = []; // { label, el }

  // Dates
  if (state.dateMode === 'general'){
    var monthsSelected = $('monthChips').querySelectorAll('.chip.selected').length;
    var yearSelected = $('yearPills').querySelectorAll('.pill.selected').length;
    if (monthsSelected === 0) errors.push({ label: 'Dates — select at least one month for your travel window', el: $('monthChips') });
    if (yearSelected === 0) errors.push({ label: 'Dates — select a year for your travel window', el: $('yearPills') });
  } else {
    var start = $('startDate').value;
    var end = $('endDate').value;
    if (!start) errors.push({ label: 'Dates — start date', el: $('startDate') });
    if (!end) errors.push({ label: 'Dates — end date', el: $('endDate') });
    if (start && end && end < start) errors.push({ label: 'Dates — end date must be on or after the start date', el: $('endDate') });
  }

  // Departing from
  if (!$('departingFrom').value.trim()) errors.push({ label: 'Departing from', el: $('departingFrom') });

  // Destination
  if (state.destMode === 'known'){
    if (state.stops.length === 0) errors.push({ label: 'Destination — add at least one stop', el: $('addStopInput') });
  } else {
    if (state.regions.length === 0) errors.push({ label: 'Destination — add at least one region or country you’re considering', el: $('addRegionInput') });
  }

  // Budget
  var rawBudget = $('budgetAmount').value.replace(/[$,\s]/g, '');
  var budgetNum = parseFloat(rawBudget);
  if (rawBudget === '' ) errors.push({ label: 'Total budget', el: $('budgetAmount') });
  else if (isNaN(budgetNum) || budgetNum <= 0) errors.push({ label: 'Total budget — must be a positive number', el: $('budgetAmount') });

  // Trip goal & travelers
  if (!$('tripPurpose').value.trim()) errors.push({ label: 'Purpose of the trip', el: $('tripPurpose') });
  if (!$('whoIsGoing').value.trim()) errors.push({ label: "Who's going", el: $('whoIsGoing') });

  return errors;
}

function showErrorBanner(errors){
  var banner = $('errorBanner');
  banner.innerHTML =
    '<span>Hold on — some required fields are missing or need attention before we can build your trip:</span>' +
    '<ul>' + errors.map(function(e){ return '<li>' + escapeHtml(e.label) + '</li>'; }).join('') + '</ul>';
  banner.classList.add('visible');
  banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideErrorBanner(){
  var banner = $('errorBanner');
  banner.classList.remove('visible');
  banner.innerHTML = '';
}

// Non-blocking conflict banner (mockup .warning-banner): shown near the trip
// summary only when data.conflictWarnings is non-empty. One banner covers all
// conflicts — a single warning renders inline, multiple render as a list.
function renderConflictWarnings(data){
  var banner = $('conflictBanner');
  var warnings = data.conflictWarnings || [];
  if (!warnings.length){
    banner.classList.remove('visible');
    banner.innerHTML = '';
    return;
  }
  var body = warnings.length === 1
    ? '<div>' + escapeHtml(warnings[0]) + '</div>'
    : '<div>Heads up — a few of your requirements are in tension with these results:<ul>' +
        warnings.map(function(w){ return '<li>' + escapeHtml(w) + '</li>'; }).join('') +
      '</ul></div>';
  banner.innerHTML = '<span class="icon">⚠</span>' + body;
  banner.classList.add('visible');
}

function renderDateLine(data){
  var rationale = $('dateRationale');
  var r = data.dates.resolved;
  if (data.dates.mode === 'general' && r && r.reason){
    rationale.textContent = '📅 ' + r.reason;
  } else if (r && r.startDate && r.endDate){
    rationale.textContent = '📅 ' + formatISODate(r.startDate) + ' – ' + formatISODate(r.endDate);
  } else {
    rationale.textContent = '';
  }
}

function summarize(data){
  // Full route, all stops in visit order ("Austin → Dallas"); a single stop
  // is just its name. Flexible trips show the selected option's route.
  var dest;
  if (data.destination.mode === 'known'){
    dest = data.destination.stops.map(function(s){ return s.name; }).join(' → ');
  } else if (data.destination.selectedOption){
    dest = data.destination.selectedOption.stops.map(function(s){ return s.name; }).join(' → ');
  } else {
    dest = 'Flexible: ' + data.destination.regions.join(', ');
  }
  var when = data.dates.mode === 'general'
    ? data.dates.months.join('/') + ' ' + data.dates.year
    : data.dates.startDate + ' – ' + data.dates.endDate;
  return dest + ' · ' + when + ' · ' + data.tripStyle;
}

$('intakeForm').addEventListener('submit', function(e){
  e.preventDefault();
  clearInvalid();
  var errors = validate();
  if (errors.length > 0){
    errors.forEach(function(err){ markInvalid(err.el); });
    showErrorBanner(errors);
    return;
  }
  hideErrorBanner();

  var data = collectFormData();
  persistData(data);

  // Show the auto-allocated nights back in the intake rows so re-editing
  // the form reflects them.
  if (data.destination.mode === 'known'){
    data.destination.stops.forEach(function(s, i){
      if (state.stops[i]) state.stops[i].nights = s.nights;
    });
    renderStops();
  }

  $('confirmationSummary').textContent = summarize(data);
  renderDateLine(data);
  renderDestinationOptions(data);
  renderRouteStepper(data);
  renderLegs(data);
  renderConflictWarnings(data);
  $('intakeForm').style.display = 'none';
  $('confirmationCard').classList.add('visible');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('editAgainBtn').addEventListener('click', function(){
  $('confirmationCard').classList.remove('visible');
  $('conflictBanner').classList.remove('visible');
  $('routeSection').classList.remove('visible');
  $('legsSection').classList.remove('visible');
  $('destOptionsSection').classList.remove('visible');
  $('intakeForm').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
