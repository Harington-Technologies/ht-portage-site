// Espace HT Portage — administration (suite) : pilotage de la vue d'ensemble, offres d'emploi, journal,
// et effacement des fichiers mis en attente par la purge RGPD.
(async function () {
  'use strict';
  var E = window.ESPACE;
  if (!E || !document.getElementById('offres')) return;
  var db = E.db, esc = E.esc;
  // Attend le contrôle d'accès fait par espace-admin.js (administrateur + double authentification)
  for (var i = 0; i < 200 && !(E.state && E.state.isAdmin && document.body.classList.contains('is-ready')); i++) await new Promise(function (r) { setTimeout(r, 100); });
  if (!(E.state && E.state.isAdmin)) return;

  function jour(d) { var x = d instanceof Date ? d : new Date(d); return x.toISOString().slice(0, 10); }
  function ilYaJours(n) { var d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function nb(n, un, plusieurs) { return n + ' ' + (n > 1 ? plusieurs : un); }
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function moisCourt(m) { return MOIS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(2, 4); }

  // =====================================================================
  // Fichiers à effacer (CV des candidatures purgées)
  // =====================================================================
  (async function () {
    var r = await db.from('fichiers_a_effacer').select('*').limit(200);
    if (r.error || !r.data || !r.data.length) return;
    var parBucket = {};
    r.data.forEach(function (f) { (parBucket[f.bucket] = parBucket[f.bucket] || []).push(f); });
    for (var b in parBucket) {
      var rm = await db.storage.from(b).remove(parBucket[b].map(function (f) { return f.chemin; }));
      if (!rm.error) await db.from('fichiers_a_effacer').delete().in('id', parBucket[b].map(function (f) { return f.id; }));
    }
  })();

  // =====================================================================
  // Pilotage (vue d'ensemble) : activité, alertes, audience
  // =====================================================================
  var pil = document.getElementById('pilotage');
  async function pilotage() {
    var depuis30 = ilYaJours(30);
    var r = await Promise.all([
      db.from('comptes_activite').select('user_id, mois, ca_ht, frais_gestion, jours').order('mois', { ascending: false }).limit(2000),
      db.from('consultant_missions').select('id, user_id, intitule, client, date_fin, statut').eq('statut', 'active'),
      db.from('recommandations').select('id, prime_montant, statut, contact_nom, ambassadeur_nom').eq('statut', 'validee'),
      db.from('mesures').select('page, evenement, source, appareil, cree_le').gte('cree_le', depuis30).limit(20000),
      db.from('contacts').select('id, type, created_at').gte('created_at', depuis30),
      db.from('profils').select('id, prenom, nom, email, created_at').gte('created_at', depuis30),
      db.from('documents').select('id, type, statut, signe_le').eq('type', 'annexe').eq('statut', 'signe').gte('signe_le', depuis30),
      db.rpc('ids_admins')
    ]);
    var comptes = r[0].data || [], missions = r[1].data || [], primes = r[2].data || [], mesures = r[3].data || [];
    var demandes = (r[4].data || []).filter(function (c) { return c.type === 'simulation'; }).length;
    var admins = (r[7].data || []).map(function (x) { return typeof x === 'string' ? x : (x && x.ids_admins) || x; });
    var inscrits = (r[5].data || []).filter(function (p) { return admins.indexOf(p.id) < 0; }).length;
    var signes = (r[6].data || []).length;
    var profils = {}; ((await db.from('profils').select('id, prenom, nom, email')).data || []).forEach(function (p) { profils[p.id] = p; });
    var nomDe = function (id) { var p = profils[id] || {}; return [p.prenom, p.nom].filter(Boolean).join(' ') || p.email || '?'; };

    // Activité : 6 derniers mois
    var parMois = {};
    comptes.forEach(function (c) {
      var m = String(c.mois).slice(0, 7);
      var x = parMois[m] = parMois[m] || { ca: 0, gestion: 0, jours: 0, consultants: {} };
      x.ca += Number(c.ca_ht) || 0; x.gestion += c.frais_gestion != null ? Number(c.frais_gestion) : (Number(c.ca_ht) || 0) * 0.05; x.jours += Number(c.jours) || 0;
      if (Number(c.ca_ht)) x.consultants[c.user_id] = 1;
    });
    var moisListe = Object.keys(parMois).sort().slice(-6);
    var dernier = moisListe[moisListe.length - 1], max = Math.max.apply(null, moisListe.map(function (m) { return parMois[m].ca; }).concat([1]));
    var annee = String(new Date().getFullYear());
    var cumulAn = Object.keys(parMois).filter(function (m) { return m.slice(0, 4) === annee; }).reduce(function (s, m) { return s + parMois[m].gestion; }, 0);
    var activite = moisListe.length ?
      '<div class="box"><div class="box__head"><h2 class="box__title">Activité</h2><span class="small">Comptes d\'activité importés de VSP</span></div>' +
        '<div class="pil-chiffres">' +
          '<div><span class="kpi__label">CA facturé · ' + esc(moisCourt(dernier)) + '</span><strong>' + E.eur(parMois[dernier].ca) + ' HT</strong><span class="small">' + nb(Object.keys(parMois[dernier].consultants).length, 'consultant', 'consultants') + ' · ' + E.n0(parMois[dernier].jours) + ' jours</span></div>' +
          '<div><span class="kpi__label">Frais de gestion · ' + esc(moisCourt(dernier)) + '</span><strong>' + E.eur(parMois[dernier].gestion) + '</strong><span class="small">' + E.eur(cumulAn) + ' depuis janvier</span></div>' +
        '</div>' +
        '<div class="pil-barres" role="img" aria-label="' + esc('CA facturé par mois : ' + moisListe.map(function (m) { return moisCourt(m) + ' ' + E.eur(parMois[m].ca); }).join(', ')) + '">' +
          moisListe.map(function (m) { return '<div class="pil-barre"><span class="pil-val">' + E.eur(parMois[m].ca).replace(/\s?€/, '') + '</span><i style="height:' + Math.max(4, Math.round(parMois[m].ca / max * 100)) + '%"></i><span class="pil-mois">' + esc(moisCourt(m)) + '</span></div>'; }).join('') +
        '</div></div>' : '';

    // Alertes : fins de mission sous 30 jours, primes à verser
    var dans30 = jour(new Date(Date.now() + 30 * 864e5)), auj = jour(new Date());
    var finissent = missions.filter(function (m) { return m.date_fin && m.date_fin <= dans30; }).sort(function (a, b) { return a.date_fin < b.date_fin ? -1 : 1; });
    var totalPrimes = primes.reduce(function (s, x) { return s + (Number(x.prime_montant) || 0); }, 0);
    var alertes = '<div class="box"><div class="box__head"><h2 class="box__title">À anticiper</h2></div><ul class="list">' +
      (finissent.length ? finissent.map(function (m) {
        var depasse = m.date_fin < auj;
        return '<li><span class="list__main"><strong>' + esc(nomDe(m.user_id)) + ' · ' + esc(m.client || m.intitule || '') + '</strong><span>' + (depasse ? 'Fin dépassée le ' : 'Fin de mission le ') + E.date(m.date_fin) + ' — prolongation, avenant ou nouvelle mission ?</span></span>' +
          '<span class="tag ' + (depasse ? 'tag--manque' : 'tag--rose') + '">' + (depasse ? 'À mettre à jour' : 'Sous 30 jours') + '</span></li>';
      }).join('') : '<li><span class="list__main"><span>Aucune mission ne se termine dans les 30 prochains jours.</span></span></li>') +
      '<li><span class="list__main"><strong>Primes ambassadeur à verser</strong><span>' + (primes.length ? nb(primes.length, 'recommandation aboutie', 'recommandations abouties') + (totalPrimes ? ' · ' + E.eur(totalPrimes) : ' · montant à saisir') : 'Aucune') + '</span></span>' +
        (primes.length ? '<a class="btn btn--light btn--sm" href="#demandes">Voir</a>' : '') + '</li></ul></div>';

    // Audience : 30 derniers jours (mesure sans cookie)
    var vues = mesures.filter(function (m) { return m.evenement === 'vue'; });
    var sims = mesures.filter(function (m) { return m.evenement === 'simulation'; }).length;
    var clics = mesures.filter(function (m) { return m.evenement === 'clic_espace'; }).length;
    var etapes = [['Pages vues', vues.length], ['Simulations faites', sims], ['Demandes de simulation', demandes], ['Espaces créés', inscrits], ['Contrats signés', signes]];
    var maxE = Math.max.apply(null, etapes.map(function (e) { return e[1]; }).concat([1]));
    function top(cle, filtre) {
      var c = {}; mesures.filter(filtre || function () { return true; }).forEach(function (m) { var k = m[cle] || 'accès direct'; c[k] = (c[k] || 0) + 1; });
      return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, 5).map(function (k) { return '<li><span>' + esc(k) + '</span><strong>' + c[k] + '</strong></li>'; }).join('') || '<li><span>—</span></li>';
    }
    var mobiles = vues.filter(function (m) { return m.appareil === 'mobile'; }).length;
    var audience = '<div class="box pil-audience"><div class="box__head"><h2 class="box__title">Audience · 30 derniers jours</h2><span class="small">Mesure sans cookie, anonyme</span></div>' +
      (vues.length ? '' : '<p class="small" style="font-size:14px">Les premières mesures apparaîtront ici après les prochaines visites du site.</p>') +
      '<div class="pil-entonnoir">' + etapes.map(function (e) {
        return '<div class="pil-etape"><span>' + esc(e[0]) + '</span><span class="pil-jauge"><i style="width:' + Math.max(e[1] ? 2 : 0, Math.round(e[1] / maxE * 100)) + '%"></i></span><strong>' + e[1] + '</strong></div>';
      }).join('') + '</div>' +
      '<div class="pil-tops"><div><h3>Pages les plus vues</h3><ul>' + top('page', function (m) { return m.evenement === 'vue'; }) + '</ul></div>' +
      '<div><h3>D\'où viennent les visiteurs</h3><ul>' + top('source', function (m) { return m.evenement === 'vue'; }) + '</ul></div>' +
      '<div><h3>Appareils</h3><ul><li><span>Mobile</span><strong>' + mobiles + '</strong></li><li><span>Ordinateur</span><strong>' + (vues.length - mobiles) + '</strong></li><li><span>Clics « Créer mon espace »</span><strong>' + clics + '</strong></li></ul></div></div></div>';

    pil.innerHTML = '<div class="pil-grille">' + activite + alertes + '</div>' + audience;
  }
  pilotage().catch(function (e) { console.error(e); pil.innerHTML = ''; });

  // =====================================================================
  // Offres d'emploi
  // =====================================================================
  var offres = [], cands = {}, filtreOffres = 'toutes';
  var listeO = document.getElementById('liste-offres'), qO = document.getElementById('q-offres'), fO = document.getElementById('f-offres');
  var dlg = document.getElementById('dlg-offre'), fo = document.getElementById('form-offre');
  async function chargerOffres() {
    var r = await Promise.all([db.from('missions').select('*').order('created_at', { ascending: false }), db.from('candidatures').select('mission_ref')]);
    if (r[0].error) { listeO.innerHTML = '<div class="alerte alerte--manque">' + esc(E.errText(r[0].error)) + ' — lancez le script espace-v17.sql dans Supabase.</div>'; return; }
    offres = r[0].data || [];
    cands = {}; (r[1].data || []).forEach(function (c) { if (c.mission_ref) cands[c.mission_ref] = (cands[c.mission_ref] || 0) + 1; });
    rendreOffres();
  }
  function rendreOffres() {
    var F = [['toutes', 'Toutes', function () { return true; }], ['publiees', 'Publiées', function (o) { return o.publiee; }], ['brouillons', 'Non publiées', function (o) { return !o.publiee; }]];
    fO.innerHTML = F.map(function (f) { return '<button type="button" class="chip" data-f="' + f[0] + '" aria-pressed="' + (f[0] === filtreOffres) + '">' + f[1] + ' <span class="chip__n">' + offres.filter(f[2]).length + '</span></button>'; }).join('');
    var test = F.find(function (f) { return f[0] === filtreOffres; })[2];
    var mots = norm(qO.value).split(/\s+/).filter(Boolean);
    var liste = offres.filter(test).filter(function (o) { var t = norm([o.titre, o.ref, o.lieu, o.domaine, o.resume].join(' ')); return mots.every(function (m) { return t.indexOf(m) >= 0; }); });
    if (!offres.length) { listeO.innerHTML = '<div class="empty-state">Aucune offre pour le moment. « Nouvelle offre » pour publier votre première mission sur le site.</div>'; return; }
    if (!liste.length) { listeO.innerHTML = '<p class="small" style="font-size:15px">Aucune offre ne correspond.</p>'; return; }
    listeO.innerHTML = '<div class="table-wrap"><table class="table" style="min-width:860px"><thead><tr><th scope="col">Offre</th><th scope="col">Domaine</th><th scope="col">Lieu · durée</th><th scope="col">TJM</th><th scope="col">Candidatures</th><th scope="col">Statut</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' +
      liste.map(function (o) {
        return '<tr data-id="' + esc(o.id) + '"><td><strong>' + esc(o.titre) + '</strong><br><span class="small">' + esc(o.ref) + ' · créée le ' + E.date(o.created_at) + '</span></td>' +
          '<td>' + esc(o.domaine) + '</td><td>' + esc([o.lieu, o.duree].filter(Boolean).join(' · ') || '—') + '</td><td>' + esc(o.tjm || 'Selon profil') + '</td>' +
          '<td class="num">' + (cands[o.ref] ? '<a href="#demandes" data-cands="' + esc(o.ref) + '">' + cands[o.ref] + '</a>' : '0') + '</td>' +
          '<td>' + (o.publiee ? '<span class="tag tag--ok">En ligne</span>' : '<span class="tag tag--muted">Non publiée</span>') + '</td>' +
          '<td><div class="row-actions"><button class="btn btn--light btn--sm" type="button" data-o="publier">' + (o.publiee ? 'Retirer du site' : 'Publier') + '</button>' +
          '<button class="link-btn" type="button" data-o="modifier">Modifier</button><button class="link-btn" type="button" data-o="dupliquer">Dupliquer</button>' +
          '<button class="icon-suppr" type="button" data-o="supprimer">Supprimer</button></div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  fO.addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (b) { filtreOffres = b.dataset.f; rendreOffres(); } });
  qO.addEventListener('input', rendreOffres);
  function prochaineRef() {
    var an = new Date().getFullYear(), maxN = 0;
    offres.forEach(function (o) { var m = new RegExp('^OFF-' + an + '-(\\d+)$').exec(o.ref || ''); if (m) maxN = Math.max(maxN, Number(m[1])); });
    return 'OFF-' + an + '-' + ('00' + (maxN + 1)).slice(-3);
  }
  function ouvrirOffre(o, copie) {
    fo.reset(); E.setStatus(fo.querySelector('.form-status'), '');
    fo.edit_id.value = o && !copie ? o.id : '';
    document.getElementById('offre-titre').textContent = o && !copie ? 'Modifier l\'offre' : copie ? 'Dupliquer l\'offre' : 'Nouvelle offre';
    ['titre', 'domaine', 'resume', 'lieu', 'duree', 'rythme', 'tjm'].forEach(function (k) { if (o && o[k] != null) fo[k].value = o[k]; });
    fo.ref.value = o && !copie ? o.ref : prochaineRef();
    fo.publiee.checked = o && !copie ? !!o.publiee : false;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    fo.titre.focus();
  }
  document.getElementById('btn-nouvelle-offre').addEventListener('click', function () { ouvrirOffre(null); });
  dlg.addEventListener('click', function (e) { if (e.target.closest('[data-fermer]')) dlg.close(); });
  fo.addEventListener('submit', async function (e) {
    e.preventDefault();
    var st = fo.querySelector('.form-status');
    if (!fo.checkValidity()) { fo.reportValidity(); E.setStatus(st, 'Titre et référence obligatoires.', 'error'); return; }
    var d = {};
    ['titre', 'ref', 'domaine', 'resume', 'lieu', 'duree', 'rythme', 'tjm'].forEach(function (k) { var v = fo[k].value.trim(); d[k] = v === '' ? null : v; });
    d.publiee = fo.publiee.checked; d.updated_at = new Date().toISOString();
    var id = fo.edit_id.value;
    var r = id ? await db.from('missions').update(d).eq('id', id) : await db.from('missions').insert(d);
    if (r.error) { E.setStatus(st, /duplicate|unique/i.test(r.error.message || '') ? 'Cette référence existe déjà.' : E.errText(r.error), 'error'); return; }
    dlg.close();
    await chargerOffres();
  });
  listeO.addEventListener('click', async function (e) {
    var c = e.target.closest('[data-cands]');
    if (c) { e.preventDefault(); location.hash = '#demandes'; setTimeout(function () { var q = document.getElementById('q-liste-candidatures'); var o = document.getElementById('o-candidatures'); if (o) o.click(); if (q) { q.value = c.dataset.cands; q.dispatchEvent(new Event('input', { bubbles: true })); } }, 50); return; }
    var b = e.target.closest('[data-o]'); if (!b) return;
    var o = offres.find(function (x) { return x.id === b.closest('tr').dataset.id; }); if (!o) return;
    if (b.dataset.o === 'modifier') return ouvrirOffre(o);
    if (b.dataset.o === 'dupliquer') return ouvrirOffre(o, true);
    if (b.dataset.o === 'publier') {
      var r = await db.from('missions').update({ publiee: !o.publiee, updated_at: new Date().toISOString() }).eq('id', o.id);
      if (r.error) { alert(E.errText(r.error)); return; }
      return chargerOffres();
    }
    if (b.dataset.o === 'supprimer') {
      if (!confirm('Supprimer l\'offre « ' + o.titre + ' » (' + o.ref + ') ?' + (cands[o.ref] ? '\n\nLes ' + cands[o.ref] + ' candidature(s) reçues sont conservées.' : '') + '\n\nPour la retirer du site sans la perdre, préférez « Retirer du site ».')) return;
      var rs = await db.from('missions').delete().eq('id', o.id);
      if (rs.error) { alert(E.errText(rs.error)); return; }
      chargerOffres();
    }
  });
  chargerOffres();

  // =====================================================================
  // Convertisseur de CV
  // =====================================================================
  if (window.HTP_CV && document.getElementById('convertisseur-admin')) window.HTP_CV_ADMIN = window.HTP_CV.monter(document.getElementById('convertisseur-admin'), { admin: true });

  // =====================================================================
  // Journal
  // =====================================================================
  var lj = document.getElementById('liste-journal'), qJ = document.getElementById('q-journal'), oJ = document.getElementById('o-journal'), aJ = document.getElementById('j-admin');
  var journal = [], vuJ = 100;
  var OBJETS = { profils: 'Compte', consultant_missions: 'Mission', documents: 'Document', missions: 'Offre', contacts: 'Contact / simulation', candidatures: 'Candidature', recommandations: 'Recommandation', admins: 'Administrateur', rgpd: 'Purge RGPD', comptes: 'Compte' };
  async function chargerJournal() {
    var r = await db.from('journal').select('*').order('quand', { ascending: false }).limit(2000);
    if (r.error) { lj.innerHTML = '<div class="alerte alerte--manque">' + esc(E.errText(r.error)) + ' — lancez le script espace-v17.sql dans Supabase.</div>'; return; }
    journal = r.data || [];
    rendreJournal();
  }
  function rendreJournal() {
    var mots = norm(qJ.value).split(/\s+/).filter(Boolean);
    var liste = journal.filter(function (j) {
      if (oJ.value && j.objet !== oJ.value) return false;
      if (aJ.checked && (!j.auteur || j.auteur_nom === 'Système')) return false;
      var t = norm([j.auteur_nom, j.resume, OBJETS[j.objet], j.action].join(' '));
      return mots.every(function (m) { return t.indexOf(m) >= 0; });
    });
    if (!journal.length) { lj.innerHTML = '<div class="empty-state">Le journal se remplira au fil des actions.</div>'; return; }
    lj.innerHTML = '<p class="small" style="font-size:14px">' + nb(liste.length, 'action', 'actions') + '</p><div class="table-wrap"><table class="table" style="min-width:820px"><thead><tr><th scope="col">Date</th><th scope="col">Par</th><th scope="col">Action</th><th scope="col">Détail</th></tr></thead><tbody>' +
      liste.slice(0, vuJ).map(function (j) {
        var d = new Date(j.quand);
        return '<tr><td style="white-space:nowrap">' + E.date(j.quand) + '<br><span class="small">' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '</span></td>' +
          '<td>' + esc(j.auteur_nom || 'Système') + '</td>' +
          '<td><span class="tag ' + (j.action === 'suppression' || j.action === 'purge' ? 'tag--manque' : j.action === 'ajout' ? 'tag--ok' : '') + '">' + esc(j.action) + '</span><br><span class="small">' + esc(OBJETS[j.objet] || j.objet) + '</span></td>' +
          '<td style="max-width:520px;word-break:break-word">' + esc(j.resume || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (liste.length > vuJ ? '<p style="margin-top:12px"><button class="btn btn--light btn--sm" type="button" id="j-plus">Afficher 100 de plus</button></p>' : '');
    var plus = document.getElementById('j-plus'); if (plus) plus.addEventListener('click', function () { vuJ += 100; rendreJournal(); });
  }
  [qJ, oJ, aJ].forEach(function (x) { x.addEventListener(x === qJ ? 'input' : 'change', function () { vuJ = 100; rendreJournal(); }); });
  // Rechargé à chaque ouverture de la rubrique
  function siJournal() { if (E.sectionAdmin() === 'journal') chargerJournal(); if (E.sectionAdmin() === 'apercu') pilotage(); }
  window.addEventListener('hashchange', siJournal);
  chargerJournal();
})();
