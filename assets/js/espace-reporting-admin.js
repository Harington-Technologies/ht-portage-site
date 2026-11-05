// Espace HT Portage — administration, rubrique « Reporting financier ».
// Source : public.comptes_activite (synchronisés depuis VSP) : jours, CA de production (jours × TJM)
// et frais de gestion = marge HT Portage. Notes de frais (public.notes_frais) pour la part des frais.
// Vue globale (année, mois par mois, consultant par consultant) et vue d'un consultant.
(function () {
  'use strict';
  var E = window.ESPACE;
  var zone = document.getElementById('rf-contenu');
  if (!E || !zone) return;
  var db = E.db, esc = E.esc;
  var selAnnee = document.getElementById('rf-annee'), selQui = document.getElementById('rf-qui');
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var D = { comptes: [], noms: {}, frais: {} };
  // Montants sur une seule ligne (« 23 050 € » ne se coupe pas)
  var st = document.createElement('style');
  st.textContent = '#rf-contenu td[style*="text-align:right"], #rf-contenu th[style*="text-align:right"] { white-space: nowrap; }';
  document.head.appendChild(st);

  var n = function (v) { return v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v); };
  var pct = function (a, b) { return b ? (Math.round(1000 * a / b) / 10).toLocaleString('fr-FR') + ' %' : '—'; };
  var evo = function (a, b) {
    if (!b) return '<span class="small">—</span>';
    var e = (a - b) / b, s = (e >= 0 ? '+' : '') + (Math.round(1000 * e) / 10).toLocaleString('fr-FR') + ' %';
    return '<span style="font-weight:700;color:' + (e >= 0 ? '#1f7a4d' : '#b42318') + '">' + s + '</span>';
  };

  async function charger() {
    zone.innerHTML = '<p class="loading">Chargement…</p>';
    var r = await db.from('comptes_activite').select('user_id, mois, jours, ca_ht, frais_gestion, statut, source').order('mois').limit(20000);
    if (r.error) { zone.innerHTML = '<p class="small">' + esc(E.errText(r.error)) + '</p>'; return; }
    D.comptes = (r.data || []).map(function (c) { return { uid: c.user_id, mois: String(c.mois).slice(0, 7), jours: n(c.jours), ca: n(c.ca_ht), marge: n(c.frais_gestion), provisoire: c.statut === 'provisoire' }; });
    var ids = D.comptes.map(function (c) { return c.uid; }).filter(function (v, i, t) { return t.indexOf(v) === i; });
    var p = ids.length ? await db.from('profils').select('id, prenom, nom, email').in('id', ids) : { data: [] };
    D.noms = {}; (p.data || []).forEach(function (x) { D.noms[x.id] = [x.prenom, x.nom].filter(Boolean).join(' ') || x.email; });
    var f = await db.from('notes_frais').select('user_id, mois, montant_ttc').limit(20000);
    D.frais = {}; (f.data || []).forEach(function (x) { var k = x.user_id + '|' + String(x.mois).slice(0, 7); D.frais[k] = (D.frais[k] || 0) + n(x.montant_ttc); });
    var annees = D.comptes.map(function (c) { return c.mois.slice(0, 4); }).concat([String(new Date().getFullYear())]).filter(function (v, i, t) { return t.indexOf(v) === i; }).sort().reverse();
    var a = selAnnee.value; selAnnee.innerHTML = annees.map(function (y) { return '<option>' + y + '</option>'; }).join(''); if (a && annees.indexOf(a) >= 0) selAnnee.value = a;
    var q = selQui.value;
    selQui.innerHTML = '<option value="">Tous (vue globale)</option>' + ids.slice().sort(function (x, y) { return String(D.noms[x]).localeCompare(String(D.noms[y])); }).map(function (id) { return '<option value="' + id + '">' + esc(D.noms[id] || '—') + '</option>'; }).join('');
    if (q && ids.indexOf(q) >= 0) selQui.value = q;
    afficher();
  }

  // Agrège une liste de comptes : totaux et indicateurs
  function somme(l) {
    var t = { jours: 0, ca: 0, marge: 0, frais: 0, provisoire: false, qui: {} };
    l.forEach(function (c) { t.jours += c.jours; t.ca += c.ca; t.marge += c.marge; t.frais += D.frais[c.uid + '|' + c.mois] || 0; if (c.provisoire) t.provisoire = true; if (c.jours > 0 || c.ca > 0) t.qui[c.uid] = 1; });
    t.nbQui = Object.keys(t.qui).length; t.tjm = t.jours ? t.ca / t.jours : null;
    return t;
  }
  function kpi(label, val, note, sombre) { return '<div class="kpi' + (sombre ? ' kpi--dark' : '') + '"><span class="kpi__label">' + esc(label) + '</span><span class="kpi__value">' + val + '</span><span class="kpi__note">' + (note || '') + '</span></div>'; }
  // Barres CA (bleu) et marge (rose) par mois, sans bibliothèque
  function graphique(parMois) {
    var max = Math.max.apply(null, parMois.map(function (m) { return m.t.ca; }).concat([1]));
    return '<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:6px;align-items:end;height:180px;padding-top:8px" role="img" aria-label="CA et marge par mois">' +
      parMois.map(function (m) {
        var h = Math.round(150 * m.t.ca / max), hm = Math.round(150 * m.t.marge / max);
        return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px" title="' + esc(MOIS_LONG[m.i] + ' : CA ' + E.eur(m.t.ca) + ' · marge ' + E.eur(m.t.marge)) + '">' +
          '<div style="display:flex;align-items:end;gap:2px;height:150px"><div style="width:14px;height:' + h + 'px;background:var(--navy-900,#1d2b4f);border-radius:3px 3px 0 0;opacity:' + (m.t.provisoire ? '.55' : '1') + '"></div><div style="width:8px;height:' + Math.max(hm, m.t.marge ? 2 : 0) + 'px;background:var(--rose,#c187a1);border-radius:3px 3px 0 0"></div></div>' +
          '<span class="small" style="font-size:12px">' + MOIS[m.i] + '</span></div>';
      }).join('') + '</div>' +
      '<p class="small" style="margin:8px 0 0"><span style="display:inline-block;width:10px;height:10px;background:var(--navy-900,#1d2b4f);border-radius:2px"></span> CA de production &nbsp; <span style="display:inline-block;width:10px;height:10px;background:var(--rose,#c187a1);border-radius:2px"></span> Marge (frais de gestion) &nbsp; · barres pâles : mois provisoire</p>';
  }
  function tableMois(parMois, prec) {
    var cumCa = 0, cumMarge = 0;
    return '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Mois</th><th scope="col" style="text-align:right">Consultants</th><th scope="col" style="text-align:right">Jours</th><th scope="col" style="text-align:right">TJM moyen</th><th scope="col" style="text-align:right">CA HT</th><th scope="col" style="text-align:right">Marge</th><th scope="col" style="text-align:right">Taux</th><th scope="col" style="text-align:right">Frais / CA</th><th scope="col" style="text-align:right">CA cumulé</th><th scope="col" style="text-align:right">vs N-1</th></tr></thead><tbody>' +
      parMois.map(function (m) {
        var t = m.t; cumCa += t.ca; cumMarge += t.marge;
        if (!t.ca && !t.jours) return '<tr><td>' + esc(MOIS_LONG[m.i]) + '</td><td colspan="9" class="small">—</td></tr>';
        return '<tr><td>' + esc(MOIS_LONG[m.i]) + (t.provisoire ? ' <span class="tag tag--rose" style="font-size:11px">provisoire</span>' : '') + '</td><td style="text-align:right">' + t.nbQui + '</td><td style="text-align:right">' + E.n0(t.jours) + '</td><td style="text-align:right">' + (t.tjm ? E.eur(t.tjm) : '—') + '</td>' +
          '<td style="text-align:right"><strong>' + E.eur(t.ca) + '</strong></td><td style="text-align:right">' + E.eur(t.marge) + '</td><td style="text-align:right">' + pct(t.marge, t.ca) + '</td><td style="text-align:right">' + pct(t.frais, t.ca) + '</td><td style="text-align:right">' + E.eur(cumCa) + '</td><td style="text-align:right">' + evo(t.ca, prec[m.i] && prec[m.i].ca) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function parMoisDe(l, an) {
    return MOIS.map(function (_, i) { var m = an + '-' + ('0' + (i + 1)).slice(-2); return { i: i, t: somme(l.filter(function (c) { return c.mois === m; })) }; });
  }

  function vueGlobale() {
    var an = selAnnee.value, anP = String(Number(an) - 1);
    var l = D.comptes.filter(function (c) { return c.mois.slice(0, 4) === an; });
    var t = somme(l), pm = parMoisDe(l, an);
    // N-1 à période égale : mêmes mois que ceux déjà renseignés cette année
    var moisRemplis = pm.filter(function (m) { return m.t.ca || m.t.jours; }).map(function (m) { return m.i; });
    var lP = D.comptes.filter(function (c) { return c.mois.slice(0, 4) === anP; });
    var pmP = parMoisDe(lP, anP), tP = somme(lP.filter(function (c) { return moisRemplis.indexOf(Number(c.mois.slice(5, 7)) - 1) >= 0; }));
    var prec = pmP.map(function (m) { return m.t; });
    var qui = Object.keys(somme(l).qui).sort(function (x, y) { return String(D.noms[x]).localeCompare(String(D.noms[y])); });
    var lignesQui = qui.map(function (uid) {
      var tq = somme(l.filter(function (c) { return c.uid === uid; }));
      return { uid: uid, t: tq };
    }).sort(function (a, b) { return b.t.ca - a.t.ca; });
    zone.innerHTML =
      '<section class="kpis" aria-label="Synthèse ' + esc(an) + '">' +
        kpi('CA de production ' + an, E.eur(t.ca), (tP.ca ? evo(t.ca, tP.ca) + ' vs ' + anP + ' à période égale' : esc(moisRemplis.length + ' mois renseignés')) + (t.provisoire ? ' · inclut des mois provisoires' : ''), true) +
        kpi('Marge (frais de gestion)', E.eur(t.marge), 'Taux moyen ' + pct(t.marge, t.ca) + (tP.marge ? ' · ' + evo(t.marge, tP.marge) + ' vs ' + anP : '')) +
        kpi('Jours facturés', E.n0(t.jours), 'TJM moyen ' + (t.tjm ? E.eur(t.tjm) : '—')) +
        kpi('Consultants actifs', String(t.nbQui), 'Frais déclarés : ' + pct(t.frais, t.ca) + ' du CA') +
      '</section>' +
      '<section class="box"><div class="box__head"><h2 class="box__title">Mois par mois</h2><span class="small">' + esc(an) + '</span></div>' + graphique(pm) + tableMois(pm, prec) + '</section>' +
      '<section class="box"><div class="box__head"><h2 class="box__title">Consultant par consultant</h2><span class="small">Classés par CA · cliquez sur un nom pour son détail</span></div>' +
        (lignesQui.length ? '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Consultant</th><th scope="col" style="text-align:right">Mois actifs</th><th scope="col" style="text-align:right">Jours</th><th scope="col" style="text-align:right">TJM moyen</th><th scope="col" style="text-align:right">CA HT</th><th scope="col" style="text-align:right">Part du CA</th><th scope="col" style="text-align:right">Marge</th><th scope="col" style="text-align:right">Taux</th><th scope="col" style="text-align:right">Frais / CA</th></tr></thead><tbody>' +
          lignesQui.map(function (x) {
            var mActifs = l.filter(function (c) { return c.uid === x.uid && (c.jours || c.ca); }).length;
            return '<tr><td><a href="#reporting-admin" data-qui="' + x.uid + '"><strong>' + esc(D.noms[x.uid] || '—') + '</strong></a></td><td style="text-align:right">' + mActifs + '</td><td style="text-align:right">' + E.n0(x.t.jours) + '</td><td style="text-align:right">' + (x.t.tjm ? E.eur(x.t.tjm) : '—') + '</td><td style="text-align:right"><strong>' + E.eur(x.t.ca) + '</strong></td><td style="text-align:right">' + pct(x.t.ca, t.ca) + '</td><td style="text-align:right">' + E.eur(x.t.marge) + '</td><td style="text-align:right">' + pct(x.t.marge, x.t.ca) + '</td><td style="text-align:right">' + pct(x.t.frais, x.t.ca) + '</td></tr>';
          }).join('') +
          '<tr style="border-top:2px solid var(--tint)"><td><strong>Total</strong></td><td></td><td style="text-align:right"><strong>' + E.n0(t.jours) + '</strong></td><td style="text-align:right">' + (t.tjm ? E.eur(t.tjm) : '—') + '</td><td style="text-align:right"><strong>' + E.eur(t.ca) + '</strong></td><td style="text-align:right">100 %</td><td style="text-align:right"><strong>' + E.eur(t.marge) + '</strong></td><td style="text-align:right">' + pct(t.marge, t.ca) + '</td><td style="text-align:right">' + pct(t.frais, t.ca) + '</td></tr>' +
          '</tbody></table></div>' : '<p class="small">Aucun compte d\'activité en ' + esc(an) + '. Lancez une synchronisation VSP.</p>') + '</section>' +
      '<section class="box"><div class="box__head"><h2 class="box__title">Consultant × mois</h2><span class="small">CA HT de production</span></div>' + croise(l, qui, an) + '</section>' +
      aPropos();
  }
  // Tableau croisé consultant × mois (CA)
  function croise(l, qui, an) {
    if (!qui.length) return '<p class="small" style="margin:0">—</p>';
    var cell = function (uid, i) { var m = an + '-' + ('0' + (i + 1)).slice(-2); var c = l.filter(function (x) { return x.uid === uid && x.mois === m; }); var t = somme(c); return t.ca ? '<span' + (t.provisoire ? ' style="opacity:.6" title="provisoire"' : '') + '>' + E.n0(Math.round(t.ca / 100) / 10) + ' k€</span>' : '<span class="small">·</span>'; };
    return '<div class="table-wrap"><table class="table" style="font-size:13px"><thead><tr><th scope="col">Consultant</th>' + MOIS.map(function (m) { return '<th scope="col" style="text-align:right">' + m + '</th>'; }).join('') + '<th scope="col" style="text-align:right">Total</th></tr></thead><tbody>' +
      qui.map(function (uid) {
        return '<tr><td><a href="#reporting-admin" data-qui="' + uid + '">' + esc(D.noms[uid] || '—') + '</a></td>' + MOIS.map(function (_, i) { return '<td style="text-align:right">' + cell(uid, i) + '</td>'; }).join('') + '<td style="text-align:right"><strong>' + E.eur(somme(l.filter(function (c) { return c.uid === uid; })).ca) + '</strong></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function vueConsultant(uid) {
    var an = selAnnee.value, anP = String(Number(an) - 1);
    var l = D.comptes.filter(function (c) { return c.uid === uid && c.mois.slice(0, 4) === an; });
    var lP = D.comptes.filter(function (c) { return c.uid === uid && c.mois.slice(0, 4) === anP; });
    var t = somme(l), pm = parMoisDe(l, an), prec = parMoisDe(lP, anP).map(function (m) { return m.t; });
    var tous = somme(D.comptes.filter(function (c) { return c.mois.slice(0, 4) === an; }));
    zone.innerHTML =
      '<p style="margin:0 0 12px"><a href="#reporting-admin" data-qui="">← Vue globale</a></p>' +
      '<section class="kpis" aria-label="Synthèse du consultant">' +
        kpi(D.noms[uid] || '—', E.eur(t.ca), 'CA de production ' + esc(an) + ' · ' + pct(t.ca, tous.ca) + ' du CA HT Portage', true) +
        kpi('Marge (frais de gestion)', E.eur(t.marge), 'Taux ' + pct(t.marge, t.ca)) +
        kpi('Jours facturés', E.n0(t.jours), 'TJM moyen ' + (t.tjm ? E.eur(t.tjm) : '—')) +
        kpi('Frais / CA', pct(t.frais, t.ca), E.eur(t.frais, true) + ' de notes de frais') +
      '</section>' +
      '<section class="box"><div class="box__head"><h2 class="box__title">Mois par mois</h2><span class="small">' + esc(an) + '</span></div>' + graphique(pm) + tableMois(pm, prec) + '</section>' +
      aPropos();
  }
  function aPropos() {
    return '<details class="box"><summary class="small" style="cursor:pointer;font-weight:600">Comment sont calculés ces chiffres</summary><ul class="small" style="font-size:14px;margin:10px 0 0;padding-left:20px;display:grid;gap:4px">' +
      '<li><strong>CA de production</strong> : jours facturables des CRA VSP × TJM de la mission, mois par mois. Ce n\'est pas le CA facturé : il le précède d\'environ un mois.</li>' +
      '<li><strong>Marge</strong> : frais de gestion d\'HT Portage, au taux de chaque mission (5 % par défaut).</li>' +
      '<li><strong>Provisoire</strong> : mois dont le CRA n\'est pas encore validé ou dont la paie n\'est pas faite ; les chiffres peuvent encore bouger.</li>' +
      '<li><strong>Frais / CA</strong> : notes de frais du mois de la note rapportées au CA du même mois.</li>' +
      '<li><strong>vs N-1</strong> : même mois de l\'année précédente, s\'il a été synchronisé (période « Depuis le 1er janvier » ou mois choisi).</li>' +
      '</ul></details>';
  }

  function afficher() { if (selQui.value) vueConsultant(selQui.value); else vueGlobale(); }
  selAnnee.addEventListener('change', afficher);
  selQui.addEventListener('change', afficher);
  zone.addEventListener('click', function (e) {
    var a = e.target.closest('[data-qui]');
    if (!a) return;
    e.preventDefault(); selQui.value = a.dataset.qui; afficher(); window.scrollTo(0, 0);
  });

  var charge = false;
  function siOuvert() { if (!charge && E.sectionAdmin() === 'reporting-admin') { charge = true; charger(); } }
  window.addEventListener('hashchange', siOuvert);
  var t = setInterval(function () { if (E.state) { clearInterval(t); siOuvert(); } }, 200);
  window.HTP_REPORTING = { recharger: function () { if (charge) charger(); } };
})();
