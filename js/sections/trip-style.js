// Section: Trip style — slider with clickable labels.
'use strict';

// ---------- Trip style slider ----------
var styleRange = $('styleRange');
var styleLabels = $('styleLabels').querySelectorAll('span');
function updateStyleUI(){
  var v = parseInt(styleRange.value, 10);
  var pct = (v / 3) * 100;
  styleRange.style.background =
    'linear-gradient(to right, var(--coral) 0%, var(--coral) ' + pct + '%, var(--gray-300) ' + pct + '%)';
  styleLabels.forEach(function(label, i){
    label.classList.toggle('active', i === v);
  });
}
styleRange.addEventListener('input', updateStyleUI);
styleLabels.forEach(function(label){
  label.addEventListener('click', function(){
    styleRange.value = label.getAttribute('data-style-index');
    updateStyleUI();
  });
});
updateStyleUI();
