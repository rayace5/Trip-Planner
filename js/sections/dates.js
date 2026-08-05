// Section: Dates — specific vs. general window mode pills, month chips, year pills.
'use strict';

// ---------- Dates: specific vs. general window ----------
var dateModePills = $('dateModePills').querySelectorAll('.pill');
dateModePills.forEach(function(pill){
  pill.addEventListener('click', function(){
    dateModePills.forEach(function(p){ p.classList.remove('selected'); });
    pill.classList.add('selected');
    state.dateMode = pill.getAttribute('data-date-mode');
    $('specificDatesFields').style.display = state.dateMode === 'specific' ? 'grid' : 'none';
    $('generalWindowFields').style.display = state.dateMode === 'general' ? 'block' : 'none';
    clearInvalid($('datesSection'));
  });
});

// Month chips (multi-select)
$('monthChips').querySelectorAll('.chip').forEach(function(chip){
  chip.addEventListener('click', function(){
    chip.classList.toggle('selected');
    clearInvalid($('datesSection'));
  });
});

// Year pills (single-select)
var yearPills = $('yearPills').querySelectorAll('.pill');
yearPills.forEach(function(pill){
  pill.addEventListener('click', function(){
    yearPills.forEach(function(p){ p.classList.remove('selected'); });
    pill.classList.add('selected');
    clearInvalid($('datesSection'));
  });
});
