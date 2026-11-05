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
  var choix = [['defaut', 'Mois écoulé et mois en cours']];
  for (var i = 0; i < 12; i++) { var m = moisDecale(-i); choix.push([m, libMois(m)]); }
  selMois.innerHTML = choix.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('');
  fraisMois.innerHTML = choix.slice(1).map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('');
  fraisMois.value = moisDecale(-1);

  var dernierApercu = null;
  async function appeler(action) {
    var corps = { action: action };
    if (selMois.value !== 'defaut') corps.mois = selMois.value;
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
  function siOuvert() { if (!charge && E.sectionAdmin() === 'import') { charge = true; chargerHistorique(); chargerFrais(); } }
  window.addEventListener('hashchange', siOuvert);
  var t = setInterval(function () { if (E.state) { clearInterval(t); siOuvert(); } }, 200);
})();
