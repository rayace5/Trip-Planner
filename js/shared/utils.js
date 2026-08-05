// Shared: cross-section helpers — DOM lookup, HTML escaping, parsing, and date formatting.
'use strict';

function $(id){ return document.getElementById(id); }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

var MONTH_ABBRS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function pad2(n){ return (n < 10 ? '0' : '') + n; }
function toISODate(d){ return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

// "7–10 days" -> ~8 nights; "1 week" -> 7; "5 nights" -> 5; blank/unparseable -> 7.
function parseTripNights(text){
  if (!text) return 7;
  var nums = (String(text).match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(function(n){ return n > 0; });
  if (!nums.length) return 7;
  var lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums);
  var mid = Math.round((lo + hi) / 2);
  var nights;
  if (/week/i.test(text)) nights = mid * 7;
  else if (/night/i.test(text)) nights = mid;
  else nights = Math.max(1, mid - 1); // days -> nights
  return Math.min(Math.max(Math.round(nights), 1), 30);
}

function formatRange(s, e){
  var core = (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear())
    ? MONTH_ABBRS[s.getMonth()] + ' ' + s.getDate() + '–' + e.getDate()
    : MONTH_ABBRS[s.getMonth()] + ' ' + s.getDate() + ' – ' + MONTH_ABBRS[e.getMonth()] + ' ' + e.getDate();
  return core + ', ' + e.getFullYear();
}

function formatISODate(iso){
  var p = String(iso).split('-');
  return MONTH_ABBRS[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
}

function pluralNights(n){ return n + (n === 1 ? ' night' : ' nights'); }

function parseISODateLocal(iso){
  var p = String(iso).split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}

// "2 adults, 2 kids (ages 5 and 8)" -> 4; "solo" -> 1; bare "3" -> 3; blank -> 2.
function parseTravelerCount(text){
  var t = String(text || '').toLowerCase();
  if (!t.trim()) return 2;
  if (/\bsolo\b|just me|by myself/.test(t)) return 1;
  var total = 0, m;
  var re = /(\d+)\s*(?:adults?|kids?|children|child|teen(?:ager)?s?|people|persons?|pax|travell?ers?|couples?)/g;
  while ((m = re.exec(t))) total += parseInt(m[1], 10) * (/couples?/.test(m[0]) ? 2 : 1);
  if (!total){
    var first = t.match(/\d+/);
    total = first ? parseInt(first[0], 10) : 2;
  }
  return Math.min(Math.max(total, 1), 16);
}

function roundTo5(n){ return Math.max(5, Math.round(n / 5) * 5); }
