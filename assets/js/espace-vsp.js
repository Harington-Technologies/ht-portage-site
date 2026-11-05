// Espace HT Portage — administration, rubrique « Synchronisation VSP ».
// Lit VSP par la fonction vsp-sync (lecture seule sur VSP) et met à jour l'espace :
// comptes (sans e-mail), profils, missions, comptes d'activité et notes de frais. VSP fait foi.
// Aperçu d'abord (rien n'est écrit), puis « Synchroniser ». Le mois écoulé se synchronise aussi
// tout seul, une fois, dès que tous ses CRA sont validés dans VSP.
(function () {
  'use strict';
  var E = window.ESPACE;
  var zone = document.getElementById('sync-vsp');
  if (!E || !zone) return;
  var db = E.db, esc = E.esc;

  var selMois = document.getElementById('sync-mois');
  var btnApercu = document.getElementById('sync-apercu'), btnAppliquer = document.getElementById('sync-appliquer');
  var statut = document.getElementById('sync-statut'), rapport = document.getElementById('sync-rapport');
  var histo = document.getElementById('sync-historique');
  var fraisEl = document.getElementById('frais-admin'), fraisMois = document.getElementById('frais-mois');

  var NOMS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function libMois(m) { return NOMS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4); }
  function moisDecale(n) { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  // Choix : mois écoulé + mois en cours (défaut), ou un mois des 12 derniers
  var choix = [['defaut', 'Mois écoulé et mois en cours'], ['annee', 'Depuis le 1er janvier']];
  for (var i = 0; i < 12; i++) { var m = moisDecale(-i); choix.push([m, libMois(m)]); }
  selMois.innerHTML = choix.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('');
  fraisMois.innerHTML = choix.slice(2).map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('');
  fraisMois.value = moisDecale(-1);

  // Lots de mois envoyés à la fonction : 3 mois au plus par appel, pour rester sous sa durée maximale
  function lots() {
    if (selMois.value === 'defaut') return [null];
    if (selMois.value !== 'annee') return [[selMois.value]];
    var tous = [], an = String(new Date().getFullYear());
    for (var i = 0; i < 12; i++) { var m = moisDecale(-i); if (m.slice(0, 4) === an) tous.unshift(m); }
    var out = []; for (var j = 0; j < tous.length; j += 3) out.push(tous.slice(j, j + 3));
    return out;
  }
  function fusionner(a, b) {
    if (!a) return b;
    ['mois', 'comptes_crees', 'profils', 'missions', 'activite', 'frais', 'ignores'].forEach(function (k) { a[k] = (a[k] || []).concat(b[k] || []); });
    // Profils et missions sont relus à chaque lot : on ne garde qu'une ligne par personne / affaire
    var vus = {};
    a.profils = a.profils.filter(function (p) { var k = 'p' + p.qui; return vus[k] ? false : (vus[k] = 1); });
    a.missions = a.missions.filter(function (m) { var k = 'm' + m.qui + m.affaire; return vus[k] ? false : (vus[k] = 1); });
    a.comptes_crees = a.comptes_crees.filter(function (c) { var k = 'c' + c.email; return vus[k] ? false : (vus[k] = 1); });
    a.ignores = a.ignores.filter(function (t) { var k = 'i' + t; return vus[k] ? false : (vus[k] = 1); });
    return a;
  }
  // ---------------------------------------------------------------------
  // Pendant un passage : la page est bloquée (voile) et l'avancement de chaque tâche s'affiche,
  // lu toutes les 1,5 s dans public.vsp_sync_suivi, que la fonction met à jour au fil de l'eau.
  // ---------------------------------------------------------------------
  var voile = null, enCours = false;
  function ouvrirVoile(titre) {
    enCours = true;
    voile = document.createElement('div');
    voile.setAttribute('role', 'alertdialog'); voile.setAttribute('aria-modal', 'true'); voile.setAttribute('aria-labelledby', 'voile-titre');
    voile.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(19,32,56,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    voile.innerHTML = '<div class="box" style="width:min(560px,100%);max-height:90vh;overflow:auto;margin:0;box-shadow:0 20px 50px rgba(0,0,0,.25)">' +
      '<h2 class="box__title" id="voile-titre" style="font-size:18px;margin:0 0 4px">' + esc(titre) + '</h2>' +
      '<p class="small" style="margin:0 0 14px;font-size:14px">L\'espace est bloqué pendant le passage pour éviter les modifications en parallèle. Ne fermez pas cette page.</p>' +
      '<div id="voile-lot" class="small" style="font-weight:600;margin-bottom:10px"></div><div id="voile-etapes"><p class="loading">Démarrage…</p></div></div>';
    document.body.appendChild(voile);
    voile.addEventListener('keydown', function (e) { if (e.key === 'Tab') e.preventDefault(); });
    voile.tabIndex = -1; voile.focus();
  }
  function fermerVoile() { enCours = false; if (voile) { voile.remove(); voile = null; } }
  window.addEventListener('beforeunload', function (e) { if (enCours) { e.preventDefault(); e.returnValue = ''; } });

  var LIB_ETAPES = { base: 'Salariés, contrats et affectations', affaires: 'Affaires et volets de régie', cra: 'CRA mensuels', frais: 'Notes de frais', ecriture: 'Comparaison et enregistrement dans l\'espace' };
  var ORDRE = ['base', 'affaires', 'cra', 'frais', 'ecriture'];
  function dessinerEtapes(etapes) {
    var el = voile && voile.querySelector('#voile-etapes');
    if (!el) return;
    el.innerHTML = ORDRE.map(function (k) {
      var e = (etapes || {})[k] || {};
      var pct = e.total ? Math.round(100 * Math.min(e.fait || 0, e.total) / e.total) : (e.fini ? 100 : 0);
      var etat = e.fini ? '✓' : e.total || e.fait ? pct + ' %' : 'en attente';
      return '<div style="margin:0 0 12px"><div style="display:flex;justify-content:space-between;gap:8px;font-size:14px"><span>' + esc(LIB_ETAPES[k]) + '</span><span class="small">' + esc(etat) + (e.total ? ' · ' + (e.fait || 0) + '/' + e.total : '') + '</span></div>' +
        '<div style="height:8px;border-radius:4px;background:var(--bg);overflow:hidden;margin-top:4px"><div style="height:100%;width:' + pct + '%;background:' + (e.fini ? 'var(--navy, #1d2b4f)' : 'var(--rose, #c187a1)') + ';transition:width .4s"></div></div>' +
        (e.texte ? '<div class="small" style="font-size:13px;margin-top:2px">' + esc(e.texte) + '</div>' : '') + '</div>';
    }).join('');
  }
  function uuid() { return (crypto.randomUUID && crypto.randomUUID()) || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }

  async function syncDejaEnCours() {
    var r = await db.from('vsp_sync_suivi').select('par, maj').eq('fini', false).gt('maj', new Date(Date.now() - 3 * 60000).toISOString()).limit(1);
    return r.data && r.data[0];
  }

  async function appeler(action) {
    var autre = await syncDejaEnCours();
    if (autre) throw new Error('Une synchronisation est déjà en cours (lancée par ' + (autre.par || 'un autre administrateur') + '). Réessayez dans quelques minutes.');
    var liste = lots(), plan = null, statutG = 'ok';
    ouvrirVoile(action === 'apercu' ? 'Aperçu de la synchronisation VSP' : 'Synchronisation VSP en cours');
    try {
      for (var i = 0; i < liste.length; i++) {
        var lib = liste[i] ? liste[i].map(libMois).join(', ') : 'mois écoulé et mois en cours';
        voile.querySelector('#voile-lot').textContent = (liste.length > 1 ? 'Lot ' + (i + 1) + ' sur ' + liste.length + ' · ' : '') + lib;
        dessinerEtapes({});
        var id = uuid();
        var t = setInterval(async function () {
          var s = await db.from('vsp_sync_suivi').select('etapes').eq('id', id).maybeSingle();
          if (s.data) dessinerEtapes(s.data.etapes);
        }, 1500);
        try {
          var r = await appelerUn(action, liste[i], id);
          plan = fusionner(plan, r.resultat);
          if (r.statut === 'partiel') statutG = 'partiel';
        } finally { clearInterval(t); }
      }
    } finally { fermerVoile(); }
    return { statut: statutG, resultat: plan };
  }
  async function appelerUn(action, mois, suivi) {
    var corps = { action: action, suivi: suivi };
    if (mois) corps.mois = mois;
    var r = await db.functions.invoke('vsp-sync', { body: corps });
    if (r.error) {
      var detail = null;
      try { detail = r.error.context && (await r.error.context.json()); } catch (e) { /* corps illisible */ }
      throw new Error((detail && detail.erreur) || r.error.message || 'Synchronisation impossible.');
    }
    if (r.data && r.data.statut === 'erreur') throw new Error((r.data.resultat && r.data.resultat.erreur) || 'Erreur VSP.');
    return r.data;
  }

  function liste(titre, lignes, vide) {
    return '<h3 class="box__title" style="font-size:16px;margin:18px 0 8px">' + esc(titre) + ' <span class="small">(' + lignes.length + ')</span></h3>' +
      (lignes.length ? '<ul class="small" style="font-size:14px;margin:0;padding-left:20px;display:grid;gap:4px">' + lignes.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>'
        : '<p class="small" style="margin:0">' + esc(vide) + '</p>');
  }
  var CHAMPS = { prenom: 'prénom', nom: 'nom', civilite: 'civilité', telephone: 'téléphone', adresse: 'adresse', code_postal: 'code postal', ville: 'ville', pays: 'pays',
    date_naissance: 'date de naissance', lieu_naissance: 'lieu de naissance', nationalite: 'nationalité', competences: 'poste', statut: 'statut', vsp_id: 'ID VSP',
    intitule: 'intitulé', client: 'client', client_final: 'client final', date_debut: 'début', date_fin: 'fin', tjm: 'TJM', numero_contrat: 'n° de contrat', htp_interlocuteur_nom: 'commercial' };
  function champs(t) { return t.map(function (c) { return CHAMPS[c] || c; }).join(', '); }
  function afficher(plan, applique) {
    var mois = (plan.mois || []).map(libMois).join(' et ');
    rapport.innerHTML =
      '<p style="margin:0 0 4px;font-size:15px"><strong>' + (applique ? 'Synchronisation faite' : 'Aperçu : rien n\'est encore enregistré') + '</strong> · ' + esc(mois) + '</p>' +
      liste('Comptes créés (sans e-mail)', (plan.comptes_crees || []).map(function (c) { return esc(c.nom) + ' · ' + esc(c.email); }), 'Aucun nouveau consultant dans VSP.') +
      liste('Profils mis à jour', (plan.profils || []).map(function (p) { return '<strong>' + esc(p.qui) + '</strong> : ' + esc(champs(p.champs)); }), 'Les profils sont déjà à jour.') +
      liste('Missions', (plan.missions || []).map(function (m) { return '<strong>' + esc(m.qui) + '</strong> · ' + esc(m.affaire) + ' : ' + (m.nouvelle ? 'nouvelle mission' : esc(champs(m.champs))); }), 'Les missions sont déjà à jour.') +
      liste('Comptes d\'activité', (plan.activite || []).map(function (a) { return '<strong>' + esc(a.qui) + '</strong> · ' + esc(libMois(a.mois)) + ' : ' + E.n0(a.jours) + ' j' + (a.ca_ht != null ? ' · ' + E.eur(a.ca_ht) + ' HT' : ' · CA non calculé (TJM absent)') + (a.cra ? ' · CRA ' + esc(a.cra) : ''); }), 'Aucun CRA sur la période.') +
      liste('Notes de frais', (plan.frais || []).map(function (f) { return '<strong>' + esc(f.qui) + '</strong> · ' + esc(libMois(f.mois)) + ' : ' + f.lignes + ' ligne(s), ' + E.eur(f.total_ttc, true) + ' TTC'; }), 'Aucune note de frais sur la période.') +
      ((plan.ignores || []).length ? liste('Non repris', plan.ignores.map(esc), '') : '');
    rapport.hidden = false;
  }

  var dernierApercu = null;
  btnApercu.addEventListener('click', async function () {
    btnApercu.disabled = true; btnAppliquer.hidden = true; rapport.hidden = true;
    E.setStatus(statut, 'Lecture de VSP… (une à deux minutes)');
    try {
      var r = await appeler('apercu');
      dernierApercu = selMois.value;
      afficher(r.resultat, false);
      E.setStatus(statut, 'Aperçu prêt. Vérifiez, puis synchronisez.', 'ok');
      btnAppliquer.hidden = false;
    } catch (e) { E.setStatus(statut, e.message, 'error'); }
    finally { btnApercu.disabled = false; }
  });
  btnAppliquer.addEventListener('click', async function () {
    if (dernierApercu !== selMois.value) { E.setStatus(statut, 'La période a changé : refaites l\'aperçu.', 'error'); btnAppliquer.hidden = true; return; }
    btnAppliquer.disabled = true; btnApercu.disabled = true;
    E.setStatus(statut, 'Synchronisation en cours…');
    try {
      var r = await appeler('appliquer');
      afficher(r.resultat, true);
      E.setStatus(statut, r.statut === 'partiel' ? 'Synchronisation faite, avec des éléments non repris (voir la liste).' : 'Synchronisation faite. Aucun e-mail n\'a été envoyé.', r.statut === 'partiel' ? 'error' : 'ok');
      btnAppliquer.hidden = true;
      chargerHistorique(); chargerFrais();
    } catch (e) { E.setStatus(statut, e.message, 'error'); }
    finally { btnAppliquer.disabled = false; btnApercu.disabled = false; }
  });

  var ACTIONS = { apercu: 'Aperçu', appliquer: 'Synchronisation', auto: 'Synchronisation mensuelle automatique', explorer: 'Exploration' };
  async function chargerHistorique() {
    var r = await db.from('vsp_sync_runs').select('quand, action, mois, par, statut, duree_ms').order('quand', { ascending: false }).limit(8);
    if (r.error) { histo.innerHTML = '<p class="small">Historique indisponible.</p>'; return; }
    var auto = (r.data || []).find(function (x) { return x.action === 'auto'; });
    histo.innerHTML = '<p class="small" style="margin:0 0 8px;font-size:14px">Synchronisation mensuelle automatique : chaque jour à 6 h, le mois écoulé est synchronisé <strong>une seule fois</strong>, dès que tous ses CRA sont validés dans VSP.' +
      (auto ? ' Dernière : ' + esc(E.date(auto.quand)) + (auto.mois ? ' (' + esc(libMois(auto.mois.slice(0, 7))) + ')' : '') + '.' : ' Pas encore passée.') + '</p>' +
      (r.data.length ? '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Quand</th><th scope="col">Action</th><th scope="col">Par</th><th scope="col">Résultat</th><th scope="col">Durée</th></tr></thead><tbody>' +
        r.data.map(function (x) {
          var d = new Date(x.quand);
          return '<tr><td>' + esc(E.date(x.quand)) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + '</td><td>' + esc(ACTIONS[x.action] || x.action) + '</td><td>' + esc(x.par || '—') + '</td><td>' +
            E.tag('sync', x.statut) + '</td><td>' + (x.duree_ms != null ? Math.round(x.duree_ms / 1000) + ' s' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '');
  }
  E.LIBELLES.sync = { ok: ['Réussi', ''], partiel: ['Partiel', 'tag--rose'], erreur: ['Erreur', 'tag--rose'] };

  async function chargerFrais() {
    var m = fraisMois.value + '-01';
    var r = await db.from('notes_frais').select('user_id, date_frais, type, montant_ht, montant_ttc, devise, motif').eq('mois', m).order('date_frais');
    if (r.error) { fraisEl.innerHTML = '<p class="small">' + esc(E.errText(r.error)) + '</p>'; return; }
    if (!r.data.length) { fraisEl.innerHTML = '<p class="small" style="margin:0">Aucune note de frais pour ' + esc(libMois(fraisMois.value)) + '. Elles arrivent à chaque synchronisation.</p>'; return; }
    var ids = r.data.map(function (f) { return f.user_id; }).filter(function (v, i, t) { return t.indexOf(v) === i; });
    var p = await db.from('profils').select('id, prenom, nom, email').in('id', ids);
    var noms = {}; (p.data || []).forEach(function (x) { noms[x.id] = [x.prenom, x.nom].filter(Boolean).join(' ') || x.email; });
    var parQui = {};
    r.data.forEach(function (f) { (parQui[f.user_id] = parQui[f.user_id] || []).push(f); });
    fraisEl.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Consultant</th><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Motif</th><th scope="col" style="text-align:right">HT</th><th scope="col" style="text-align:right">TTC</th></tr></thead><tbody>' +
      Object.keys(parQui).sort(function (a, b) { return String(noms[a]).localeCompare(String(noms[b])); }).map(function (uid) {
        var l = parQui[uid], tot = l.reduce(function (t, f) { return t + (Number(f.montant_ttc) || 0); }, 0);
        return l.map(function (f, i) {
          return '<tr><td>' + (i ? '' : '<strong>' + esc(noms[uid] || '—') + '</strong>') + '</td><td>' + esc(E.date(f.date_frais)) + '</td><td>' + esc(f.type || '—') + '</td><td>' + esc(f.motif || '') + '</td><td style="text-align:right">' + E.eur(f.montant_ht, true) + '</td><td style="text-align:right">' + E.eur(f.montant_ttc, true) + '</td></tr>';
        }).join('') + '<tr><td></td><td colspan="4" class="small">Total ' + esc(noms[uid] || '') + '</td><td style="text-align:right"><strong>' + E.eur(tot, true) + '</strong></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  fraisMois.addEventListener('change', chargerFrais);
  selMois.addEventListener('change', function () { btnAppliquer.hidden = true; });

  // Chargement quand la rubrique s'affiche (et tout de suite si elle est déjà ouverte)
  var charge = false;
  var fraisCharges = false;
  function siOuvert() {
    var sec = E.sectionAdmin();
    if (!charge && sec === 'import') { charge = true; chargerHistorique(); }
    if (!fraisCharges && sec === 'frais') { fraisCharges = true; chargerFrais(); }
  }
  window.addEventListener('hashchange', siOuvert);
  var t = setInterval(function () { if (E.state) { clearInterval(t); siOuvert(); } }, 200);
})();
