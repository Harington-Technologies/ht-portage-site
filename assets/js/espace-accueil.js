// Espace consultant — tableau de bord.
(async function () {
  'use strict';
  var E = window.ESPACE, db = E.db, esc = E.esc;
  var st = await E.guard();
  if (!st) return;
  var uid = st.user.id, p = st.profil;

  document.getElementById('mois-courant').textContent = E.cap(E.moisLong(new Date()));
  document.getElementById('bonjour').textContent = 'Bonjour' + (p.prenom ? ' ' + p.prenom : '');

  var r = await Promise.all([
    db.from('comptes_activite').select('*').eq('user_id', uid).order('mois', { ascending: false }).limit(12),
    db.from('consultant_missions').select('*').eq('user_id', uid).order('date_debut', { ascending: false, nullsFirst: false }).limit(20),
    db.from('documents').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(3),
    db.from('recommandations').select('id, statut, prime_montant').eq('user_id', uid),
    db.from('simulations').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(1)
  ]);
  var comptes = r[0].data || [], missions = r[1].data || [], docs = r[2].data || [], recos = r[3].data || [], sim = (r[4].data || [])[0];

  // ---------- Bandeau d'action ----------
  var infosOk = p.prenom && p.nom && p.adresse && p.code_postal && p.ville && p.date_naissance && p.num_secu && p.iban;
  var enVerif = missions.some(function (m) { return m.statut === 'a_valider'; });
  var aMission = missions.some(function (m) { return ['validee', 'active', 'terminee'].indexOf(m.statut) >= 0; });
  var banner = '';
  if (!infosOk) {
    banner = bandeau('Contractualisation · étape 1', 'Complétez vos informations personnelles.',
      'Identité, adresse, n° de sécurité sociale et RIB : ils servent à préparer votre contrat de travail.', 'informations.html', 'Compléter mes informations');
  } else if (enVerif) {
    banner = bandeau('Contractualisation', 'Votre dossier est en cours de vérification.',
      'HT Portage relit vos informations. Vous recevrez votre contrat à signer par e-mail.', null, null);
  } else if (!aMission) {
    banner = bandeau('Contractualisation · étape suivante', 'Déclarez votre mission et votre client.',
      'Ensuite, HT Portage vérifie votre dossier et vous envoie votre contrat à signer en ligne.', 'contractualisation.html', 'Démarrer ma contractualisation');
  }
  document.getElementById('banner').outerHTML = banner || '<div id="banner" hidden></div>';

  function bandeau(sur, titre, desc, href, cta) {
    return '<section class="banner" aria-label="Action à mener"><div class="banner__text">' +
      '<span class="banner__eyebrow">' + esc(sur) + '</span><span class="banner__title">' + esc(titre) + '</span>' +
      '<span class="banner__desc">' + esc(desc) + '</span></div>' +
      (href ? '<a class="btn btn--rose" href="' + href + '">' + esc(cta) + '</a>' : '') + '</section>';
  }

  // ---------- Indicateurs ----------
  function kpi(label, valeur, note, dark) {
    return '<div class="kpi' + (dark ? ' kpi--dark' : '') + '"><span class="kpi__label">' + esc(label) + '</span>' +
      '<span class="kpi__value">' + valeur + '</span>' + (note ? '<span class="kpi__note">' + esc(note) + '</span>' : '') + '</div>';
  }
  var k = '';
  if (comptes.length) {
    var dernier = comptes[0];
    var annee = E.parseDate(dernier.mois).getFullYear();
    var joursAn = comptes.filter(function (c) { return E.parseDate(c.mois).getFullYear() === annee; })
      .reduce(function (s, c) { return s + (Number(c.jours) || 0); }, 0);
    var avecReserve = comptes.find(function (c) { return c.reserve != null; });
    k += kpi('CA facturé · ' + E.moisLong(dernier.mois), E.eur(dernier.ca_ht) + ' <small style="font-size:15px;font-weight:600">HT</small>', dernier.jours != null ? E.n0(dernier.jours) + ' jours' : '', true);
    var paye = comptes.find(function (c) { return c.net_verse != null; });
    k += paye ? kpi('Net versé · ' + E.moisLong(paye.mois), E.eur(paye.net_verse), paye.statut === 'provisoire' ? 'Provisoire' : 'Dernier salaire versé')
              : kpi('Net versé', '—', 'Premier salaire en cours de calcul');
    k += kpi('Réserve financière', avecReserve ? E.eur(avecReserve.reserve) : '—', 'Disponible en intermission');
    k += kpi('Jours travaillés · ' + annee, E.n0(joursAn) + ' <small style="font-size:15px;font-weight:600">/ 218</small>', 'Plafond annuel du forfait jours');
  } else if (sim) {
    k += kpi('Net estimé / mois', E.eur(sim.net_estime), 'Votre simulation du ' + E.date(sim.created_at), true);
    k += kpi('Taux journalier simulé', E.eur(sim.tjm) + ' <small style="font-size:15px;font-weight:600">HT</small>', sim.jours + ' jours par mois');
    k += kpi('CA mensuel estimé', E.eur(sim.tjm * sim.jours), 'Avant frais de gestion de 5 %');
    k += kpi('Vos chiffres réels', '—', 'Affichés ici dès votre première paie');
  } else {
    k = '<div class="empty-state" style="grid-column: 1 / -1">Vos indicateurs apparaîtront ici dès votre première paie. En attendant, estimez votre salaire net.' +
      '<a class="btn btn--light btn--sm" href="../simulateur.html">Faire une simulation</a></div>';
  }
  document.getElementById('kpis').innerHTML = k;

  // ---------- Graphique CA 6 mois ----------
  var six = comptes.slice(0, 6).reverse();
  var chart = document.getElementById('ca-chart');
  if (six.length) {
    var max = Math.max.apply(null, six.map(function (c) { return Number(c.ca_ht) || 0; })) || 1;
    var aria = six.map(function (c) { return E.moisLong(c.mois) + ' : ' + E.eur(c.ca_ht); }).join(', ');
    chart.innerHTML = '<div class="bars" role="img" aria-label="Chiffre d\'affaires HT par mois. ' + esc(aria) + '">' +
      six.map(function (c, i) {
        var v = Number(c.ca_ht) || 0;
        return '<div class="bars__col' + (i === six.length - 1 ? ' is-last' : '') + '"><span class="bars__val">' +
          esc((v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })) + 'k</span>' +
          '<div class="bars__bar" style="height:' + Math.max(2, Math.round(v / max * 160)) + 'px"></div></div>';
      }).join('') + '</div>' +
      '<div class="bars__labels" aria-hidden="true">' + six.map(function (c) { return '<span>' + esc(E.moisCourt(c.mois)) + '</span>'; }).join('') + '</div>';
  } else {
    chart.innerHTML = '<div class="empty-state">Votre chiffre d\'affaires mensuel s\'affichera ici après votre premier mois de mission.</div>';
  }

  // ---------- Mission ----------
  var ordre = ['active', 'validee', 'a_valider', 'brouillon'];
  var m = null;
  for (var i = 0; i < ordre.length && !m; i++) m = missions.find(function (x) { return x.statut === ordre[i]; }) || null;
  var mEl = document.getElementById('mission');
  if (m) {
    var avancement = '';
    var d0 = E.parseDate(m.date_debut), d1 = E.parseDate(m.date_fin);
    if (m.statut === 'active' && d0 && d1 && d1 > d0) {
      var pct = Math.max(0, Math.min(100, Math.round((Date.now() - d0) / (d1 - d0) * 100)));
      avancement = '<div class="progress" role="img" aria-label="Avancement de la mission : ' + pct + ' %"><span style="width:' + pct + '%"></span></div>';
    }
    mEl.innerHTML =
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">' +
        '<div style="display:flex;flex-direction:column;gap:4px;min-width:0"><strong style="font-size:19px">' + esc(m.intitule) + '</strong>' +
        '<span style="color:var(--muted);font-size:15px">' + esc([m.client, m.client_final ? 'client final ' + m.client_final : ''].filter(Boolean).join(' · ') || 'Client à préciser') + '</span></div>' +
        E.tag('mission', m.statut) +
      '</div>' +
      '<dl class="dl"><div><dt>Début</dt><dd>' + E.date(m.date_debut) + '</dd></div><div><dt>Fin prévue</dt><dd>' + E.date(m.date_fin) + '</dd></div>' +
      '<div><dt>TJ</dt><dd>' + (m.tjm ? E.eur(m.tjm) + ' HT' : '—') + '</dd></div></dl>' + avancement;
  } else {
    mEl.innerHTML = '<div class="empty-state">Aucune mission pour le moment.<a class="btn btn--light btn--sm" href="contractualisation.html">Déclarer ma mission</a></div>';
  }

  // ---------- Documents ----------
  var dEl = document.getElementById('docs');
  if (docs.length) {
    dEl.innerHTML = '<ul class="list">' + docs.map(function (d) {
      return '<li><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#435B7B" stroke-width="1.8" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>' +
        '<span class="list__main"><strong>' + esc(d.titre) + '</strong><span>' + esc(E.LIBELLES.typeDoc[d.type] || '') + ' · ' + E.date(d.date_document || d.created_at) + '</span></span>' +
        (d.storage_path ? '<button class="link-btn" type="button" data-doc="' + esc(d.storage_path) + '">Ouvrir<span class="visually-hidden"> ' + esc(d.titre) + '</span></button>' : E.tag('document', d.statut)) +
        '</li>';
    }).join('') + '</ul>';
    E.brancherTelechargements(dEl);
  } else {
    dEl.innerHTML = '<div class="empty-state">Vos contrats, bulletins de paie et comptes d\'activité apparaîtront ici.</div>';
  }

  // ---------- Ambassadeur ----------
  var abouties = recos.filter(function (x) { return x.statut === 'validee' || x.statut === 'prime versee'; });
  var primes = abouties.reduce(function (s, x) { return s + (Number(x.prime_montant) || 0); }, 0);
  document.getElementById('amb').innerHTML =
    '<div class="kpis" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px">' +
      '<div class="kpi" style="background:var(--bg);border:0;padding:14px"><span class="kpi__value" style="font-size:24px">' + recos.length + '</span><span class="kpi__note">recommandation' + (recos.length > 1 ? 's' : '') + '</span></div>' +
      '<div class="kpi" style="background:var(--bg);border:0;padding:14px"><span class="kpi__value" style="font-size:24px">' + abouties.length + '</span><span class="kpi__note">abouti' + (abouties.length > 1 ? 'es' : 'e') + '</span></div>' +
      '<div class="kpi" style="background:var(--bg);border:0;padding:14px"><span class="kpi__value" style="font-size:24px">' + E.eur(primes) + '</span><span class="kpi__note">primes</span></div>' +
    '</div><a class="btn btn--ghost-dark btn--sm" href="ambassadeur.html" style="margin-top:16px">Recommander quelqu\'un</a>';
})();
