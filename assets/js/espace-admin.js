// Espace HT Portage — administration (réservée aux comptes de la table admins).
// Une rubrique affichée à la fois (#apercu, #consultants, #a-valider, #signatures, #import, #demandes).
// Chaque liste a sa recherche, ses filtres avec compteurs, son tri et sa pagination.
(async function () {
  'use strict';
  var E = window.ESPACE, db = E.db, esc = E.esc;
  var st = await E.guard({ admin: true });
  if (!st) return;

  // Données chargées une fois puis filtrées localement
  var D = { profils: [], profilsTous: [], invitations: [], missions: [], docs: [], cands: [], contacts: [], recos: [] };
  var STATUTS_PROFIL = [['candidat', 'Candidat'], ['consultant', 'Consultant'], ['sorti', 'Sorti']];
  var STATUTS_MISSION = [['brouillon', 'Brouillon'], ['a_valider', 'À valider'], ['validee', 'Validée'], ['active', 'Active'], ['terminee', 'Terminée'], ['annulee', 'Annulée']];
  var STATUTS_CAND = [['nouvelle', 'Nouvelle'], ['en cours', 'En cours'], ['retenue', 'Retenue'], ['archivee', 'Archivée']];
  var STATUTS_RECO = [['nouvelle', 'Nouvelle'], ['en cours', 'En cours'], ['validee', 'Aboutie'], ['prime versee', 'Prime versée'], ['refusee', 'Refusée']];

  function options(liste, val) {
    return liste.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  }
  function nomDe(p) { return [p.prenom, p.nom].filter(Boolean).join(' ') || p.email; }
  function profil(id) { return D.profils.find(function (x) { return x.id === id; }) || { email: '?' }; }
  // Recherche insensible aux accents, à la casse et à l'ordre des mots
  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function correspond(texte, q) {
    var t = norm(texte);
    return norm(q).split(/\s+/).filter(Boolean).every(function (mot) { return t.indexOf(mot) >= 0; });
  }
  function jours(d) { return d ? Math.floor((Date.now() - new Date(d).getTime()) / 864e5) : null; }
  function ilYa(d) {
    var n = jours(d);
    if (n === null) return '';
    return n <= 0 ? "aujourd'hui" : n === 1 ? 'hier' : 'il y a ' + n + ' jours';
  }
  function cmpTexte(f) { return function (a, b) { return norm(f(a)).localeCompare(norm(f(b)), 'fr'); }; }
  function cmpDate(f, asc) { return function (a, b) { var x = f(a) || '', y = f(b) || ''; return asc ? (x < y ? -1 : x > y ? 1 : 0) : (x < y ? 1 : x > y ? -1 : 0); }; }

  // =====================================================================
  // Liste réutilisable : recherche + filtres (pastilles avec compteurs) + tri + pagination
  // =====================================================================
  function Liste(o) {
    var etat = { q: '', filtre: null, tri: o.tris[0].id, page: 0, choisi: false };
    var parPage = o.parPage || 20;
    var id = o.el.id;
    o.el.innerHTML =
      '<div class="liste-outils">' +
        '<div class="liste-recherche"><label class="visually-hidden" for="q-' + id + '">Rechercher</label>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' +
        '<input class="input" id="q-' + id + '" type="search" autocomplete="off" placeholder="' + esc(o.placeholder || 'Rechercher') + '"></div>' +
        (o.tris.length > 1 ? '<div class="liste-tri"><label for="t-' + id + '">Trier par</label><select class="select" id="t-' + id + '">' +
          o.tris.map(function (t) { return '<option value="' + t.id + '">' + esc(t.label) + '</option>'; }).join('') + '</select></div>' : '') +
      '</div>' +
      '<div class="chips" role="group" aria-label="Filtrer"></div>' +
      '<p class="liste-compte" aria-live="polite"></p>' +
      '<div class="liste-resultats"></div>' +
      '<nav class="pager" aria-label="Pagination"></nav>';
    var inp = o.el.querySelector('input[type=search]'), sel = o.el.querySelector('.liste-tri select');
    var chipsEl = o.el.querySelector('.chips'), compteEl = o.el.querySelector('.liste-compte');
    var resEl = o.el.querySelector('.liste-resultats'), pagerEl = o.el.querySelector('.pager');
    var minuteur;
    inp.addEventListener('input', function () { clearTimeout(minuteur); minuteur = setTimeout(function () { etat.q = inp.value; etat.page = 0; maj(); }, 120); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Escape' && inp.value) { inp.value = ''; etat.q = ''; etat.page = 0; maj(); } });
    if (sel) sel.addEventListener('change', function () { etat.tri = sel.value; etat.page = 0; maj(); });
    chipsEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-filtre]'); if (!b) return;
      etat.filtre = b.dataset.filtre; etat.choisi = true; etat.page = 0; maj();
    });
    pagerEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-page]'); if (!b) return;
      etat.page = Number(b.dataset.page); maj();
      o.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    function maj() {
      var tous = o.items();
      var trouves = etat.q ? tous.filter(function (x) { return correspond(o.texte(x), etat.q); }) : tous;
      // Filtre par défaut « intelligent » : le premier qui contient quelque chose à traiter, sinon « Tous »
      var comptes = o.filtres.map(function (f) { return trouves.filter(f.test).length; });
      if (!etat.choisi || !o.filtres.some(function (f) { return f.id === etat.filtre; })) {
        var defaut = o.filtres.find(function (f, i) { return f.prioritaire && comptes[i] > 0; });
        etat.filtre = (defaut || o.filtres.find(function (f) { return f.id === 'tous'; }) || o.filtres[0]).id;
      }
      var fi = o.filtres.findIndex(function (f) { return f.id === etat.filtre; });
      chipsEl.innerHTML = o.filtres.map(function (f, i) {
        return '<button type="button" class="chip' + (f.alerte && comptes[i] ? ' chip--alerte' : '') + '" data-filtre="' + f.id + '" aria-pressed="' + (i === fi) + '">' + esc(f.label) + ' <span class="chip__n">' + comptes[i] + '</span></button>';
      }).join('');
      var liste = trouves.filter(o.filtres[fi].test);
      var tri = o.tris.find(function (t) { return t.id === etat.tri; }) || o.tris[0];
      liste = liste.slice().sort(tri.cmp);
      var pages = Math.max(1, Math.ceil(liste.length / parPage));
      if (etat.page >= pages) etat.page = pages - 1;
      var debut = etat.page * parPage, morceau = liste.slice(debut, debut + parPage);
      compteEl.textContent = liste.length ? (liste.length + ' ' + (liste.length > 1 ? o.unites[1] : o.unites[0]) + (etat.q ? ' pour « ' + etat.q.trim() + ' »' : '') + (pages > 1 ? ' · ' + (debut + 1) + '–' + (debut + morceau.length) : '')) : '';
      resEl.innerHTML = morceau.length ? o.rendre(morceau) :
        '<div class="empty-state">' + (etat.q ? 'Aucun résultat pour « ' + esc(etat.q.trim()) + ' ». <button class="link-btn" type="button" data-effacer>Effacer la recherche</button>' : esc(tous.length ? o.videFiltre || 'Rien dans cette catégorie.' : o.vide)) + '</div>';
      var eff = resEl.querySelector('[data-effacer]');
      if (eff) eff.addEventListener('click', function () { inp.value = ''; etat.q = ''; maj(); inp.focus(); });
      pagerEl.innerHTML = pages > 1 ? pagination(etat.page, pages) : '';
      if (o.apres) o.apres(resEl);
    }
    function pagination(cur, n) {
      var h = '<button class="btn btn--light btn--sm" type="button" data-page="' + (cur - 1) + '"' + (cur === 0 ? ' disabled' : '') + '>Précédent</button><span class="pager__pages">';
      for (var i = 0; i < n; i++) {
        if (n > 7 && i > 0 && i < n - 1 && Math.abs(i - cur) > 1) { if (i === 1 || i === n - 2) h += '<span aria-hidden="true">…</span>'; continue; }
        h += '<button type="button" class="pager__n" data-page="' + i + '"' + (i === cur ? ' aria-current="page"' : '') + ' aria-label="Page ' + (i + 1) + '">' + (i + 1) + '</button>';
      }
      return h + '</span><button class="btn btn--light btn--sm" type="button" data-page="' + (cur + 1) + '"' + (cur >= n - 1 ? ' disabled' : '') + '>Suivant</button>';
    }
    return {
      maj: maj,
      chercher: function (q, filtre) { inp.value = q || ''; etat.q = q || ''; etat.page = 0; if (filtre) { etat.filtre = filtre; etat.choisi = true; } maj(); }
    };
  }

  // =====================================================================
  // Consultants
  // =====================================================================
  function dossierComplet(p) { var m = E.manquants(p); return !m.identite.length && !m.coordonnees.length; }
  function missionsDe(uid) { return D.missions.filter(function (m) { return m.user_id === uid; }); }
  var listeEl = document.getElementById('liste-consultants');
  var LC = Liste({
    el: listeEl, unites: ['compte', 'comptes'], placeholder: 'Nom, e-mail, téléphone, ville, client, ID VSP…',
    vide: 'Aucun compte créé pour le moment.',
    items: function () { return D.profils; },
    texte: function (p) {
      return [nomDe(p), p.email, p.telephone, p.ville, p.vsp_id, p.competences, p.code_parrainage]
        .concat(missionsDe(p.id).map(function (m) { return [m.client, m.client_final, m.numero_contrat, m.intitule].join(' '); })).join(' ');
    },
    filtres: [
      { id: 'tous', label: 'Tous', test: function () { return true; } },
      { id: 'consultant', label: 'Consultants', test: function (p) { return p.statut === 'consultant'; } },
      { id: 'candidat', label: 'Candidats', test: function (p) { return p.statut === 'candidat'; } },
      { id: 'incomplet', label: 'Dossier incomplet', test: function (p) { return p.statut !== 'sorti' && !dossierComplet(p); } },
      { id: 'sorti', label: 'Sortis', test: function (p) { return p.statut === 'sorti'; } }
    ],
    tris: [
      { id: 'recent', label: 'Inscription récente', cmp: cmpDate(function (p) { return p.created_at; }) },
      { id: 'nom', label: 'Nom (A → Z)', cmp: cmpTexte(function (p) { return (p.nom || '') + ' ' + (p.prenom || '') + p.email; }) },
      { id: 'ancien', label: 'Inscription ancienne', cmp: cmpDate(function (p) { return p.created_at; }, true) }
    ],
    rendre: function (liste) {
      return '<div class="table-wrap"><table class="table" style="min-width:900px"><thead><tr>' +
        '<th scope="col">Nom</th><th scope="col">Mission en cours</th><th scope="col">Dossier</th><th scope="col">Statut</th><th scope="col">ID VSP</th><th scope="col">Inscrit le</th><th scope="col"><span class="visually-hidden">Actions</span></th>' +
        '</tr></thead><tbody>' + liste.map(function (p) {
          var ms = missionsDe(p.id), enCours = ms.find(function (m) { return m.statut === 'active'; }) || ms.find(function (m) { return ['validee', 'a_valider', 'brouillon'].indexOf(m.statut) >= 0; });
          var inv = invitationDe(p.id);
          return '<tr data-id="' + p.id + '"><td><strong>' + esc(nomDe(p)) + '</strong><br><span class="small">' + esc(p.email) + (p.telephone ? ' · ' + esc(p.telephone) : '') + '</span>' +
            (inv ? '<br><span class="tag ' + (inv.ouvert_le ? 'tag--ok' : 'tag--rose') + '" style="margin-top:4px">' + (inv.ouvert_le ? 'Invitation ouverte' : 'Invité le ' + E.date(inv.envoye_le)) + '</span>' : '') + '</td>' +
            '<td>' + (enCours ? esc(enCours.client || enCours.intitule || '') + '<br>' + E.tag('mission', enCours.statut) : '<span class="small">—</span>') + '</td>' +
            '<td>' + (dossierComplet(p) ? '<span class="tag tag--ok">Complet</span>' : '<span class="tag tag--manque">Incomplet</span>') + '</td>' +
            '<td><label class="visually-hidden" for="s-' + p.id + '">Statut de ' + esc(nomDe(p)) + '</label><select class="select" id="s-' + p.id + '" data-champ="statut">' + options(STATUTS_PROFIL, p.statut) + '</select></td>' +
            '<td><label class="visually-hidden" for="v-' + p.id + '">ID VSP de ' + esc(nomDe(p)) + '</label><input class="input" id="v-' + p.id + '" data-champ="vsp_id" value="' + esc(p.vsp_id || '') + '" maxlength="100" style="width:120px"></td>' +
            '<td style="white-space:nowrap">' + E.date(p.created_at) + '</td>' +
            '<td><div class="row-actions"><button class="btn btn--light btn--sm" type="button" data-action="enregistrer">Enregistrer</button>' +
            '<button class="btn btn--dark btn--sm" type="button" data-action="fiche">Fiche</button></div></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
  });
  listeEl.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-action]');
    if (!b) return;
    var tr = b.closest('tr'), id = tr.dataset.id;
    var p = profil(id);
    if (b.dataset.action === 'fiche') { ouvrirFiche(p); return; }
    var maj = { statut: tr.querySelector('[data-champ=statut]').value, vsp_id: tr.querySelector('[data-champ=vsp_id]').value.trim() || null };
    b.disabled = true; b.textContent = '…';
    var r = await db.from('profils').update(maj).eq('id', id);
    b.disabled = false;
    if (r.error) { b.textContent = 'Erreur'; alert(E.errText(r.error)); return; }
    Object.assign(p, maj);
    b.textContent = 'Enregistré';
    setTimeout(function () { b.textContent = 'Enregistrer'; }, 1500);
  });

  // =====================================================================
  // Reprise des consultants déjà en poste (salariés VSP)
  // =====================================================================
  var rTexte = document.getElementById('reprise-texte'), rStatut = document.getElementById('reprise-statut');
  var rApercu = document.getElementById('reprise-apercu'), rCreer = document.getElementById('reprise-creer');
  var aCreer = [];
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function lireReprise(texte) {
    var vus = {}, ok = [], ko = [];
    texte.split(/\r?\n/).forEach(function (ligne, i) {
      if (!ligne.trim()) return;
      var c = ligne.split(ligne.indexOf('\t') >= 0 ? '\t' : ligne.indexOf(';') >= 0 ? ';' : ',').map(function (x) { return x.trim(); });
      // Ligne d'en-tête copiée d'Excel
      if (i === 0 && /pr[ée]nom/i.test(c[0] || '') && /mail/i.test(c[2] || '')) return;
      var x = { prenom: c[0] || '', nom: c[1] || '', email: (c[2] || '').toLowerCase(), telephone: c[3] || '', vsp_id: c[4] || '' };
      var err = !x.prenom || !x.nom ? 'prénom et nom obligatoires' : !EMAIL_RE.test(x.email) ? 'e-mail invalide' : vus[x.email] ? 'e-mail en double dans la liste' : '';
      vus[x.email] = true;
      if (err) ko.push('Ligne ' + (i + 1) + ' (' + (ligne.trim().slice(0, 60)) + ') : ' + err); else ok.push(x);
    });
    return { ok: ok, ko: ko };
  }
  function existant(email) { return D.profilsTous.find(function (p) { return (p.email || '').toLowerCase() === email; }); }
  document.getElementById('reprise-verifier').addEventListener('click', function () {
    var r = lireReprise(rTexte.value);
    aCreer = r.ok;
    rCreer.hidden = !aCreer.length;
    if (!r.ok.length && !r.ko.length) { E.setStatus(rStatut, 'Collez au moins une ligne.', 'error'); rApercu.innerHTML = ''; return; }
    E.setStatus(rStatut, r.ok.length + ' personne(s) prête(s)' + (r.ko.length ? ' · ' + r.ko.length + ' ligne(s) à corriger' : '') + '.', r.ko.length ? 'error' : 'ok');
    rApercu.innerHTML = (r.ko.length ? '<div class="alerte alerte--manque" style="margin-top:12px"><strong>Lignes ignorées</strong><ul>' + r.ko.map(function (k) { return '<li>' + esc(k) + '</li>'; }).join('') + '</ul></div>' : '') +
      (r.ok.length ? '<div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th scope="col">Prénom</th><th scope="col">Nom</th><th scope="col">E-mail</th><th scope="col">Téléphone</th><th scope="col">ID VSP</th><th scope="col">Compte</th></tr></thead><tbody>' +
        r.ok.map(function (x) {
          var p = existant(x.email);
          return '<tr><td>' + esc(x.prenom) + '</td><td>' + esc(x.nom) + '</td><td>' + esc(x.email) + '</td><td>' + esc(x.telephone || '—') + '</td><td>' + esc(x.vsp_id || '—') + '</td><td>' +
            (p ? '<span class="tag tag--rose">Existe déjà (' + esc(p.statut) + ') : passera consultant</span>' : '<span class="tag tag--muted">À créer</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '');
  });
  rTexte.addEventListener('input', function () { rCreer.hidden = true; });
  rCreer.addEventListener('click', async function () {
    if (!aCreer.length) return;
    rCreer.disabled = true; E.setStatus(rStatut, 'Création des comptes…');
    var r = await db.functions.invoke('consultants', { body: { action: 'creer', consultants: aCreer } });
    rCreer.disabled = false;
    var d = r.data;
    if (r.error) { try { d = await r.error.context.json(); } catch (e) { d = null; } }
    if (!d || !d.resultats) { E.setStatus(rStatut, (d && d.erreur) || 'La création a échoué : la fonction « consultants » est-elle déployée ?', 'error'); return; }
    var bons = d.resultats.filter(function (x) { return x.ok; });
    rCreer.hidden = true; aCreer = []; rTexte.value = '';
    E.setStatus(rStatut, bons.length + ' compte(s) prêt(s)' + (bons.length < d.resultats.length ? ' · ' + (d.resultats.length - bons.length) + ' en erreur' : '') + '. Aucun e-mail n\'a encore été envoyé.', bons.length === d.resultats.length ? 'ok' : 'error');
    await toutRecharger();
    rApercu.innerHTML = '<div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr><th scope="col">Consultant</th><th scope="col">Résultat</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' +
      d.resultats.map(function (x) {
        var p = x.id ? (D.profilsTous.find(function (q) { return q.id === x.id; }) || {}) : {};
        return '<tr data-id="' + esc(x.id || '') + '"><td><strong>' + esc(p.prenom ? nomDe(p) : x.email) + '</strong><br><span class="small">' + esc(x.email) + '</span></td><td>' +
          (x.ok ? '<span class="tag tag--ok">' + (x.cree ? 'Compte créé' : 'Compte existant mis à jour') + '</span>' : '<span class="tag tag--manque">' + esc(x.erreur || 'Erreur') + '</span>') + '</td><td>' +
          (x.ok ? '<div class="row-actions"><button class="btn btn--light btn--sm" type="button" data-reprise="fiche">Fiche : mission et contrats</button><button class="btn btn--dark btn--sm" type="button" data-reprise="inviter">Inviter</button></div>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  });
  rApercu.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-reprise]');
    if (!b) return;
    var id = b.closest('tr').dataset.id, p = profil(id);
    if (b.dataset.reprise === 'fiche') { ouvrirFiche(p); return; }
    await envoyerInvitation(p, b);
  });

  async function envoyerInvitation(p, bouton) {
    var inv = invitationDe(p.id);
    if (!confirm((inv ? 'Renvoyer' : 'Envoyer') + ' l\'invitation à ' + nomDe(p) + ' (' + p.email + ') ?\n\nIl recevra l\'e-mail « Votre espace consultant HT Portage est prêt » pour choisir son mot de passe.' + (inv ? '\nLe lien précédent ne fonctionnera plus.' : ''))) return false;
    var texte = bouton.textContent;
    bouton.disabled = true; bouton.textContent = 'Envoi…';
    var r = await db.functions.invoke('consultants', { body: { action: 'inviter', user_id: p.id } });
    var d = r.data;
    if (r.error) { try { d = await r.error.context.json(); } catch (e) { d = null; } }
    bouton.disabled = false;
    if (!d || !d.ok) { bouton.textContent = texte; alert((d && d.erreur) || 'L\'invitation n\'a pas pu être envoyée.'); return false; }
    bouton.textContent = 'Invitation envoyée';
    await chargerProfils();
    LC.maj();
    if (courant && courant.id === p.id) rendreAcces();
    return true;
  }

  // =====================================================================
  // Fiche consultant (missions et documents)
  // =====================================================================
  var fiche = document.getElementById('fiche'), courant = null;
  var acces = document.getElementById('fiche-acces');
  function rendreAcces() {
    var inv = invitationDe(courant.id);
    acces.innerHTML = '<span style="display:flex;flex-direction:column;gap:2px"><strong style="font-size:15px">Accès à l\'espace</strong><span style="font-size:14px">' +
      (inv ? 'Invitation envoyée le ' + E.date(inv.envoye_le) + (inv.ouvert_le ? ' · lien ouvert le ' + E.date(inv.ouvert_le) : ' · pas encore ouverte') +
        (!inv.ouvert_le && new Date(inv.expire_le) < new Date() ? ' · <strong>lien expiré</strong>' : '')
        : 'Aucune invitation envoyée. Un consultant inscrit lui-même sur le site a déjà son mot de passe.') + '</span></span>' +
      '<button class="btn btn--dark btn--sm" type="button" id="btn-inviter">' + (inv ? 'Renvoyer l\'invitation' : 'Envoyer l\'invitation') + '</button>';
    document.getElementById('btn-inviter').addEventListener('click', function () { envoyerInvitation(courant, this); });
  }
  fiche.querySelector('[data-fermer]').addEventListener('click', function () { fiche.close(); });

  async function ouvrirFiche(p) {
    courant = p;
    document.getElementById('fiche-titre').textContent = nomDe(p);
    document.getElementById('fiche-sous').textContent = p.email + (p.telephone ? ' · ' + p.telephone : '') + (p.competences ? ' · ' + p.competences : '');
    fiche.querySelectorAll('form').forEach(function (f) { f.reset(); E.setStatus(f.querySelector('.form-status'), ''); });
    rendreAcces();
    if (typeof fiche.showModal === 'function') fiche.showModal(); else fiche.setAttribute('open', '');
    await chargerFiche();
  }
  async function chargerFiche() {
    var el = document.getElementById('fiche-missions');
    el.innerHTML = '<p class="loading">Chargement…</p>';
    var r = await Promise.all([
      db.from('consultant_missions').select('*').eq('user_id', courant.id).order('created_at', { ascending: false }),
      db.from('documents').select('*').eq('user_id', courant.id).order('created_at', { ascending: false })
    ]);
    var missions = r[0].data || [], docs = r[1].data || [];
    document.getElementById('d-mission').innerHTML = '<option value="">—</option>' + missions.map(function (m) { return '<option value="' + m.id + '">' + esc(m.intitule) + '</option>'; }).join('');
    el.innerHTML =
      '<h3 class="box__title" style="font-size:16px">Missions</h3>' +
      (missions.length ? '<ul class="list">' + missions.map(function (m) {
        return '<li data-mission="' + m.id + '"><span class="list__main"><strong>' + esc(m.intitule) + '</strong><span>' +
          esc([m.client, m.client_final, m.tjm ? E.eur(m.tjm) + ' HT' : '', E.date(m.date_debut) + ' → ' + E.date(m.date_fin)].filter(Boolean).join(' · ')) + '</span></span>' +
          '<label class="visually-hidden" for="ms-' + m.id + '">Statut</label><select class="select" id="ms-' + m.id + '" style="width:auto;min-height:40px;font-size:14px">' + options(STATUTS_MISSION, m.statut) + '</select></li>';
      }).join('') + '</ul>' : '<p class="small" style="font-size:14px">Aucune mission.</p>') +
      '<h3 class="box__title" style="font-size:16px;margin-top:12px">Documents</h3>' +
      (docs.length ? '<ul class="list">' + docs.map(function (d) {
        return '<li><span class="list__main"><strong>' + esc(d.titre) + '</strong><span>' + esc(E.LIBELLES.typeDoc[d.type] || '') + ' · ' + E.date(d.date_document || d.created_at) + '</span></span>' +
          E.tag('document', d.statut) + (d.storage_path ? ' <button class="link-btn" type="button" data-doc="' + esc(d.storage_path) + '">Ouvrir</button>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="small" style="font-size:14px">Aucun document.</p>');
  }
  E.brancherTelechargements(document.getElementById('fiche-missions'));
  document.getElementById('fiche-missions').addEventListener('change', async function (e) {
    var li = e.target.closest('[data-mission]');
    if (!li) return;
    var r = await db.from('consultant_missions').update({ statut: e.target.value }).eq('id', li.dataset.mission);
    if (r.error) alert(E.errText(r.error));
    toutRecharger();
  });

  var fm = document.getElementById('form-mission');
  fm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var s = fm.querySelector('.form-status');
    if (!fm.checkValidity()) { fm.reportValidity(); E.setStatus(s, "L'intitulé est obligatoire.", 'error'); return; }
    var data = { user_id: courant.id };
    ['intitule', 'client', 'client_final', 'date_debut', 'date_fin', 'tjm', 'statut', 'vsp_id'].forEach(function (k) {
      var v = (fm[k].value || '').trim(); data[k] = v === '' ? null : v;
    });
    if (data.tjm) data.tjm = Number(data.tjm);
    var r = await db.from('consultant_missions').insert(data);
    if (r.error) { E.setStatus(s, E.errText(r.error), 'error'); return; }
    fm.reset(); E.setStatus(s, 'Mission ajoutée.', 'ok');
    chargerFiche();
    toutRecharger();
  });

  var fd = document.getElementById('form-doc');
  fd.addEventListener('submit', async function (e) {
    e.preventDefault();
    var s = fd.querySelector('.form-status');
    if (!fd.checkValidity()) { fd.reportValidity(); E.setStatus(s, 'Titre et fichier obligatoires.', 'error'); return; }
    var file = fd.fichier.files[0];
    if (['application/pdf', 'image/jpeg', 'image/png'].indexOf(file.type) < 0) { E.setStatus(s, 'Format accepté : PDF, JPG ou PNG.', 'error'); return; }
    if (file.size > 10 * 1024 * 1024) { E.setStatus(s, 'Le fichier dépasse 10 Mo.', 'error'); return; }
    var nom = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
    var path = courant.id + '/' + Date.now() + '-' + nom;
    fd.querySelector('[type=submit]').disabled = true; E.setStatus(s, 'Envoi…');
    var up = await db.storage.from('documents').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { fd.querySelector('[type=submit]').disabled = false; E.setStatus(s, E.errText(up.error), 'error'); return; }
    var r = await db.from('documents').insert({
      user_id: courant.id, type: fd.type.value, statut: fd.statut.value, titre: fd.titre.value.trim(),
      date_document: fd.date_document.value || null, mission_id: fd.mission_id.value || null, storage_path: path
    });
    fd.querySelector('[type=submit]').disabled = false;
    if (r.error) { await db.storage.from('documents').remove([path]); E.setStatus(s, E.errText(r.error), 'error'); return; }
    fd.reset(); E.setStatus(s, 'Document déposé : il est visible dans l\'espace du consultant.', 'ok');
    chargerFiche();
  });

  // =====================================================================
  // Dossiers à valider
  // =====================================================================
  var valEl = document.getElementById('liste-valider');
  var prochainNum = '';
  function calculerNumero() {
    var an = new Date().getFullYear(), max = 0;
    D.missions.forEach(function (x) { var m = new RegExp('^HTP-' + an + '-(\\d+)$').exec(x.numero_contrat || ''); if (m) max = Math.max(max, Number(m[1])); });
    prochainNum = 'HTP-' + an + '-' + ('00' + (max + 1)).slice(-3);
  }
  function l(t, v) { return '<div><dt>' + esc(t) + '</dt><dd>' + (v ? esc(v) : '—') + '</dd></div>'; }
  function carteDossier(m) {
    var p = profil(m.user_id), moi = st.profil, id = m.id;
    var mq = E.manquants(p), manq = mq.identite.concat(mq.coordonnees);
    var attente = jours(m.soumise_le || m.updated_at);
    return '<details class="dossier" data-id="' + id + '"' + (valOuverts[id] ? ' open' : '') + '>' +
      '<summary><span class="dossier__titre"><strong>' + esc(nomDe(p)) + '</strong> · ' + esc(m.client || 'Client ?') + (m.intitule ? '<span class="small"> · ' + esc(m.intitule) + '</span>' : '') + '</span>' +
        '<span class="dossier__meta">' + (manq.length ? '<span class="tag tag--manque">Infos manquantes</span>' : '<span class="tag tag--ok">Infos complètes</span>') +
        '<span class="small' + (attente >= 3 ? ' en-retard' : '') + '">Envoyé ' + ilYa(m.soumise_le || m.updated_at) + '</span></span></summary>' +
      '<div class="dossier__corps">' +
      (manq.length ? '<div class="alerte alerte--manque"><strong>Informations personnelles incomplètes</strong><span>Manque : ' + esc(E.listeFr(manq)) + '. Renvoyez le dossier au consultant.</span></div>' : '') +
      '<dl class="recap">' +
        l('Consultant', [p.civilite, nomDe(p)].filter(Boolean).join(' ') + ' · ' + p.email) +
        l('Né(e) le', p.date_naissance ? E.date(p.date_naissance) + (p.lieu_naissance ? ' à ' + p.lieu_naissance : '') : '') +
        l('Adresse', [p.adresse, p.code_postal, p.ville].filter(Boolean).join(' ')) +
        l('N° sécu / IBAN', (p.num_secu ? 'renseigné' : 'manquant') + ' / ' + (p.iban ? 'renseigné' : 'manquant')) +
        l('Objet', m.intitule) + l('Compétences', m.competences) +
        l('Période', E.date(m.date_debut) + (m.date_fin ? ' → ' + E.date(m.date_fin) : '')) + l('TJ', m.tjm ? E.eur(m.tjm) + ' HT' : '') +
        l('Adresse d’exécution', m.adresse_execution) +
        l('Client', [m.client, m.client_siret ? 'SIRET ' + m.client_siret : '', m.client_adresse].filter(Boolean).join(' · ')) +
        l('Signataire client', [m.client_representant, m.client_representant_qualite, m.client_signataire_email].filter(Boolean).join(' · ')) +
        l('Client final', m.client_final) +
        l('Interlocuteur client', [m.interlocuteur_nom, m.interlocuteur_tel, m.interlocuteur_email].filter(Boolean).join(' · ')) +
      '</dl>' +
      '<form class="grid-form" data-form-dossier novalidate style="border-top:1px solid var(--line);padding-top:16px">' +
        '<div class="field"><label for="n-' + id + '">N° du contrat commercial</label><input class="input" id="n-' + id + '" name="numero_contrat" maxlength="50" value="' + esc(m.numero_contrat || prochainNum) + '"></div>' +
        '<div class="field"><label for="f-' + id + '">Frais de gestion</label><input class="input" id="f-' + id + '" value="5 %" readonly></div>' +
        '<div class="field"><label for="hn-' + id + '">Interlocuteur HT Portage</label><input class="input" id="hn-' + id + '" name="htp_interlocuteur_nom" maxlength="200" value="' + esc(m.htp_interlocuteur_nom || nomDe(moi)) + '"></div>' +
        '<div class="field"><label for="ht-' + id + '">Téléphone</label><input class="input" id="ht-' + id + '" name="htp_interlocuteur_tel" maxlength="40" value="' + esc(m.htp_interlocuteur_tel || moi.telephone || '') + '"></div>' +
        '<div class="field full"><label for="he-' + id + '">E-mail</label><input class="input" id="he-' + id + '" name="htp_interlocuteur_email" type="email" maxlength="254" value="' + esc(m.htp_interlocuteur_email || st.user.email) + '"></div>' +
        '<div class="field full"><label for="c-' + id + '">Message au consultant <span class="hint">(obligatoire pour renvoyer le dossier)</span></label><textarea class="textarea" id="c-' + id + '" name="commentaire_admin" maxlength="2000" style="min-height:80px" placeholder="Ex. : merci de préciser l’adresse du client final"></textarea></div>' +
        '<div class="full actions-row"><p class="form-status" role="status" aria-live="polite"></p><div class="row-actions">' +
          '<button class="btn btn--light btn--sm" type="button" data-decision="renvoyer">Renvoyer au consultant</button>' +
          '<button class="btn btn--dark btn--sm" type="button" data-decision="valider">Valider le dossier</button></div></div>' +
      '</form></div></details>';
  }
  var valOuverts = {};
  var LV = Liste({
    el: valEl, unites: ['dossier', 'dossiers'], parPage: 10, placeholder: 'Consultant, client, mission…',
    vide: 'Aucun dossier en attente de validation.',
    items: function () { return D.missions.filter(function (m) { return m.statut === 'a_valider'; }); },
    texte: function (m) { var p = profil(m.user_id); return [nomDe(p), p.email, m.client, m.client_final, m.intitule].join(' '); },
    filtres: [
      { id: 'tous', label: 'Tous', test: function () { return true; } },
      { id: 'complets', label: 'Prêts à valider', test: function (m) { return dossierComplet(profil(m.user_id)); } },
      { id: 'incomplets', label: 'Infos manquantes', test: function (m) { return !dossierComplet(profil(m.user_id)); } },
      { id: 'retard', label: 'En attente depuis 3 jours ou plus', alerte: true, test: function (m) { return jours(m.soumise_le || m.updated_at) >= 3; } }
    ],
    tris: [
      { id: 'ancien', label: 'Plus anciens d’abord', cmp: cmpDate(function (m) { return m.soumise_le || m.updated_at; }, true) },
      { id: 'recent', label: 'Plus récents d’abord', cmp: cmpDate(function (m) { return m.soumise_le || m.updated_at; }) },
      { id: 'nom', label: 'Consultant (A → Z)', cmp: cmpTexte(function (m) { return nomDe(profil(m.user_id)); }) }
    ],
    rendre: function (liste) {
      // Un seul dossier : on l'ouvre directement
      if (liste.length === 1) valOuverts[liste[0].id] = true;
      return '<div class="dossiers">' + liste.map(carteDossier).join('') + '</div>';
    }
  });
  valEl.addEventListener('toggle', function (e) { var d = e.target; if (d.matches && d.matches('details[data-id]')) valOuverts[d.dataset.id] = d.open; }, true);
  valEl.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-decision]');
    if (!b) return;
    var art = b.closest('[data-id]'), form = art.querySelector('[data-form-dossier]'), status = form.querySelector('.form-status');
    var maj;
    if (b.dataset.decision === 'renvoyer') {
      var c = form.commentaire_admin.value.trim();
      if (!c) { form.commentaire_admin.focus(); E.setStatus(status, 'Écrivez au consultant ce qu’il doit corriger.', 'error'); return; }
      maj = { statut: 'brouillon', commentaire_admin: c };
    } else {
      var num = form.numero_contrat.value.trim();
      if (!num) { form.numero_contrat.focus(); E.setStatus(status, 'Indiquez le n° du contrat commercial.', 'error'); return; }
      var em = form.htp_interlocuteur_email.value.trim();
      if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { form.htp_interlocuteur_email.focus(); E.setStatus(status, 'E-mail de l’interlocuteur HT Portage invalide.', 'error'); return; }
      maj = { statut: 'validee', commentaire_admin: null, numero_contrat: num, frais_gestion: 5,
        htp_interlocuteur_nom: form.htp_interlocuteur_nom.value.trim() || null, htp_interlocuteur_tel: form.htp_interlocuteur_tel.value.trim() || null, htp_interlocuteur_email: em || null };
    }
    art.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
    E.setStatus(status, 'Enregistrement…');
    var r = await db.from('consultant_missions').update(maj).eq('id', art.dataset.id);
    if (r.error) { art.querySelectorAll('button').forEach(function (x) { x.disabled = false; }); E.setStatus(status, E.errText(r.error), 'error'); return; }
    await chargerMissions();
  });

  // =====================================================================
  // Contrats et signatures (dossiers validés)
  // =====================================================================
  var signEl = document.getElementById('liste-signatures');
  // État de signature d'une mission validée, calculé à partir de ses documents
  function etatSignature(m) {
    var sesDocs = D.docs.filter(function (d) { return d.mission_id === m.id || (d.type === 'cdi' && d.user_id === m.user_id); });
    var actifs = sesDocs.filter(function (d) { return ['a_signer', 'signe'].indexOf(d.statut) >= 0; });
    var annexe = actifs.find(function (d) { return d.type === 'annexe' && d.mission_id === m.id; });
    var enAttente = actifs.filter(function (d) { return d.statut === 'a_signer'; });
    var probleme = !annexe && sesDocs.some(function (d) { return d.mission_id === m.id && ['refuse', 'annule'].indexOf(d.statut) >= 0; });
    // Une mission active ou terminée sans annexe Yousign a été contractualisée hors de l'espace : rien à envoyer
    var cle = !annexe ? (m.statut === 'validee' ? 'a_envoyer' : 'signe') : enAttente.length ? 'en_attente' : 'signe';
    var envoye = enAttente.reduce(function (a, d) { return !a || d.envoye_le < a ? d.envoye_le : a; }, null);
    return { cle: cle, docs: sesDocs, probleme: probleme, envoye: envoye };
  }
  var ETATS_SIGN = { a_envoyer: ['À envoyer', 'tag--manque'], en_attente: ['En attente de signature', 'tag--rose'], signe: ['Signé', 'tag--ok'] };
  var LS = Liste({
    el: signEl, unites: ['dossier', 'dossiers'], parPage: 15, placeholder: 'Consultant, client, n° HTP-…',
    vide: 'Aucun dossier validé pour le moment.',
    items: function () { return D.missions.filter(function (m) { return ['validee', 'active', 'terminee'].indexOf(m.statut) >= 0; }); },
    texte: function (m) { var p = profil(m.user_id); return [nomDe(p), p.email, m.client, m.client_final, m.numero_contrat, m.intitule].join(' '); },
    filtres: [
      { id: 'a_envoyer', label: 'À envoyer', prioritaire: true, alerte: true, test: function (m) { return etatSignature(m).cle === 'a_envoyer'; } },
      { id: 'en_attente', label: 'En attente de signature', test: function (m) { return etatSignature(m).cle === 'en_attente'; } },
      { id: 'relancer', label: 'Sans signature depuis 5 jours', alerte: true, test: function (m) { var e = etatSignature(m); return e.cle === 'en_attente' && jours(e.envoye) >= 5; } },
      { id: 'signe', label: 'Signés', test: function (m) { return etatSignature(m).cle === 'signe'; } },
      { id: 'tous', label: 'Tous', test: function () { return true; } }
    ],
    tris: [
      { id: 'recent', label: 'Validés récemment', cmp: cmpDate(function (m) { return m.validee_le || m.updated_at; }) },
      { id: 'numero', label: 'N° de contrat', cmp: cmpTexte(function (m) { return m.numero_contrat || ''; }) },
      { id: 'nom', label: 'Consultant (A → Z)', cmp: cmpTexte(function (m) { return nomDe(profil(m.user_id)); }) }
    ],
    rendre: function (missions) {
      return '<div class="dossiers">' + missions.map(function (m) {
        var p = profil(m.user_id), e = etatSignature(m), t = ETATS_SIGN[e.cle];
        var docs = e.docs.length ? '<ul class="list">' + e.docs.map(function (d) {
          return '<li><span class="list__main"><strong>' + esc(d.titre) + '</strong><span>' + (d.envoye_le ? 'Envoyé le ' + E.date(d.envoye_le) : E.date(d.created_at)) +
            (d.signe_le ? ' · signé le ' + E.date(d.signe_le) : '') + '</span></span>' + E.tag('document', d.statut) +
            (d.storage_path ? ' <button class="link-btn" type="button" data-doc="' + esc(d.storage_path) + '">PDF</button>' : '') + '</li>';
        }).join('') + '</ul>' : '';
        return '<article class="box carte-sign" data-mission="' + m.id + '">' +
          '<div class="box__head"><h3 class="box__title" style="font-size:16px">' + esc([nomDe(p), m.client || m.intitule].filter(Boolean).join(' · ')) + (m.numero_contrat ? ' <span class="small">· ' + esc(m.numero_contrat) + '</span>' : '') + '</h3>' +
          '<span class="dossier__meta">' + (e.probleme ? '<span class="tag tag--manque">Refusé / annulé</span>' : '') + '<span class="tag ' + t[1] + '">' + t[0] + '</span>' +
          (e.cle === 'en_attente' && e.envoye ? '<span class="small' + (jours(e.envoye) >= 5 ? ' en-retard' : '') + '">Envoyé ' + ilYa(e.envoye) + '</span>' : '') + '</span></div>' +
          docs +
          '<div class="actions-row"><p class="form-status" role="status" aria-live="polite"></p><div class="row-actions">' +
            '<button class="btn btn--light btn--sm" type="button" data-contrat="apercu">Aperçu des contrats</button>' +
            (e.cle === 'a_envoyer' ? '<button class="btn btn--dark btn--sm" type="button" data-contrat="envoyer">Envoyer en signature</button>' : '') +
          '</div></div></article>';
      }).join('') + '</div>';
    }
  });
  // Un lien par document : les navigateurs bloquent souvent le 2e téléchargement automatique simultané.
  function lienDocx(f) {
    var bin = atob(f.base64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([u], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    var libelle = /cdi/i.test(f.type || f.nom) ? 'CDI de portage' : 'Annexe 1 — conditions de la mission';
    return '<a class="btn btn--light btn--sm" href="' + url + '" download="' + esc(f.nom) + '">Télécharger : ' + esc(libelle) + '</a>';
  }
  async function appelContrats(missionId, action) {
    var r = await db.functions.invoke('contrats', { body: { mission_id: missionId, action: action } });
    if (r.error) {
      var msg = r.error.message;
      try { var ctx = r.error.context; if (ctx && ctx.json) { var j = await ctx.json(); if (j && j.erreur) msg = j.erreur; } } catch (e) { /* message par défaut */ }
      throw new Error(msg);
    }
    if (r.data && r.data.erreur) throw new Error(r.data.erreur);
    return r.data;
  }
  // =====================================================================
  // Import CSV des comptes d'activité
  // =====================================================================
  var lignesValides = [];
  var rapport = document.getElementById('rapport-import'), btnImport = document.getElementById('btn-importer');
  function normal(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
  var ALIAS = { e_mail: 'email', mail: 'email', id_vsp: 'vsp_id', vsp: 'vsp_id', matricule: 'vsp_id', ca: 'ca_ht', chiffre_d_affaires: 'ca_ht', frais: 'frais_gestion',
    net: 'net_verse', salaire_net: 'net_verse', reserve_financiere: 'reserve', nb_jours: 'jours', jours_travailles: 'jours', periode: 'mois' };
  function nombre(v) {
    if (v == null) return null;
    var s = String(v).replace(/[\s €]/g, '');
    if (s === '') return null;
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    var n = Number(s);
    return isNaN(n) ? NaN : n;
  }
  function mois(v) {
    var s = String(v || '').trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})(-\d{1,2})?$/.exec(s))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-01';
    if ((m = /^(\d{1,2})[\/.-](\d{4})$/.exec(s))) return m[2] + '-' + ('0' + m[1]).slice(-2) + '-01';
    if ((m = /^\d{1,2}[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s))) return m[2] + '-' + ('0' + m[1]).slice(-2) + '-01';
    return null;
  }
  function decouper(ligne, sep) {
    var res = [], cur = '', q = false;
    for (var i = 0; i < ligne.length; i++) {
      var c = ligne[i];
      if (q) { if (c === '"' && ligne[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === sep) { res.push(cur); cur = ''; } else cur += c;
    }
    res.push(cur);
    return res;
  }

  document.getElementById('form-import').addEventListener('submit', async function (e) {
    e.preventDefault();
    var input = document.getElementById('fichier-csv');
    btnImport.hidden = true; lignesValides = [];
    if (!input.files[0]) { input.reportValidity(); return; }
    var texte = (await input.files[0].text()).replace(/^﻿/, '');
    var lignes = texte.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (lignes.length < 2) { montrerRapport('Le fichier est vide ou ne contient que l\'en-tête.'); return; }
    var sep = (lignes[0].match(/;/g) || []).length >= (lignes[0].match(/,/g) || []).length ? ';' : ',';
    var entetes = decouper(lignes[0], sep).map(function (h) { var n = normal(h); return ALIAS[n] || n; });
    if (entetes.indexOf('mois') < 0 || (entetes.indexOf('email') < 0 && entetes.indexOf('vsp_id') < 0)) {
      montrerRapport('Colonnes obligatoires manquantes : « mois » et « email » ou « vsp_id ».\nColonnes trouvées : ' + entetes.join(', '));
      return;
    }
    var parEmail = {}, parVsp = {};
    D.profils.forEach(function (p) { parEmail[(p.email || '').toLowerCase()] = p; if (p.vsp_id) parVsp[p.vsp_id] = p; });
    var erreurs = [];
    lignes.slice(1).forEach(function (l, i) {
      var cols = decouper(l, sep), o = {};
      entetes.forEach(function (h, j) { o[h] = (cols[j] || '').trim(); });
      var n = i + 2;
      var p = (o.vsp_id && parVsp[o.vsp_id]) || (o.email && parEmail[o.email.toLowerCase()]);
      if (!p) { erreurs.push('Ligne ' + n + ' : consultant introuvable (' + (o.email || o.vsp_id || '?') + ')'); return; }
      var m = mois(o.mois);
      if (!m) { erreurs.push('Ligne ' + n + ' : mois illisible « ' + o.mois + ' »'); return; }
      var ligne = { user_id: p.id, mois: m, source: 'vsp', statut: /prov/i.test(o.statut || '') ? 'provisoire' : 'definitif' };
      var ko = false;
      ['jours', 'ca_ht', 'frais_gestion', 'charges', 'reserve', 'net_verse'].forEach(function (k) {
        if (!(k in o)) return;
        var v = nombre(o[k]);
        if (v !== v) { erreurs.push('Ligne ' + n + ' : valeur non numérique pour ' + k + ' « ' + o[k] + ' »'); ko = true; }
        else ligne[k] = v;
      });
      if (!ko) lignesValides.push(ligne);
    });
    var doublons = {};
    lignesValides = lignesValides.filter(function (l) { var k = l.user_id + l.mois; if (doublons[k]) { erreurs.push('Doublon ignoré : ' + l.mois + ' pour le même consultant'); return false; } return (doublons[k] = true); });
    montrerRapport(lignesValides.length + ' ligne(s) prête(s) à importer.' + (erreurs.length ? '\n\n' + erreurs.length + ' ligne(s) ignorée(s) :\n' + erreurs.join('\n') : ''));
    btnImport.hidden = !lignesValides.length;
  });
  btnImport.addEventListener('click', async function () {
    btnImport.disabled = true;
    var r = await db.from('comptes_activite').upsert(lignesValides, { onConflict: 'user_id,mois' });
    btnImport.disabled = false;
    if (r.error) { montrerRapport('Import refusé : ' + E.errText(r.error)); return; }
    montrerRapport(lignesValides.length + ' compte(s) d\'activité importé(s). Ils sont visibles dans l\'espace des consultants.');
    btnImport.hidden = true; lignesValides = [];
    document.getElementById('form-import').reset();
  });
  function montrerRapport(t) { rapport.textContent = t; rapport.hidden = false; }

  E.brancherTelechargements(signEl);
  signEl.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-contrat]');
    if (!b) return;
    var art = b.closest('[data-mission]'), status = art.querySelector('.form-status');
    if (b.dataset.contrat === 'envoyer' && !confirm('Envoyer les contrats en signature ? Le consultant, le client et vous recevrez en même temps un e-mail de Yousign pour signer.')) return;
    art.querySelectorAll('[data-contrat]').forEach(function (x) { x.disabled = true; });
    E.setStatus(status, b.dataset.contrat === 'apercu' ? 'Génération des contrats…' : 'Envoi à Yousign…');
    try {
      var data = await appelContrats(art.dataset.mission, b.dataset.contrat);
      if (b.dataset.contrat === 'apercu') {
        var fichiers = data.fichiers || [], zone = art.querySelector('.apercu-liens');
        if (!zone) { zone = document.createElement('div'); zone.className = 'apercu-liens row-actions'; zone.style.flexWrap = 'wrap'; art.appendChild(zone); }
        zone.innerHTML = fichiers.map(lienDocx).join('');
        E.setStatus(status, fichiers.length + ' document' + (fichiers.length > 1 ? 's' : '') + ' prêt' + (fichiers.length > 1 ? 's' : '') + ' pour relecture' +
          (fichiers.length === 1 ? ' (le CDI a déjà été envoyé pour ce consultant, seule l’annexe est générée)' : '') + ' :', 'ok');
      } else {
        E.setStatus(status, 'Envoyé en signature : ' + (data.envoyes || []).map(function (x) { return x.type === 'cdi' ? 'CDI' : 'annexe'; }).join(' + ') + '.', 'ok');
        setTimeout(function () { chargerDocs().then(function () { LS.chercher('', 'en_attente'); }); }, 800);
      }
    } catch (err) {
      E.setStatus(status, err.message || String(err), 'error');
    } finally {
      art.querySelectorAll('[data-contrat]').forEach(function (x) { x.disabled = false; });
    }
  });

  // =====================================================================
  // Demandes reçues (3 onglets)
  // =====================================================================
  function enregistrerChamp(table, liste) {
    return async function (e) {
      var champ = e.target.dataset.champ, tr = e.target.closest('tr[data-id]');
      if (!champ || !tr) return;
      var val = e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : (e.target.type === 'number' ? Number(e.target.value) : e.target.value));
      var maj = {}; maj[champ] = val;
      var r = await db.from(table).update(maj).eq('id', tr.dataset.id);
      if (r.error) { alert(E.errText(r.error)); return; }
      var obj = liste().find(function (x) { return String(x.id) === tr.dataset.id; });
      if (obj) obj[champ] = val;
      e.target.classList.add('is-saved');
      setTimeout(function () { e.target.classList.remove('is-saved'); majCompteurs(); }, 900);
    };
  }
  // Téléphone et e-mail cliquables (appel ou e-mail en un clic)
  function coordonnees(tel, email) {
    var l = [];
    if (tel) l.push('<a class="coord" href="tel:' + esc(String(tel).replace(/[^0-9+]/g, '')) + '">' + esc(tel) + '</a>');
    if (email) l.push('<a class="coord" href="mailto:' + esc(email) + '">' + esc(email) + '</a>');
    return '<span class="coords">' + (l.length ? l.join('') : '<span class="tag tag--manque">Coordonnées non fournies</span>') + '</span>';
  }
  var candEl = document.getElementById('liste-candidatures'), contEl = document.getElementById('liste-contacts'), recoEl = document.getElementById('liste-recos');
  var LCand = Liste({
    el: candEl, unites: ['candidature', 'candidatures'], placeholder: 'Nom, e-mail, mission, compétence…',
    vide: 'Aucune candidature pour le moment.',
    items: function () { return D.cands; },
    texte: function (c) { return [c.nom, c.email, c.telephone, c.mission_ref, c.message, c.competences, c.poste].join(' '); },
    filtres: [
      { id: 'a_traiter', label: 'À traiter', prioritaire: true, test: function (c) { return !c.statut || c.statut === 'nouvelle' || c.statut === 'en cours'; } },
      { id: 'nouvelle', label: 'Nouvelles', test: function (c) { return !c.statut || c.statut === 'nouvelle'; } },
      { id: 'retenue', label: 'Retenues', test: function (c) { return c.statut === 'retenue'; } },
      { id: 'archivee', label: 'Archivées', test: function (c) { return c.statut === 'archivee'; } },
      { id: 'tous', label: 'Toutes', test: function () { return true; } }
    ],
    tris: [
      { id: 'recent', label: 'Plus récentes', cmp: cmpDate(function (c) { return c.created_at; }) },
      { id: 'ancien', label: 'Plus anciennes', cmp: cmpDate(function (c) { return c.created_at; }, true) },
      { id: 'tjm', label: 'TJM décroissant', cmp: function (a, b) { return (b.tjm_souhaite || 0) - (a.tjm_souhaite || 0); } }
    ],
    rendre: function (cands) {
      return '<div class="table-wrap"><table class="table" style="min-width:820px"><thead><tr><th scope="col">Date</th><th scope="col">Candidat</th><th scope="col">Mission</th><th scope="col">TJM</th><th scope="col">CV</th><th scope="col">Statut</th></tr></thead><tbody>' +
        cands.map(function (c) {
          return '<tr data-id="' + c.id + '"><td style="white-space:nowrap">' + E.date(c.created_at) + '</td><td><strong>' + esc(c.nom) + '</strong>' + coordonnees(c.telephone, c.email) + '</td>' +
            '<td>' + esc(c.mission_ref || 'Spontanée') + '</td><td class="num">' + (c.tjm_souhaite ? E.eur(c.tjm_souhaite) : '—') + '</td>' +
            '<td>' + (c.cv_path ? '<button class="link-btn" type="button" data-doc="' + esc(c.cv_path) + '" data-bucket="cv">CV</button>' : '—') + '</td>' +
            '<td><label class="visually-hidden" for="c-' + c.id + '">Statut</label><select class="select" id="c-' + c.id + '" data-champ="statut">' + options(STATUTS_CAND, c.statut || 'nouvelle') + '</select></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
  });
  var LCont = Liste({
    el: contEl, unites: ['demande', 'demandes'], placeholder: 'Nom, e-mail, message…',
    vide: 'Aucune demande pour le moment.',
    items: function () { return D.contacts; },
    texte: function (c) { return [c.nom, c.email, c.telephone, c.message, c.situation, c.type === 'simulation' ? 'simulation' : 'contact'].join(' '); },
    filtres: [
      { id: 'non_traite', label: 'Non traitées', prioritaire: true, test: function (c) { return !c.traite; } },
      { id: 'simulation', label: 'Simulations', test: function (c) { return c.type === 'simulation'; } },
      { id: 'contact', label: 'Contacts', test: function (c) { return c.type !== 'simulation'; } },
      { id: 'traite', label: 'Traitées', test: function (c) { return !!c.traite; } },
      { id: 'tous', label: 'Toutes', test: function () { return true; } }
    ],
    tris: [
      { id: 'recent', label: 'Plus récentes', cmp: cmpDate(function (c) { return c.created_at; }) },
      { id: 'ancien', label: 'Plus anciennes', cmp: cmpDate(function (c) { return c.created_at; }, true) }
    ],
    rendre: function (contacts) {
      return '<div class="table-wrap"><table class="table" style="min-width:820px"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Contact</th><th scope="col">Message</th><th scope="col">Traité</th></tr></thead><tbody>' +
        contacts.map(function (c) {
          var sim = c.type === 'simulation' ? 'TJM ' + E.eur(c.tjm) + ' · ' + c.jours + ' j · net ' + E.eur(c.net_estime) + '. ' : '';
          return '<tr data-id="' + c.id + '"><td style="white-space:nowrap">' + E.date(c.created_at) + '</td><td>' + (c.type === 'simulation' ? 'Simulation' : 'Contact') + '</td>' +
            '<td><strong>' + esc(c.nom) + '</strong>' + coordonnees(c.telephone, c.email) + '</td>' +
            '<td style="max-width:360px">' + esc(sim + (c.message || c.situation || '')) + '</td>' +
            '<td><label class="check" style="font-size:14px"><input type="checkbox" data-champ="traite"' + (c.traite ? ' checked' : '') + '>Traité</label></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
  });
  var LReco = Liste({
    el: recoEl, unites: ['recommandation', 'recommandations'], placeholder: 'Ambassadeur, personne recommandée…',
    vide: 'Aucune recommandation pour le moment.',
    items: function () { return D.recos; },
    texte: function (x) { return [x.ambassadeur_nom, x.ambassadeur_email, x.contact_nom, x.contact_email, x.contact_telephone, x.details, E.LIBELLES.typeReco[x.type]].join(' '); },
    filtres: [
      { id: 'a_traiter', label: 'À traiter', prioritaire: true, test: function (x) { return !x.statut || x.statut === 'nouvelle' || x.statut === 'en cours'; } },
      { id: 'prime', label: 'Prime à verser', alerte: true, test: function (x) { return x.statut === 'validee'; } },
      { id: 'versee', label: 'Prime versée', test: function (x) { return x.statut === 'prime versee'; } },
      { id: 'refusee', label: 'Refusées', test: function (x) { return x.statut === 'refusee'; } },
      { id: 'tous', label: 'Toutes', test: function () { return true; } }
    ],
    tris: [
      { id: 'recent', label: 'Plus récentes', cmp: cmpDate(function (x) { return x.created_at; }) },
      { id: 'ambassadeur', label: 'Ambassadeur (A → Z)', cmp: cmpTexte(function (x) { return x.ambassadeur_nom || ''; }) }
    ],
    rendre: function (recos) {
      return '<div class="table-wrap"><table class="table" style="min-width:820px"><thead><tr><th scope="col">Date</th><th scope="col">Ambassadeur</th><th scope="col">Recommande</th><th scope="col">Statut</th><th scope="col">Prime (€)</th></tr></thead><tbody>' +
        recos.map(function (x) {
          return '<tr data-id="' + x.id + '"><td style="white-space:nowrap">' + E.date(x.created_at) + '</td><td><strong>' + esc(x.ambassadeur_nom) + '</strong>' + coordonnees(x.user_id ? (D.profilsTous.find(function (p) { return p.id === x.user_id; }) || {}).telephone : null, x.ambassadeur_email) + (x.user_id ? '<span class="small">Compte espace</span>' : '') + '</td>' +
            '<td><strong>' + esc(E.LIBELLES.typeReco[x.type] || x.type) + ' · ' + esc(x.contact_nom) + '</strong>' + coordonnees(x.contact_telephone, x.contact_email) + '<span class="small">' + esc(x.details) + '</span></td>' +
            '<td><label class="visually-hidden" for="r-' + x.id + '">Statut</label><select class="select" id="r-' + x.id + '" data-champ="statut">' + options(STATUTS_RECO, x.statut || 'nouvelle') + '</select></td>' +
            '<td><label class="visually-hidden" for="rp-' + x.id + '">Prime</label><input class="input" id="rp-' + x.id + '" data-champ="prime_montant" type="number" min="0" step="1" value="' + (x.prime_montant == null ? '' : esc(x.prime_montant)) + '" style="width:110px"></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
  });
  candEl.addEventListener('change', enregistrerChamp('candidatures', function () { return D.cands; }));
  contEl.addEventListener('change', enregistrerChamp('contacts', function () { return D.contacts; }));
  recoEl.addEventListener('change', enregistrerChamp('recommandations', function () { return D.recos; }));
  E.brancherTelechargements(document.getElementById('demandes'));

  var onglets = Array.prototype.slice.call(document.querySelectorAll('[data-onglet]'));
  function ouvrirOnglet(nom, focus) {
    onglets.forEach(function (b) {
      var actif = b.dataset.onglet === nom;
      b.setAttribute('aria-selected', actif ? 'true' : 'false'); b.tabIndex = actif ? 0 : -1;
      document.getElementById(b.getAttribute('aria-controls')).hidden = !actif;
      if (actif && focus) b.focus();
    });
  }
  onglets.forEach(function (b, i) {
    b.addEventListener('click', function () { ouvrirOnglet(b.dataset.onglet); });
    b.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); ouvrirOnglet(onglets[(i + d + onglets.length) % onglets.length].dataset.onglet, true); }
    });
  });

  // =====================================================================
  // Vue d'ensemble : indicateurs, « À traiter », recherche globale
  // =====================================================================
  function compteurs() {
    var signes = D.missions.filter(function (m) { return ['validee', 'active', 'terminee'].indexOf(m.statut) >= 0; }).map(etatSignature);
    return {
      consultants: D.profils.filter(function (p) { return p.statut === 'consultant'; }).length,
      candidats: D.profils.filter(function (p) { return p.statut === 'candidat'; }).length,
      aValider: D.missions.filter(function (m) { return m.statut === 'a_valider'; }).length,
      aEnvoyer: signes.filter(function (e) { return e.cle === 'a_envoyer'; }).length,
      enAttente: signes.filter(function (e) { return e.cle === 'en_attente'; }).length,
      signes: signes.filter(function (e) { return e.cle === 'signe'; }).length,
      actives: D.missions.filter(function (m) { return m.statut === 'active'; }).length,
      cands: D.cands.filter(function (c) { return !c.statut || c.statut === 'nouvelle'; }).length,
      contacts: D.contacts.filter(function (c) { return !c.traite; }).length,
      recos: D.recos.filter(function (x) { return !x.statut || x.statut === 'nouvelle'; }).length
    };
  }
  function majCompteurs() {
    var c = compteurs();
    E.badge('a-valider', c.aValider);
    E.badge('signatures', c.aEnvoyer);
    E.badge('demandes', c.cands + c.contacts + c.recos);
    document.querySelectorAll('[data-onglet]').forEach(function (b) {
      var n = { candidatures: c.cands, contacts: c.contacts, recos: c.recos }[b.dataset.onglet];
      b.querySelector('.onglet-n').textContent = n ? String(n) : '';
    });
    function kpi(lien, label, val, note, sombre) {
      return '<a class="kpi kpi--lien' + (sombre ? ' kpi--dark' : '') + '" href="' + lien + '"><span class="kpi__label">' + esc(label) + '</span><span class="kpi__value">' + val + '</span><span class="kpi__note">' + esc(note) + '</span></a>';
    }
    document.getElementById('kpis').innerHTML =
      kpi('#consultants', 'Consultants portés', c.consultants, c.actives + ' mission' + (c.actives > 1 ? 's' : '') + ' active' + (c.actives > 1 ? 's' : '') + ' · ' + c.candidats + ' candidat' + (c.candidats > 1 ? 's' : ''), true) +
      kpi('#a-valider', 'Dossiers à valider', c.aValider, c.aValider ? 'Consultants en attente de votre retour' : 'Rien en attente') +
      kpi('#signatures', 'Contrats', c.aEnvoyer + ' à envoyer', c.enAttente + ' en attente de signature · ' + c.signes + ' signé' + (c.signes > 1 ? 's' : '')) +
      kpi('#demandes', 'Demandes à traiter', c.cands + c.contacts + c.recos, c.cands + ' candidature' + (c.cands > 1 ? 's' : '') + ' · ' + c.contacts + ' contact' + (c.contacts > 1 ? 's' : '') + ' · ' + c.recos + ' reco.');
    afficherATraiter();
  }
  function afficherATraiter() {
    var t = [];
    D.missions.filter(function (m) { return m.statut === 'a_valider'; }).forEach(function (m) {
      t.push({ d: m.soumise_le || m.updated_at, prio: 1, html: '<strong>Dossier à valider</strong> — ' + esc(nomDe(profil(m.user_id))) + ' · ' + esc(m.client || ''), lien: '#a-valider', q: nomDe(profil(m.user_id)) });
    });
    D.missions.filter(function (m) { return ['validee', 'active'].indexOf(m.statut) >= 0; }).forEach(function (m) {
      var e = etatSignature(m), nom = nomDe(profil(m.user_id));
      if (e.cle === 'a_envoyer') t.push({ d: m.validee_le || m.updated_at, prio: 2, html: '<strong>Contrats à envoyer</strong> — ' + esc([nom, m.client, m.numero_contrat].filter(Boolean).join(' · ')), lien: '#signatures', q: m.numero_contrat || nom });
      else if (e.cle === 'en_attente' && jours(e.envoye) >= 5) t.push({ d: e.envoye, prio: 3, html: '<strong>Signature en attente</strong> depuis ' + jours(e.envoye) + ' jours — ' + esc(nom) + ' · ' + esc(m.numero_contrat || ''), lien: '#signatures', q: m.numero_contrat || nom, filtre: 'relancer' });
    });
    D.cands.filter(function (c) { return !c.statut || c.statut === 'nouvelle'; }).forEach(function (c) {
      t.push({ d: c.created_at, prio: 4, html: '<strong>Nouvelle candidature</strong> — ' + esc(c.nom) + (c.mission_ref ? ' · ' + esc(c.mission_ref) : ''), lien: '#demandes', onglet: 'candidatures', q: c.nom });
    });
    D.contacts.filter(function (c) { return !c.traite; }).forEach(function (c) {
      t.push({ d: c.created_at, prio: 5, html: '<strong>' + (c.type === 'simulation' ? 'Demande de simulation' : 'Demande de contact') + '</strong> — ' + esc(c.nom), lien: '#demandes', onglet: 'contacts', q: c.nom });
    });
    D.recos.filter(function (x) { return !x.statut || x.statut === 'nouvelle'; }).forEach(function (x) {
      t.push({ d: x.created_at, prio: 6, html: '<strong>Recommandation</strong> — ' + esc(x.ambassadeur_nom) + ' recommande ' + esc(x.contact_nom), lien: '#demandes', onglet: 'recos', q: x.contact_nom });
    });
    t.sort(function (a, b) { return a.prio - b.prio || (a.d < b.d ? -1 : 1); });
    // Au-delà de 3 éléments du même type, une seule ligne de synthèse vers la rubrique filtrée
    var SYNTH = {
      1: ['dossiers à valider', '#a-valider', null, 'tous'], 2: ['dossiers dont les contrats sont à envoyer', '#signatures', null, 'a_envoyer'],
      3: ['signatures en attente depuis 5 jours ou plus', '#signatures', null, 'relancer'], 4: ['nouvelles candidatures', '#demandes', 'candidatures', 'nouvelle'],
      5: ['demandes de contact ou de simulation non traitées', '#demandes', 'contacts', 'non_traite'], 6: ['nouvelles recommandations', '#demandes', 'recos', 'a_traiter']
    };
    var groupes = {};
    t.forEach(function (x) { (groupes[x.prio] = groupes[x.prio] || []).push(x); });
    t = [];
    Object.keys(groupes).sort().forEach(function (k) {
      var g = groupes[k], sy = SYNTH[k];
      if (g.length <= 3) { t = t.concat(g); return; }
      t.push({ d: g[0].d, prio: Number(k), html: '<strong>' + g.length + ' ' + sy[0] + '</strong> — la plus ancienne date de ' + E.date(g.reduce(function (a, x) { return !a || x.d < a ? x.d : a; }, null)), lien: sy[1], onglet: sy[2], filtre: sy[3], q: '' });
    });
    var el = document.getElementById('a-traiter');
    if (!t.length) { el.innerHTML = '<div class="empty-state">Tout est à jour. Rien ne demande votre attention.</div>'; return; }
    var max = 8;
    el.innerHTML = '<ul class="list a-traiter">' + t.slice(0, max).map(function (x, i) {
      return '<li><span class="list__main"><span>' + x.html + '</span><span class="small">' + esc(ilYa(x.d)) + '</span></span><a class="btn btn--light btn--sm" href="' + x.lien + '" data-aller="' + i + '">Ouvrir</a></li>';
    }).join('') + '</ul>' + (t.length > max ? '<p class="small" style="font-size:14px">Et ' + (t.length - max) + ' autre' + (t.length - max > 1 ? 's' : '') + ' élément' + (t.length - max > 1 ? 's' : '') + ' : utilisez le menu pour les voir par rubrique.</p>' : '');
    el.querySelectorAll('[data-aller]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); aller(t[Number(a.dataset.aller)]); });
    });
  }
  // Ouvre une rubrique en pré-remplissant sa recherche
  var LISTES = { consultants: LC, 'a-valider': LV, signatures: LS };
  var LISTES_DEM = { candidatures: LCand, contacts: LCont, recos: LReco };
  function aller(x) {
    var sec = x.lien.slice(1);
    if (location.hash !== x.lien) history.pushState(null, '', x.lien);
    afficherSection(sec);
    if (x.onglet) { ouvrirOnglet(x.onglet); LISTES_DEM[x.onglet].chercher(x.q || '', x.filtre || 'tous'); }
    else if (LISTES[sec]) LISTES[sec].chercher(x.q || '', x.filtre || 'tous');
  }

  var rg = document.getElementById('recherche-globale'), rgRes = document.getElementById('resultats-globaux'), rgMin;
  rg.addEventListener('input', function () { clearTimeout(rgMin); rgMin = setTimeout(rechercheGlobale, 120); });
  function rechercheGlobale() {
    var q = rg.value.trim();
    if (q.length < 2) { rgRes.innerHTML = ''; return; }
    var groupes = [
      { titre: 'Consultants et candidats', lien: '#consultants', items: D.profils.filter(function (p) { return correspond([nomDe(p), p.email, p.telephone, p.vsp_id].join(' '), q); }),
        ligne: function (p) { return [esc(nomDe(p)), esc(p.email), '<span class="tag tag--muted">' + esc((STATUTS_PROFIL.find(function (o) { return o[0] === p.statut; }) || ['', p.statut || ''])[1]) + '</span>']; }, q: function (p) { return nomDe(p); } },
      { titre: 'Missions et contrats', lien: function (m) { return m.statut === 'a_valider' ? '#a-valider' : ['validee', 'active', 'terminee'].indexOf(m.statut) >= 0 ? '#signatures' : '#consultants'; },
        items: D.missions.filter(function (m) { var p = profil(m.user_id); return correspond([nomDe(p), m.client, m.client_final, m.numero_contrat, m.intitule].join(' '), q); }),
        ligne: function (m) { return [esc(nomDe(profil(m.user_id))) + ' · ' + esc(m.client || ''), esc(m.numero_contrat || m.intitule || ''), E.tag('mission', m.statut)]; },
        q: function (m) { return m.numero_contrat || nomDe(profil(m.user_id)); } },
      { titre: 'Candidatures', lien: '#demandes', onglet: 'candidatures', items: D.cands.filter(function (c) { return correspond([c.nom, c.email, c.mission_ref].join(' '), q); }),
        ligne: function (c) { return [esc(c.nom), esc(c.mission_ref || 'Spontanée'), esc(E.date(c.created_at))]; }, q: function (c) { return c.nom; } },
      { titre: 'Contacts et simulations', lien: '#demandes', onglet: 'contacts', items: D.contacts.filter(function (c) { return correspond([c.nom, c.email, c.message].join(' '), q); }),
        ligne: function (c) { return [esc(c.nom), c.type === 'simulation' ? 'Simulation' : 'Contact', esc(E.date(c.created_at))]; }, q: function (c) { return c.nom; } },
      { titre: 'Recommandations', lien: '#demandes', onglet: 'recos', items: D.recos.filter(function (x) { return correspond([x.ambassadeur_nom, x.contact_nom, x.contact_email].join(' '), q); }),
        ligne: function (x) { return [esc(x.contact_nom), 'par ' + esc(x.ambassadeur_nom), esc(E.date(x.created_at))]; }, q: function (x) { return x.contact_nom; } }
    ].filter(function (g) { return g.items.length; });
    var cibles = [];
    rgRes.innerHTML = groupes.length ? groupes.map(function (g) {
      return '<div class="rg-groupe"><h3>' + esc(g.titre) + ' <span class="chip__n">' + g.items.length + '</span></h3><ul class="list">' +
        g.items.slice(0, 5).map(function (x) {
          var lien = typeof g.lien === 'function' ? g.lien(x) : g.lien, c = g.ligne(x);
          cibles.push({ lien: lien, onglet: g.onglet, q: g.q(x) });
          return '<li><span class="list__main"><strong>' + c[0] + '</strong><span>' + c[1] + '</span></span>' + (c[2] || '') + '<a class="btn btn--light btn--sm" href="' + lien + '" data-cible="' + (cibles.length - 1) + '">Voir</a></li>';
        }).join('') + '</ul>' + (g.items.length > 5 ? '<p class="small" style="font-size:13px">+ ' + (g.items.length - 5) + ' autre(s) dans la rubrique</p>' : '') + '</div>';
    }).join('') : '<div class="empty-state">Aucun résultat pour « ' + esc(q) + ' ».</div>';
    rgRes.querySelectorAll('[data-cible]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); aller(cibles[Number(a.dataset.cible)]); });
    });
  }

  // =====================================================================
  // Navigation : une rubrique à la fois
  // =====================================================================
  var sections = Array.prototype.slice.call(document.querySelectorAll('.admin-section'));
  function afficherSection(id) {
    var cible = sections.find(function (s) { return s.id === id; }) || sections[0];
    sections.forEach(function (s) { s.hidden = s !== cible; });
    document.getElementById('sec-titre').textContent = cible.dataset.titre;
    document.getElementById('sec-sous').textContent = cible.dataset.sous || '';
    document.getElementById('sec-eyebrow').textContent = cible.id === 'apercu' ? '/Administration/' : '/Administration · ' + cible.dataset.titre + '/';
    document.title = cible.dataset.titre + ' — Administration HT Portage';
    document.querySelectorAll('#sidebar [data-section]').forEach(function (a) {
      if (a.dataset.section === cible.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () { afficherSection(E.sectionAdmin()); });
  window.addEventListener('popstate', function () { afficherSection(E.sectionAdmin()); });
  afficherSection(E.sectionAdmin());

  // =====================================================================
  // Chargement des données
  // =====================================================================
  async function chargerProfils() {
    var r = await db.from('profils').select('*').order('created_at', { ascending: false });
    noterErreur('Comptes', r);
    // Les comptes administrateurs ne sont ni candidats ni consultants
    var ia = await db.rpc('ids_admins');
    var admins = [st.user.id].concat((ia.data || []).map(function (x) { return typeof x === 'string' ? x : (x && x.ids_admins) || x; }));
    D.profilsTous = r.data || [];
    D.profils = D.profilsTous.filter(function (p) { return admins.indexOf(p.id) < 0; });
    // Invitations « Activer mon espace » (table créée par espace-v14.sql ; absente = aucune)
    var inv = await db.from('invitations').select('*');
    D.invitations = inv.error ? [] : (inv.data || []);
  }
  function invitationDe(uid) { return D.invitations.find(function (i) { return i.user_id === uid; }); }
  // Erreurs de chargement : affichées en haut de page plutôt que des listes vides trompeuses
  var erreurs = [];
  function noterErreur(quoi, r) {
    if (!r.error) return;
    erreurs.push(quoi + ' : ' + E.errText(r.error));
    var c = document.querySelector('.content'), el = document.getElementById('erreurs-chargement');
    if (!el) { el = document.createElement('div'); el.id = 'erreurs-chargement'; el.className = 'alerte alerte--manque'; el.setAttribute('role', 'alert'); c.insertBefore(el, c.querySelector('.admin-section')); }
    el.innerHTML = '<strong>Certaines données n’ont pas pu être chargées</strong><span>' + esc(erreurs.join(' · ')) + ' — rechargez la page.</span>';
  }
  function rendre(listes) {
    listes.forEach(function (L) { try { L.maj(); } catch (e) { console.error(e); noterErreur('Affichage', { error: e }); } });
    try { majCompteurs(); } catch (e) { console.error(e); noterErreur('Indicateurs', { error: e }); }
  }
  async function chargerMissions(sansRendu) {
    var r = await db.from('consultant_missions').select('*').order('created_at', { ascending: false });
    noterErreur('Missions', r);
    D.missions = r.data || [];
    calculerNumero();
    if (!sansRendu) rendre([LV, LS, LC]);
  }
  async function chargerDocs(sansRendu) {
    var r = await db.from('documents').select('*').in('type', ['cdi', 'annexe']).order('created_at', { ascending: false });
    noterErreur('Contrats', r);
    D.docs = r.data || [];
    if (!sansRendu) rendre([LS]);
  }
  async function chargerDemandes(sansRendu) {
    var r = await Promise.all([
      db.from('candidatures').select('*').order('created_at', { ascending: false }).limit(1000),
      db.from('contacts').select('*').order('created_at', { ascending: false }).limit(1000),
      db.from('recommandations').select('*').order('created_at', { ascending: false }).limit(1000)
    ]);
    noterErreur('Candidatures', r[0]); noterErreur('Contacts', r[1]); noterErreur('Recommandations', r[2]);
    D.cands = r[0].data || []; D.contacts = r[1].data || []; D.recos = r[2].data || [];
    if (!sansRendu) rendre([LCand, LCont, LReco]);
  }
  async function toutRecharger() { await chargerProfils(); await chargerMissions(); }
  window.HTP_ADMIN = { recharger: async function () { await chargerProfils(); await Promise.all([chargerMissions(true), chargerDocs(true)]); rendre([LC, LV, LS]); } };

  // Tout est chargé avant le premier affichage : pas d'indicateurs calculés sur des données partielles
  await chargerProfils();
  await Promise.all([chargerMissions(true), chargerDocs(true), chargerDemandes(true)]);
  rendre([LC, LV, LS, LCand, LCont, LReco]);
})();
