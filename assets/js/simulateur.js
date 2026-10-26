// HT Portage — simulateur de revenus (estimation indicative). Calcul : assets/js/calcul-portage.js
(function () {
  'use strict';
  var C = window.HTP_CALCUL;
  var tjm = document.getElementById('tjm'), jours = document.getElementById('jours');
  var frais = document.getElementById('frais'), pas = document.getElementById('pas');
  if (!C || !tjm || !jours || !frais) return;
  var periode = 'mois';

  var fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  function eur(x) { return fmt.format(Math.round(x)) + ' €'; }
  function pct(x) { return String(Math.round(x * 1000) / 10).replace('.', ',') + ' %'; }
  function out(name, value) {
    document.querySelectorAll('[data-out="' + name + '"]').forEach(function (el) { el.textContent = value; });
  }
  function montrer(sel, oui) { document.querySelectorAll(sel).forEach(function (el) { el.hidden = !oui; }); }
  function hidden(name, value) {
    var el = document.querySelector('form[data-form="simulation"] [name="' + name + '"]');
    if (el) el.value = value;
  }

  // Les frais se règlent en euros ; le plafond (fixé dans calcul-portage.js) n'est jamais affiché en pourcentage.
  function update() {
    var t = Number(tjm.value), j = Number(jours.value), ca = t * j;
    var plafond = C.calculer({ tjm: t, jours: j, fraisPct: 1 }).frais;   // frais maximum autorisés pour ce CA
    var max = Math.max(0, Math.floor(plafond / 10) * 10);
    frais.max = String(max);
    if (Number(frais.value) > max) frais.value = String(max);
    var r = C.calculer({ tjm: t, jours: j, frais: Number(frais.value), pas: Number(pas.value) / 100 });
    document.getElementById('frais-max-label').textContent = eur(max);

    var m = periode === 'an' ? 12 : 1;
    document.getElementById('tjm-out').textContent = eur(t);
    document.getElementById('jours-out').textContent = j + ' j';
    document.getElementById('frais-out').textContent = eur(r.frais);
    frais.setAttribute('aria-valuetext', eur(r.frais) + ' par mois');
    document.getElementById('pas-out').textContent = r.pas > 0 ? pct(r.pas) : '—';
    pas.setAttribute('aria-valuetext', r.pas > 0 ? pct(r.pas) : 'non renseigné');

    var avecImpot = r.pas > 0;
    out('periode', periode === 'an' ? 'par an' : 'par mois');
    out('libelle-net', avecImpot ? 'après impôt' : 'avant impôt');
    out('net-principal', eur((avecImpot ? r.netApresImpot : r.net) * m));
    var plus = document.querySelector('[data-out="plus-frais"]');
    plus.hidden = !(r.frais > 0);
    plus.textContent = r.frais > 0 ? '+ ' + eur(r.frais * m) + ' de frais remboursés · total perçu ' + eur(r.totalPercu * m) : '';

    out('ca', eur(r.ca * m));
    out('gestion', '− ' + eur(r.gestion * m));
    out('frais', r.frais > 0 ? '− ' + eur(r.frais * m) : '0 €');
    out('cotisations', '− ' + eur((r.patronales + r.salariales) * m));
    out('net', eur(r.net * m));
    out('impot', '− ' + eur(r.impot * m));
    out('total', eur(r.totalPercu * m));
    montrer('[data-ligne="impot"]', avecImpot);
    montrer('[data-ligne="total"]', avecImpot || r.frais > 0);

    out('d-ca', eur(r.ca * m)); out('d-gestion', '− ' + eur(r.gestion * m)); out('d-frais', '− ' + eur(r.frais * m));
    out('d-cout', eur(r.coutEmployeur * m)); out('d-patronales', '− ' + eur(r.patronales * m)); out('d-brut', eur(r.brut * m));
    out('d-base', eur(r.base * m)); out('d-apport', eur(r.apport * m)); out('d-reserve', eur(r.reserve * m)); out('d-cp', eur(r.cp * m));
    out('d-salariales', '− ' + eur(r.salariales * m)); out('d-net', eur(r.net * m)); out('d-impot', '− ' + eur(r.impot * m));
    out('d-net-apres', eur(r.netApresImpot * m)); out('d-frais2', '+ ' + eur(r.frais * m)); out('d-total', eur(r.totalPercu * m));

    var alerte = document.querySelector('[data-out="alerte"]');
    alerte.hidden = !r.sousMinimum;
    alerte.textContent = r.sousMinimum ? 'Avec ce TJM et ce nombre de jours, le salaire de base serait inférieur au minimum de la convention du portage salarial (' + eur(r.baseMin) + ' par mois). Parlons-en ensemble : votre conseiller étudiera la meilleure solution.' : '';

    // Barre de répartition du chiffre d'affaires
    if (r.ca > 0) {
      var w = { net: r.net, frais: r.frais, cotisations: r.patronales + r.salariales, gestion: r.gestion };
      Object.keys(w).forEach(function (k) { var el = document.querySelector('[data-seg="' + k + '"]'); if (el) el.style.width = (w[k] / r.ca * 100) + '%'; });
    }

    var netMois = Math.round(r.net);
    out('recap', 'TJM ' + eur(t) + ' · ' + j + ' jours/mois' + (r.frais > 0 ? ' · frais ' + eur(r.frais) + '/mois' : '') + ' · net estimé ' + eur(netMois) + '/mois');
    hidden('tjm', t);
    hidden('jours', j);
    hidden('net_estime', netMois);
    hidden('situation', ('Frais professionnels simulés : ' + eur(r.frais) + '/mois' + (r.pas > 0 ? ' · PAS ' + pct(r.pas) : '')).slice(0, 200));

    var lien = document.getElementById('lien-espace');
    if (lien) lien.href = 'espace/connexion.html?inscription=1&tjm=' + t + '&jours=' + j + '&net=' + netMois + '&frais=' + Math.round(r.frais);
  }

  [tjm, jours, frais, pas].forEach(function (el) { el.addEventListener('input', update); });
  document.querySelectorAll('[data-periode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      periode = btn.dataset.periode;
      document.querySelectorAll('[data-periode]').forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
      update();
    });
  });

  // Fenêtre d'explication des frais (barèmes URSSAF)
  var popup = document.getElementById('popup-frais'), aide = document.getElementById('aide-frais');
  if (popup && aide) {
    aide.addEventListener('click', function () { if (popup.showModal) popup.showModal(); else popup.setAttribute('open', ''); });
    var versConseiller = false;
    popup.addEventListener('click', function (e) {
      if (e.target === popup || e.target.closest('[data-fermer]')) {
        versConseiller = !!e.target.closest('a[data-fermer]');
        popup.close ? popup.close() : popup.removeAttribute('open');
      }
    });
    // Au retour, le focus revient sur le « ? » (sauf si l'on part vers le formulaire de rappel)
    popup.addEventListener('close', function () { if (!versConseiller) aide.focus(); versConseiller = false; });
  }

  // Après envoi, le formulaire est réinitialisé : on remet les valeurs de la simulation.
  var form = document.querySelector('form[data-form="simulation"]');
  if (form) form.addEventListener('htp:sent', update);

  update();
})();
