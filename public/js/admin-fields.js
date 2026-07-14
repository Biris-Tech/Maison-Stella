/* Éditeur de champs structuré pour les chambres (admin).
   Remplit des champs cachés (composition / amenities) en chaînes \n,
   pour rester compatible avec le serveur qui fait .split("\n"). */
(function () {
  var AMENITIES = [
    "WiFi fibre", "Climatisation", "Télévision", "Petit-déjeuner", "Piscine",
    "Parking", "Cuisine équipée", "Réfrigérateur", "Sèche-cheveux", "Coffre-fort",
    "Terrasse / Balcon", "Vue sur le lac", "Ménage quotidien", "Lave-linge",
    "Bureau", "Fer à repasser", "Moustiquaire", "Groupe électrogène / Onduleur"
  ];

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function initAmenities() {
    var wrap = document.getElementById('amenitiesWidget');
    if (!wrap) return;
    var hidden = document.getElementById('amenitiesHidden');
    var existing = (hidden.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var lowerPresets = AMENITIES.map(function (a) { return a.toLowerCase(); });
    var custom = existing.filter(function (a) { return lowerPresets.indexOf(a.toLowerCase()) === -1; });

    var checklist = wrap.querySelector('.amenities-checklist');
    AMENITIES.forEach(function (a) {
      var checked = existing.some(function (e) { return e.toLowerCase() === a.toLowerCase(); });
      var lbl = document.createElement('label');
      lbl.className = 'amenity-check';
      lbl.innerHTML = '<input type="checkbox" value="' + esc(a) + '"' + (checked ? ' checked' : '') + '><span>' + esc(a) + '</span>';
      checklist.appendChild(lbl);
    });

    var chipsBox = wrap.querySelector('.chips-box');
    function addChip(val) {
      var chip = document.createElement('span');
      chip.className = 'chip-item';
      chip.dataset.val = val;
      chip.innerHTML = '<span>' + esc(val) + '</span><button type="button" class="chip-x" aria-label="Retirer">×</button>';
      chip.querySelector('.chip-x').addEventListener('click', function () { chip.remove(); });
      chipsBox.appendChild(chip);
    }
    custom.forEach(addChip);

    var input = wrap.querySelector('.custom-input');
    var btn = wrap.querySelector('.custom-add');
    function doAdd() {
      var v = (input.value || '').trim();
      if (!v) return;
      var dup = lowerPresets.indexOf(v.toLowerCase()) !== -1 ||
        Array.prototype.some.call(chipsBox.querySelectorAll('.chip-item'), function (c) { return c.dataset.val.toLowerCase() === v.toLowerCase(); });
      if (!dup) addChip(v);
      input.value = '';
    }
    btn.addEventListener('click', doAdd);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });

    wrap._collect = function () {
      var checked = Array.prototype.map.call(checklist.querySelectorAll('input:checked'), function (c) { return c.value; });
      var chips = Array.prototype.map.call(chipsBox.querySelectorAll('.chip-item'), function (c) { return c.dataset.val; });
      return checked.concat(chips);
    };
  }

  function initComposition() {
    var wrap = document.getElementById('compositionWidget');
    if (!wrap) return;
    var hidden = document.getElementById('compositionHidden');
    var list = wrap.querySelector('.dyn-list');
    var existing = (hidden.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);

    function addRow(val) {
      var row = document.createElement('div');
      row.className = 'dyn-row';
      row.innerHTML = '<input type="text" class="dyn-input" placeholder="ex: 1 lit king, 1 salle de bain privée…"><button type="button" class="dyn-x" aria-label="Retirer">×</button>';
      row.querySelector('.dyn-input').value = val || '';
      row.querySelector('.dyn-x').addEventListener('click', function () { row.remove(); });
      list.appendChild(row);
    }
    (existing.length ? existing : ['']).forEach(addRow);
    wrap.querySelector('.dyn-add').addEventListener('click', function () { addRow(''); });

    wrap._collect = function () {
      return Array.prototype.map.call(list.querySelectorAll('.dyn-input'), function (i) { return i.value.trim(); }).filter(Boolean);
    };
  }

  function sync() {
    var aw = document.getElementById('amenitiesWidget');
    var cw = document.getElementById('compositionWidget');
    if (aw && aw._collect) document.getElementById('amenitiesHidden').value = aw._collect().join('\n');
    if (cw && cw._collect) document.getElementById('compositionHidden').value = cw._collect().join('\n');
  }
  window.syncRoomFields = sync;

  document.addEventListener('DOMContentLoaded', function () {
    initAmenities();
    initComposition();
    // Formulaires natifs (room-edit) : synchroniser juste avant l'envoi
    Array.prototype.forEach.call(document.querySelectorAll('form'), function (f) {
      f.addEventListener('submit', sync);
    });
  });
})();
