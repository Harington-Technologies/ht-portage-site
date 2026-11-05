// Espace consultant HT Portage — « Mes notes de frais » (lecture seule, recopiées de VSP par vsp-sync).
(function () {
  'use strict';
  var E = window.ESPACE;
  if (!E) return;
  var db = E.db, esc = E.esc;
  var selAnnee = document.getElementById('annee'), liste = document.getElementById('liste'), cumul = document.getElementById('cumul');
  var lignes = [];

  function afficher() {
    var an = selAnnee.value;
    var l = lignes.filter(function (f) { return String(f.mois).slice(0, 4) === an; });
    var ttc = l.reduce(function (t, f) { return t + (Number(f.montant_ttc) || 0); }, 0);
    var ht = l.reduce(function (t, f) { return t + (Number(f.montant_ht) || 0); }, 0);
    cumul.innerHTML =
      '<div class="kpi kpi--dark"><span class="kpi__label">Frais déclarés · ' + esc(an) + '</span><span class="kpi__value">' + E.eur(ttc, true) + ' <small style="font-size:15px">TTC</small></span><span class="kpi__note">' + l.length + ' ligne' + (l.length > 1 ? 's' : '') + '</span></div>' +
      '<div class="kpi"><span class="kpi__label">Dont hors taxes</span><span class="kpi__value">' + E.eur(ht, true) + '</span><span class="kpi__note">Montants HT déclarés</span></div>';
    if (!l.length) { liste.innerHTML = '<p class="small" style="margin:0">Aucune note de frais en ' + esc(an) + '.</p>'; return; }
    var parMois = {};
    l.forEach(function (f) { (parMois[f.mois] = parMois[f.mois] || []).push(f); });
    liste.innerHTML = Object.keys(parMois).sort().reverse().map(function (m) {
      var x = parMois[m], tot = x.reduce(function (t, f) { return t + (Number(f.montant_ttc) || 0); }, 0);
      return '<h3 class="box__title" style="font-size:16px;margin:16px 0 8px">' + esc(E.cap(E.moisLong(m))) + ' <span class="small">· ' + E.eur(tot, true) + ' TTC</span></h3>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Motif</th><th scope="col" style="text-align:right">HT</th><th scope="col" style="text-align:right">TTC</th></tr></thead><tbody>' +
        x.map(function (f) {
          return '<tr><td>' + esc(E.date(f.date_frais)) + '</td><td>' + esc(f.type || '—') + '</td><td>' + esc(f.motif || '') + '</td><td style="text-align:right">' + E.eur(f.montant_ht, true) + '</td><td style="text-align:right">' + E.eur(f.montant_ttc, true) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');
  }

  (async function () {
    var st = await E.guard();
    if (!st) return;
    var r = await db.from('notes_frais').select('mois, date_frais, type, montant_ht, montant_ttc, motif').eq('user_id', st.user.id).order('date_frais', { ascending: false });
    if (r.error) { liste.innerHTML = '<p class="small">' + esc(E.errText(r.error)) + '</p>'; return; }
    lignes = r.data || [];
    var annees = lignes.map(function (f) { return String(f.mois).slice(0, 4); }).concat([String(new Date().getFullYear())]).filter(function (v, i, t) { return t.indexOf(v) === i; }).sort().reverse();
    selAnnee.innerHTML = annees.map(function (a) { return '<option>' + a + '</option>'; }).join('');
    selAnnee.addEventListener('change', afficher);
    afficher();
  })();
})();
