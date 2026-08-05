// Section: Budget — per-person/group and flights-lodging pill toggles.
'use strict';

// ---------- Budget toggles ----------
['budgetScopePills', 'budgetIncludesPills'].forEach(function(groupId){
  var pills = $(groupId).querySelectorAll('.pill');
  pills.forEach(function(pill){
    pill.addEventListener('click', function(){
      pills.forEach(function(p){ p.classList.remove('selected'); });
      pill.classList.add('selected');
    });
  });
});
