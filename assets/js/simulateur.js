// HT Portage — simulateur de revenus (estimation indicative).
(function () {
  'use strict';

  var TAUX_NET = 0.67;     // net cible HT Portage
  var TAUX_GESTION = 0.05; // frais de gestion fixes
  var TAUX_MARCHE = 0.58;  // net moyen du marché

  var tjm = document.getElementById('tjm');
  var jours = document.getElementById('jours');
  if (!tjm || !jours) return;
  var periode = 'mois';

  var fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  function eur(x) { return fmt.format(Math.round(x)) + ' €'; }
  function out(name, value) {
    document.querySelectorAll('[data-out="' + name + '"]').forEach(function (el) { el.textContent = value; });
  }
  function hidden(name, value) {
    var el = document.querySelector('form[data-form="simulation"] [name="' + name + '"]');
    if (el) el.value = value;
  }

  function update() {
    var t = Number(tjm.value), j = Number(jours.value);
    var mult = periode === 'an' ? 12 : 1;
    var ca = t * j * mult;
    var gestion = ca * TAUX_GESTION;
    var net = ca * TAUX_NET;
    var cot = ca - gestion - net;
    var gainAn = t * j * 12 * (TAUX_NET - TAUX_MARCHE);

    document.getElementById('tjm-out').textContent = eur(t);
    document.getElementById('jours-out').textContent = j + ' j';
    out('periode', periode === 'an' ? 'par an' : 'par mois');
    out('ca', eur(ca));
    out('gestion', '− ' + eur(gestion));
    out('cotisations', '− ' + eur(cot));
    out('net', eur(net));
    out('gain', '+ ' + eur(gainAn));
    out('recap', 'TJM ' + eur(t) + ' · ' + j + ' jours/mois · net estimé ' + eur(t * j * TAUX_NET) + '/mois');

    hidden('tjm', t);
    hidden('jours', j);
    hidden('net_estime', Math.round(t * j * TAUX_NET));

    var lien = document.getElementById('lien-espace');
    if (lien) lien.href = 'espace/connexion.html?inscription=1&tjm=' + t + '&jours=' + j + '&net=' + Math.round(t * j * TAUX_NET);
  }

  tjm.addEventListener('input', update);
  jours.addEventListener('input', update);
  document.querySelectorAll('[data-periode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      periode = btn.dataset.periode;
      document.querySelectorAll('[data-periode]').forEach(function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      update();
    });
  });

  // Après envoi, le formulaire est réinitialisé : on remet les valeurs de la simulation.
  var form = document.querySelector('form[data-form="simulation"]');
  if (form) form.addEventListener('htp:sent', update);

  update();
})();
