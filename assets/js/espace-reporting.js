// Espace consultant — reporting financier (comptes d'activité importés de VSP).
(async function () {
  'use strict';
  var E = window.ESPACE, db = E.db, esc = E.esc;
  var st = await E.guard();
  if (!st) return;

  var r = await Promise.all([
    db.from('comptes_activite').select('*').eq('user_id', st.user.id).order('mois', { ascending: false }),
    db.from('documents').select('type, date_document, storage_path, titre').eq('user_id', st.user.id).in('type', ['bulletin', 'compte_activite'])
  ]);
  var comptes = r[0].data || [], docs = r[1].data || [];
  var select = document.getElementById('annee');

  if (!comptes.length) {
    select.closest('label').hidden = true;
    document.getElementById('cumuls').innerHTML = '<div class="empty-state" style="grid-column:1/-1">Vos comptes d\'activité apparaîtront ici après votre premier mois de mission : chiffre d\'affaires, frais de gestion, charges, salaire net et réserve.</div>';
    document.getElementById('tableau').innerHTML = '<p class="small" style="font-size:15px">Aucune donnée pour le moment.</p>';
    return;
  }

  // Documents de paie rattachés au mois (date_document dans le mois)
  function docsDuMois(mois) {
    var cle = String(mois).slice(0, 7);
    return docs.filter(function (d) { return d.storage_path && String(d.date_document || '').slice(0, 7) === cle; });
  }

  var annees = [];
  comptes.forEach(function (c) { var a = E.parseDate(c.mois).getFullYear(); if (annees.indexOf(a) < 0) annees.push(a); });
  select.innerHTML = annees.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join('');
  var maj = comptes.reduce(function (m, c) { return c.created_at > m ? c.created_at : m; }, '');
  document.getElementById('maj').textContent = 'Données issues de VSP · mise à jour le ' + E.date(maj);

  function somme(liste, k) { return liste.reduce(function (s, c) { return s + (Number(c[k]) || 0); }, 0); }

  function afficher(annee) {
    document.getElementById('annee-label').textContent = '/Année ' + annee + '/';
    var liste = comptes.filter(function (c) { return E.parseDate(c.mois).getFullYear() === Number(annee); });
    var def = liste.filter(function (c) { return c.net_verse != null; });
    var ca = somme(liste, 'ca_ht'), net = somme(def, 'net_verse');
    var avecBp = liste.filter(function (c) { return c.salaire_charge != null; });
    var charge = somme(avecBp, 'salaire_charge'), fraisPro = somme(avecBp, 'frais_pro');
    var premier = liste[liste.length - 1], dernier = liste[0];
    var periode = E.moisCourt(premier.mois) + ' → ' + E.moisCourt(dernier.mois);
    var nb = function (n) { return n + ' mois payé' + (n > 1 ? 's' : ''); };
    document.getElementById('cumuls').innerHTML =
      '<div class="kpi kpi--dark"><span class="kpi__label">CA facturé · cumul</span><span class="kpi__value">' + E.eur(ca) + ' <small style="font-size:15px">HT</small></span><span class="kpi__note">' + esc(periode) + '</span></div>' +
      '<div class="kpi"><span class="kpi__label">Salaire chargé · cumul</span><span class="kpi__value">' + E.eur(charge) + '</span><span class="kpi__note">Brut + charges patronales · ' + nb(avecBp.length) + '</span></div>' +
      '<div class="kpi"><span class="kpi__label">Frais professionnels · cumul</span><span class="kpi__value">' + E.eur(fraisPro) + '</span><span class="kpi__note">Remboursés avec le salaire</span></div>' +
      '<div class="kpi"><span class="kpi__label">Net versé · cumul</span><span class="kpi__value">' + E.eur(net) + '</span><span class="kpi__note">' + nb(def.length) + '</span></div>';

    document.getElementById('tableau').innerHTML = '<div class="table-wrap"><table class="table" style="min-width:820px"><thead><tr>' +
      '<th scope="col">Mois</th><th scope="col" class="num">Jours</th><th scope="col" class="num">CA HT</th><th scope="col" class="num">Frais de gestion</th>' +
      '<th scope="col" class="num">Frais professionnels</th><th scope="col" class="num">Salaire chargé</th><th scope="col" class="num">Net versé</th><th scope="col" class="num">Documents</th>' +
      '</tr></thead><tbody>' + liste.map(function (c) {
        var ds = docsDuMois(c.mois);
        var liens = ds.length ? ds.map(function (d) {
          return '<button class="link-btn" type="button" data-doc="' + esc(d.storage_path) + '">' + (d.type === 'bulletin' ? 'Paie' : 'Compte') +
            '<span class="visually-hidden"> ' + esc(E.moisLong(c.mois)) + '</span></button>';
        }).join(' · ') : '—';
        var provisoire = c.statut === 'provisoire' ? ' <span class="tag tag--rose">Provisoire</span>' : '';
        return '<tr><th scope="row">' + esc(E.cap(E.moisLong(c.mois))) + provisoire + '</th>' +
          '<td class="num">' + (c.jours != null ? E.n0(c.jours) : '—') + '</td><td class="num">' + E.eur(c.ca_ht) + '</td>' +
          '<td class="num">' + E.eur(c.frais_gestion) + '</td><td class="num">' + E.eur(c.frais_pro) + '</td><td class="num">' + E.eur(c.salaire_charge) + '</td>' +
          '<td class="num"><strong style="color:var(--navy-900)">' + E.eur(c.net_verse) + '</strong></td><td class="num">' + liens + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="small" style="font-size:13px;margin-top:10px">Salaire chargé = salaire brut + charges patronales, d\'après votre bulletin de paie. Il comprend vos cotisations, votre réserve financière et votre salaire net.</p>';

    // Répartition du dernier mois dont le bulletin est disponible : salaire chargé + frais professionnels + frais de gestion
    var ref = liste.filter(function (c) { return c.salaire_charge != null && Number(c.ca_ht); })[0];
    var bloc = document.getElementById('bloc-repart');
    if (!ref) { bloc.hidden = true; return; }
    var tot = Number(ref.ca_ht);
    var parts = [
      ['Salaire chargé', Number(ref.salaire_charge) || 0, 'var(--navy-900)'],
      ['Frais professionnels', Number(ref.frais_pro) || 0, 'var(--slate)'],
      ['Frais de gestion', Number(ref.frais_gestion) || 0, 'var(--rose)']
    ];
    var reste = Math.round((tot - parts.reduce(function (s, x) { return s + x[1]; }, 0)) * 100) / 100;
    if (reste >= 1) parts.push(['Reste sur votre compte d\'activité', reste, 'var(--on-dark-2)']);
    parts = parts.filter(function (x) { return x[1] > 0; });
    document.getElementById('t-repart').textContent = 'Où va votre chiffre d\'affaires · ' + E.moisLong(ref.mois);
    document.getElementById('repart').innerHTML =
      '<div class="stack" role="img" aria-label="' + esc('CA ' + E.eur(tot) + ' : ' + parts.map(function (x) { return x[0] + ' ' + E.eur(x[1]); }).join(', ')) + '">' +
        parts.map(function (x) { return '<div style="flex:' + x[1] + ' 1 0;background:' + x[2] + '"></div>'; }).join('') + '</div>' +
      '<div class="legend">' + parts.map(function (x) {
        return '<span><i style="background:' + x[2] + '"></i>' + esc(x[0]) + ' · ' + E.eur(x[1]) + '</span>';
      }).join('') + '</div>' +
      (ref.net_verse != null ? '<p class="small" style="font-size:14px;margin-top:10px">CA facturé : ' + E.eur(tot) + ' HT · dont net versé sur votre compte bancaire : ' + E.eur(Number(ref.net_verse)) + ' (salaire + frais remboursés).</p>' : '');
    bloc.hidden = false;
  }

  afficher(annees[0]);
  select.addEventListener('change', function () { afficher(select.value); });
  E.brancherTelechargements(document.getElementById('tableau'));
})();
