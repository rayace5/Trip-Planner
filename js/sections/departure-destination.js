// Section: Departure & destination — departing-from field, ordered stop list (drag/reorder), flexible region chips.
'use strict';

// ---------- Destination: known vs. flexible ----------
var destModePills = $('destModePills').querySelectorAll('.pill');
destModePills.forEach(function(pill){
  pill.addEventListener('click', function(){
    destModePills.forEach(function(p){ p.classList.remove('selected'); });
    pill.classList.add('selected');
    state.destMode = pill.getAttribute('data-dest-mode');
    $('fixedDestField').style.display = state.destMode === 'known' ? 'block' : 'none';
    $('flexibleDestField').style.display = state.destMode === 'flexible' ? 'block' : 'none';
    clearInvalid($('destSection'));
  });
});

// ---------- Ordered stop list ("I know where") ----------
function renderStops(){
  var list = $('stopList');
  list.innerHTML = '';
  state.stops.forEach(function(stop, i){
    if (i > 0){
      var arrow = document.createElement('div');
      arrow.className = 'stop-arrow';
      arrow.textContent = '↓';
      list.appendChild(arrow);
    }
    var row = document.createElement('div');
    row.className = 'stop-row';
    row.innerHTML =
      '<span class="drag" aria-label="Drag to reorder ' + escapeHtml(stop.name) + '" title="Drag to reorder">⠿</span>' +
      '<span class="stop-num">' + (i + 1) + '</span>' +
      '<span class="stop-name">' + escapeHtml(stop.name) + '</span>' +
      '<input class="nights-input" type="number" min="1" step="1" placeholder="nights" aria-label="Nights in ' + escapeHtml(stop.name) + '"' +
        (stop.nights != null ? ' value="' + stop.nights + '"' : '') + '>' +
      '<button type="button" class="move-btn move-up" aria-label="Move ' + escapeHtml(stop.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button type="button" class="move-btn move-down" aria-label="Move ' + escapeHtml(stop.name) + ' down"' + (i === state.stops.length - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button type="button" class="remove-x" aria-label="Remove ' + escapeHtml(stop.name) + '">×</button>';

    row.querySelector('.drag').addEventListener('pointerdown', function(e){
      startStopDrag(e, i);
    });
    row.querySelector('.nights-input').addEventListener('input', function(e){
      var v = parseInt(e.target.value, 10);
      stop.nights = (isNaN(v) || v < 1) ? null : v;
    });
    row.querySelector('.move-up').addEventListener('click', function(){
      if (i === 0) return;
      var tmp = state.stops[i - 1]; state.stops[i - 1] = state.stops[i]; state.stops[i] = tmp;
      renderStops();
    });
    row.querySelector('.move-down').addEventListener('click', function(){
      if (i === state.stops.length - 1) return;
      var tmp = state.stops[i + 1]; state.stops[i + 1] = state.stops[i]; state.stops[i] = tmp;
      renderStops();
    });
    row.querySelector('.remove-x').addEventListener('click', function(){
      state.stops.splice(i, 1);
      renderStops();
    });
    list.appendChild(row);
  });

  var atLimit = state.stops.length >= MAX_STOPS;
  $('addStopInput').disabled = atLimit;
  $('stopLimitMsg').style.display = atLimit ? 'block' : 'none';
}

// Pointer-based drag-to-reorder on the ⠿ handle (works for mouse and touch;
// the ↑ / ↓ buttons remain the keyboard-accessible path). While dragging,
// the source row is highlighted and a coral insertion line previews where
// the stop will land; state.stops is only reordered on drop.
function startStopDrag(e, sourceIndex){
  if (e.button != null && e.button !== 0) return; // primary button/touch only
  if (state.stops.length < 2) return;
  e.preventDefault();
  var handle = e.currentTarget;
  var rows = Array.prototype.slice.call($('stopList').querySelectorAll('.stop-row'));
  var others = rows.filter(function(_, idx){ return idx !== sourceIndex; });
  rows[sourceIndex].classList.add('dragging');
  if (e.pointerId != null && handle.setPointerCapture){
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  }

  // Insertion index within the list *after* the source row is removed (0..n-1).
  var insertIndex = sourceIndex;

  function indexFromY(clientY){
    var idx = 0;
    others.forEach(function(row){
      var r = row.getBoundingClientRect();
      if (clientY > r.top + r.height / 2) idx++;
    });
    return idx;
  }

  function paintIndicator(){
    rows.forEach(function(row){ row.classList.remove('drop-before', 'drop-after'); });
    if (!others.length) return;
    if (insertIndex >= others.length) others[others.length - 1].classList.add('drop-after');
    else others[insertIndex].classList.add('drop-before');
  }

  function onMove(ev){
    insertIndex = indexFromY(ev.clientY);
    paintIndicator();
  }
  function finish(commit){
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    if (commit && insertIndex !== sourceIndex){
      var moved = state.stops.splice(sourceIndex, 1)[0];
      state.stops.splice(insertIndex, 0, moved);
    }
    renderStops(); // clears .dragging/.drop-* classes and renumbers
  }
  function onUp(ev){
    insertIndex = indexFromY(ev.clientY);
    finish(true);
  }
  function onCancel(){ finish(false); }

  // Pointer capture retargets events to the handle; they still bubble to
  // document, so these listeners see the whole drag even outside the list.
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  paintIndicator();
}

$('addStopInput').addEventListener('keydown', function(e){
  if (e.key !== 'Enter') return;
  e.preventDefault();
  var name = e.target.value.trim();
  if (!name || state.stops.length >= MAX_STOPS) return;
  state.stops.push({ name: name, nights: null });
  e.target.value = '';
  renderStops();
  clearInvalid($('destSection'));
});

// ---------- Region chip list ("I'm flexible") ----------
function renderRegions(){
  var list = $('regionChipList');
  list.innerHTML = '';
  state.regions.forEach(function(region, i){
    var chip = document.createElement('div');
    chip.className = 'chip selected';
    chip.innerHTML = escapeHtml(region) + '<span class="chip-x" role="button" aria-label="Remove ' + escapeHtml(region) + '">×</span>';
    chip.querySelector('.chip-x').addEventListener('click', function(){
      state.regions.splice(i, 1);
      renderRegions();
    });
    list.appendChild(chip);
  });
}

$('addRegionInput').addEventListener('keydown', function(e){
  if (e.key !== 'Enter') return;
  e.preventDefault();
  var name = e.target.value.trim();
  if (!name) return;
  state.regions.push(name);
  e.target.value = '';
  renderRegions();
  clearInvalid($('destSection'));
});

renderStops();
renderRegions();
