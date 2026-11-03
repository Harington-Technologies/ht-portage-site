/* Chantiers — application (administration, chefs de chantier, clients) */
(function () {
  'use strict';
  var VERSION = '202611031305';
  var sb = window.supabase.createClient(window.CFG.url, window.CFG.cle, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'chantiers-session' }, db: { schema: 'chantiers' } });
  var BUCKET = 'chantiers-fichiers';
  var app = document.getElementById('app');
  var dlg = document.getElementById('dlg');

  var S = {
    moi: null, profil: null,
    p: { entreprise: 'Chantiers', devise: 'DT', decimales: 3, logo: null },
    clients: [], chantiers: [], lots: [], depenses: [], versements: [], photos: [],
    profils: [], affectations: [], modeles: [],
    urls: {}, filtre: { statut: 'actifs', lot: '', recherche: '' }, editLots: null
  };

  // ---------- Outils ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function num(v) { if (v == null || v === '') return NaN; return Number(String(v).replace(/\s/g, '').replace(',', '.')); }
  function arrondi(n) { var f = Math.pow(10, S.p.decimales); return Math.round(n * f) / f; }
  function fmt(n, precis) {
    n = Number(n) || 0;
    var d = precis && Math.round(n) !== arrondi(n) ? S.p.decimales : 0;
    return n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ /g, ' ') + ' ' + S.p.devise;
  }
  function pct(n) { return Math.round(n) + ' %'; }
  function auj() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function dateFr(iso, court) {
    if (!iso) return '';
    var p = iso.slice(0, 10).split('-');
    return court ? p[2] + '/' + p[1] + '/' + p[0].slice(2) : Number(p[2]) + ' ' + MOIS[Number(p[1]) - 1] + ' ' + p[0];
  }
  function moisFr(iso) { var p = iso.split('-'); return MOIS[Number(p[1]) - 1] + ' ' + p[0]; }
  function somme(arr, f) { return arr.reduce(function (s, x) { return s + (Number(f ? f(x) : x) || 0); }, 0); }
  function trie(arr, f) { return arr.slice().sort(function (a, b) { return String(f(a)).localeCompare(String(f(b)), 'fr', { numeric: true }); }); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  var ICO = {
    retour: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    moins: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    haut: '<svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>',
    bas: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    clip: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7L10 17.4a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/></svg>',
    maison: '<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-5h4v5"/></svg>',
    gens: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2"/></svg>',
    cle: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/></svg>',
    reglage: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    dep: '<svg viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    rec: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
  };
  var STATUTS = { preparation: 'En préparation', en_cours: 'En cours', suspendu: 'Suspendu', termine: 'Terminé' };
  var ROLES = { admin: 'Administrateur', chef: 'Chef de chantier', client: 'Client' };

  function toast(t, ko) {
    var el = document.getElementById('toast');
    el.textContent = t; el.className = 'on' + (ko ? ' ko' : '');
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.className = ''; }, ko ? 4500 : 2500);
  }
  function erreur(e) {
    var m = (e && (e.message || e.erreur)) || String(e);
    if (/row-level security|permission denied/i.test(m)) m = 'Action non autorisée pour votre compte.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) m = 'Pas de connexion internet. Réessayez.';
    if (/violates foreign key.*chantiers_client/i.test(m)) m = 'Ce client a encore des chantiers : supprimez-les d’abord.';
    return m;
  }
  function role() { return S.profil ? S.profil.role : ''; }
  function estAdmin() { return role() === 'admin'; }
  function estChef() { return role() === 'chef'; }
  function estClient() { return role() === 'client'; }

  // ---------- Fenêtre ----------
  function ouvrir(titre, html, apres) {
    dlg.innerHTML = '<div class="in"><h3><span>' + esc(titre) + '</span><button type="button" class="fermer" aria-label="Fermer">×</button></h3>' + html + '</div>';
    $('.fermer', dlg).onclick = fermer;
    if (!dlg.open) dlg.showModal();
    if (apres) apres(dlg);
  }
  function fermer() { if (dlg.open) dlg.close(); dlg.innerHTML = ''; }
  dlg.addEventListener('click', function (e) { if (e.target === dlg) fermer(); });
  function confirmer(texte, bouton) {
    return new Promise(function (ok) {
      ouvrir('Confirmer', '<p style="margin:0">' + texte + '</p><div class="actions"><button type="button" class="btn btn--clair" data-r="0">Annuler</button><button type="button" class="btn" style="background:var(--ko)" data-r="1">' + esc(bouton || 'Supprimer') + '</button></div>', function (d) {
        $$('[data-r]', d).forEach(function (b) { b.onclick = function () { fermer(); ok(b.getAttribute('data-r') === '1'); }; });
      });
      dlg.addEventListener('close', function f() { dlg.removeEventListener('close', f); ok(false); });
    });
  }
  function occupe(btn, oui, texte) {
    if (!btn) return;
    if (oui) { btn.dataset.t = btn.textContent; btn.disabled = true; btn.textContent = texte || 'Enregistrement…'; }
    else { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; }
  }

  // ---------- Données ----------
  async function tout(table, ordre) {
    var res = [], de = 0, pas = 1000;
    for (;;) {
      var q = sb.from(table).select('*');
      (ordre || []).forEach(function (o) { q = q.order(o[0], { ascending: o[1] !== false }); });
      var r = await q.range(de, de + pas - 1);
      if (r.error) throw r.error;
      res = res.concat(r.data);
      if (r.data.length < pas) return res;
      de += pas;
    }
  }
  async function charger() {
    var t = [
      sb.from('parametres').select('*').eq('id', 1).maybeSingle(),
      tout('clients', [['nom']]),
      tout('chantiers', [['cree_le', false]]),
      tout('lots', [['ordre'], ['code']]),
      tout('depenses', [['date', false], ['cree_le', false]]),
      tout('photos', [['date', false], ['cree_le', false]]),
      estChef() ? Promise.resolve([]) : tout('versements', [['date', false], ['cree_le', false]]),
      estAdmin() ? tout('profils', [['nom']]) : Promise.resolve([]),
      tout('affectations'),
      estAdmin() ? tout('modeles_lots', [['ordre'], ['code']]) : Promise.resolve([])
    ];
    var r = await Promise.all(t);
    if (r[0].data) S.p = r[0].data;
    S.clients = r[1]; S.chantiers = r[2]; S.lots = r[3]; S.depenses = r[4]; S.photos = r[5];
    S.versements = r[6]; S.profils = r[7]; S.affectations = r[8]; S.modeles = r[9];
    S.lots.forEach(function (l) { l.marche = Number(l.marche); });
    S.depenses.forEach(function (d) { d.montant = Number(d.montant); });
    S.versements.forEach(function (v) { v.montant = Number(v.montant); });
    document.title = S.p.entreprise + ' · Chantiers';
  }
  async function recharger() { try { await charger(); } catch (e) { toast(erreur(e), true); } route(); }

  function client(id) { return S.clients.find(function (c) { return c.id === id; }); }
  function chantier(id) { return S.chantiers.find(function (c) { return c.id === id; }); }
  function lot(id) { return S.lots.find(function (l) { return l.id === id; }); }
  function lotsDe(ch) { return S.lots.filter(function (l) { return l.chantier_id === ch; }).sort(function (a, b) { return a.ordre - b.ordre || String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }); }); }
  function depDe(ch) { return S.depenses.filter(function (d) { return d.chantier_id === ch; }); }
  function verDe(ch) { return S.versements.filter(function (v) { return v.chantier_id === ch; }); }
  function photosDe(ch) { return S.photos.filter(function (p) { return p.chantier_id === ch; }); }
  function depLot(id) { return somme(S.depenses.filter(function (d) { return d.lot_id === id; }), function (d) { return d.montant; }); }
  function bilan(ch) {
    var lots = lotsDe(ch), M = somme(lots, function (l) { return l.marche; });
    var D = somme(depDe(ch), function (d) { return d.montant; });
    var V = somme(verDe(ch), function (v) { return v.montant; });
    var av = M > 0 ? somme(lots, function (l) { return l.marche * l.avancement; }) / M
      : (lots.length ? somme(lots, function (l) { return l.avancement; }) / lots.length : 0);
    return { M: M, D: D, V: V, R: M - D, solde: V - D, av: av, n: lots.length };
  }

  // URL signées des images (1 h)
  async function urls(chemins) {
    var manque = chemins.filter(function (c) { return c && !S.urls[c]; });
    if (!manque.length) return;
    var r = await sb.storage.from(BUCKET).createSignedUrls(manque, 3600);
    (r.data || []).forEach(function (x) { if (x.signedUrl) S.urls[x.path] = x.signedUrl; });
  }
  function mini(chemin) { return chemin.replace(/\.jpg$/, '_m.jpg'); }

  // Réduction des images avant envoi
  async function reduire(fichier, max, qualite) {
    var img;
    try { img = await createImageBitmap(fichier, { imageOrientation: 'from-image' }); }
    catch (e) {
      img = await new Promise(function (ok, ko) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = ko; i.src = URL.createObjectURL(fichier); });
    }
    var w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', qualite || 0.82); });
  }
  function nomFichier() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  async function envoyerImage(ch, fichier, avecMini) {
    var base = ch + '/' + nomFichier(), chemin = base + '.jpg';
    var grand = await reduire(fichier, 1600, 0.82);
    var r = await sb.storage.from(BUCKET).upload(chemin, grand, { contentType: 'image/jpeg' });
    if (r.error) throw r.error;
    if (avecMini) {
      var petit = await reduire(fichier, 420, 0.75);
      await sb.storage.from(BUCKET).upload(base + '_m.jpg', petit, { contentType: 'image/jpeg' });
    }
    return chemin;
  }

  async function fonction(corps) {
    var s = (await sb.auth.getSession()).data.session;
    var r = await fetch(window.CFG.url + '/functions/v1/chantiers-comptes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: window.CFG.cle, Authorization: 'Bearer ' + (s ? s.access_token : window.CFG.cle) },
      body: JSON.stringify(corps)
    });
    var j = await r.json().catch(function () { return { ok: false, erreur: 'Réponse invalide du serveur' }; });
    if (!j.ok) throw new Error(j.erreur || 'Erreur');
    return j;
  }

  // ---------- Mise en page ----------
  function logoHtml() {
    return S.p.logo ? '<img src="' + esc(S.p.logo) + '" alt="">' : '<svg viewBox="0 0 24 24" fill="none" stroke="#F4EFE6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-5h4v5"/></svg>';
  }
  function cadre(o) {
    var nav = '';
    var items = estAdmin()
      ? [['#/', 'Chantiers', ICO.maison, 'ch'], ['#/clients', 'Clients', ICO.gens, 'cl'], ['#/comptes', 'Comptes', ICO.cle, 'co'], ['#/reglages', 'Réglages', ICO.reglage, 're']]
      : [['#/', 'Chantiers', ICO.maison, 'ch'], ['#/reglages', 'Mon compte', ICO.reglage, 're']];
    nav = '<nav class="bas no-print">' + items.map(function (i) { return '<a href="' + i[0] + '"' + (o.nav === i[3] ? ' aria-current="page"' : '') + '>' + i[2] + i[1] + '</a>'; }).join('') + '</nav>';
    document.body.classList.remove('sans-nav');
    app.innerHTML = '<header class="tete"><div class="haut">' +
      (o.retour ? '<a class="retour" href="' + o.retour + '" aria-label="Retour">' + ICO.retour + '</a>' : '<div class="logo">' + logoHtml() + '</div>') +
      '<div class="t"><h1>' + esc(o.titre) + '</h1><div class="sous">' + esc(o.sous || S.p.entreprise) + '</div></div></div></header>' +
      '<main>' + o.html + '</main>' + nav;
    window.scrollTo(0, o.garderScroll || 0);
  }

  // ---------- Routeur ----------
  function route() {
    if (!S.profil) return;
    var h = (location.hash || '#/').slice(1).split('/').filter(Boolean);
    var ecran = h[0] || '';
    try {
      if (ecran === 'c' && h[1]) return vueChantier(h[1], h[2] || 'resume');
      if (ecran === 'clients' && estAdmin()) return vueClients();
      if (ecran === 'cl' && h[1] && estAdmin()) return vueClient(h[1]);
      if (ecran === 'comptes' && estAdmin()) return vueComptes();
      if (ecran === 'reglages') return vueReglages();
      return vueChantiers();
    } catch (e) { console.error(e); app.innerHTML = '<main><div class="carte">Erreur : ' + esc(e.message) + '</div></main>'; }
  }
  window.addEventListener('hashchange', function () { fermer(); route(); });

  // ---------- Liste des chantiers ----------
  function carteChantier(c) {
    var b = bilan(c.id), cl = client(c.id ? c.client_id : null);
    return '<a class="ch" href="#/c/' + c.id + '"><div class="l1"><b>' + esc(c.nom) + '</b><span class="tag ' + c.statut + '">' + STATUTS[c.statut] + '</span></div>' +
      '<div class="l2">' + esc(cl ? cl.nom : '') + (c.adresse ? ' · ' + esc(c.adresse) : '') + '</div>' +
      '<div class="barres2"><div class="lb"><span>Avancement</span><span>' + pct(b.av) + '</span></div><div class="barre"><i style="width:' + Math.min(100, b.av) + '%"></i></div>' +
      (b.M > 0 ? '<div class="lb" style="margin-top:4px"><span>Dépensé ' + fmt(b.D) + ' sur ' + fmt(b.M) + '</span><span>' + pct(b.D / b.M * 100) + '</span></div><div class="barre"><i class="dep' + (b.D > b.M ? ' trop' : '') + '" style="width:' + Math.min(100, b.D / b.M * 100) + '%"></i></div>' : '<div class="lb" style="margin-top:4px"><span>Dépensé ' + fmt(b.D) + '</span><span></span></div>') +
      '</div></a>';
  }
  function vueChantiers() {
    var liste = S.chantiers.slice();
    if (!estAdmin() && liste.length === 1 && !vueChantiers.vu) { vueChantiers.vu = true; location.replace('#/c/' + liste[0].id); return; }
    var f = S.filtre.statut;
    var filtres = '';
    if (estAdmin()) {
      var nb = { actifs: 0, termine: 0, tous: liste.length };
      liste.forEach(function (c) { if (c.statut === 'termine') nb.termine++; else nb.actifs++; });
      filtres = '<div class="puces" style="margin-bottom:14px" id="filtres">' + [['actifs', 'En cours'], ['termine', 'Terminés'], ['tous', 'Tous']].map(function (x) {
        return '<button type="button" data-f="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + ' <span style="opacity:.6">' + nb[x[0]] + '</span></button>';
      }).join('') + '</div>';
      liste = liste.filter(function (c) { return f === 'tous' || (f === 'termine' ? c.statut === 'termine' : c.statut !== 'termine'); });
    }
    var groupes = {};
    liste.forEach(function (c) { (groupes[c.client_id] = groupes[c.client_id] || []).push(c); });
    var ids = trie(Object.keys(groupes), function (id) { var c = client(id); return c ? c.nom : ''; });
    var html = filtres;
    if (estAdmin()) html += '<button type="button" class="btn" id="nouveau" style="margin:0 0 16px">+ Nouveau chantier</button>';
    if (!S.chantiers.length) {
      html += '<div class="carte vide">' + (estAdmin() ? (S.clients.length ? 'Aucun chantier pour l’instant.' : 'Commencez par ajouter un client, puis créez son chantier.') : 'Aucun chantier ne vous est encore attribué.') + '</div>';
    } else if (!liste.length) html += '<div class="carte vide">Aucun chantier dans cette catégorie.</div>';
    ids.forEach(function (id) {
      var cl = client(id);
      html += '<div class="groupe"><span>' + esc(cl ? cl.nom : 'Client') + '</span><span>' + groupes[id].length + ' chantier' + (groupes[id].length > 1 ? 's' : '') + '</span></div>' + groupes[id].map(carteChantier).join('');
    });
    cadre({ titre: estClient() ? 'Mes chantiers' : 'Chantiers', nav: 'ch', html: html });
    $$('#filtres button').forEach(function (b) { b.onclick = function () { S.filtre.statut = b.dataset.f; vueChantiers(); }; });
    if ($('#nouveau')) $('#nouveau').onclick = function () { formChantier(null); };
  }

  // ---------- Chantier ----------
  function vueChantier(id, onglet) {
    var c = chantier(id);
    if (!c) { location.replace('#/'); return; }
    var cl = client(c.client_id);
    var ong = [['resume', 'Résumé'], ['lots', 'Lots'], ['depenses', 'Dépenses']];
    if (!estChef()) ong.push(['versements', 'Versements']);
    ong.push(['photos', 'Photos']);
    if (estAdmin()) ong.push(['infos', 'Infos et accès']);
    if (!ong.some(function (o) { return o[0] === onglet; })) onglet = 'resume';
    var corps = { resume: ongResume, lots: ongLots, depenses: ongDepenses, versements: ongVersements, photos: ongPhotos, infos: ongInfos }[onglet](c);
    var html = '<div class="onglets no-print">' + ong.map(function (o) { return '<a href="#/c/' + id + '/' + o[0] + '"' + (o[0] === onglet ? ' aria-current="page"' : '') + '>' + o[1] + '</a>'; }).join('') + '</div>' + corps.html;
    var garder = vueChantier.der === id + onglet ? window.scrollY : 0;
    vueChantier.der = id + onglet;
    cadre({ titre: c.nom, sous: (cl ? cl.nom : '') + ' · ' + STATUTS[c.statut], retour: (estAdmin() || S.chantiers.length > 1) ? '#/' : null, nav: 'ch', html: html, garderScroll: garder });
    if (corps.apres) corps.apres(c);
  }

  function ongResume(c) {
    var b = bilan(c.id), ap = !estChef();
    var html = '<div class="kpi">' +
      '<div class="large"><span>Avancement global</span><b>' + pct(b.av) + '</b><div class="barre"><i style="width:' + Math.min(100, b.av) + '%"></i></div><small>' + b.n + ' lot' + (b.n > 1 ? 's' : '') + (b.M > 0 ? ', pondéré par le montant de chaque lot' : '') + '</small></div>' +
      '<div><span>Budget (marché)</span><b>' + fmt(b.M) + '</b></div>' +
      '<div class="c-dep"><span>Dépensé</span><b>' + fmt(b.D) + '</b>' + (b.M > 0 ? '<small>' + pct(b.D / b.M * 100) + ' du budget</small>' : '') + '</div>' +
      '<div><span>Reste à dépenser</span><b' + (b.R < 0 ? ' class="rouge"' : '') + '>' + fmt(b.R) + '</b>' + (b.R < 0 ? '<small class="rouge">Budget dépassé</small>' : '') + '</div>';
    if (ap) html += '<div class="c-rec"><span>Versé par le client</span><b>' + fmt(b.V) + '</b></div>' +
      '<div class="large"><span>' + (b.solde >= 0 ? 'Versements non encore dépensés' : 'Dépenses non couvertes par les versements') + '</span><b class="' + (b.solde >= 0 ? 'vert' : 'rouge') + '">' + fmt(Math.abs(b.solde)) + '</b><small>Versements − dépenses</small></div>';
    html += '</div>';
    var der = depDe(c.id).slice(0, 5);
    html += '<div class="carte"><div class="entete-carte"><h2>Dernières dépenses</h2>' + (der.length ? '<a class="lien" href="#/c/' + c.id + '/depenses">Tout voir</a>' : '') + '</div>' +
      (der.length ? '<ul class="liste">' + der.map(ligneDepense).join('') + '</ul>' : '<div class="vide">Aucune dépense saisie.</div>') +
      (peutSaisir(c) ? '<button type="button" class="btn btn--dep" id="ajout-dep">+ Ajouter une dépense</button>' : '') + '</div>';
    var ph = photosDe(c.id).slice(0, 6);
    if (ph.length) html += '<div class="carte"><div class="entete-carte"><h2>Dernières photos</h2><a class="lien" href="#/c/' + c.id + '/photos">Tout voir</a></div><div class="grille" id="grille">' + ph.map(vignette).join('') + '</div></div>';
    if (c.notes && !estChef()) html += '<div class="carte"><h2>Notes</h2><div style="white-space:pre-wrap;font-size:15px">' + esc(c.notes) + '</div></div>';
    return { html: html, apres: function () { brancherDepenses(c); brancherPhotos(c, ph); } };
  }
  function peutSaisir(c) { return estAdmin() || (estChef() && S.affectations.some(function (a) { return a.profil_id === S.moi && a.chantier_id === c.id; })); }
  function peutModifier(d) { return estAdmin() || (estChef() && d.saisi_par === S.moi); }

  // Lots
  function ongLots(c) {
    if (S.editLots && S.editLots.ch === c.id) return editeurLots(c);
    var lots = lotsDe(c.id), html = '<div class="carte">';
    html += '<div class="entete-carte"><h2>Lots <span class="n">' + lots.length + '</span></h2>' + (estAdmin() ? '<button type="button" class="btn btn--petit btn--clair" id="edit-lots">Modifier les lots</button>' : '') + '</div>';
    if (!lots.length) html += '<div class="vide">' + (estAdmin() ? 'Aucun lot. Ajoutez-les avec « Modifier les lots » (ou depuis un modèle).' : 'Aucun lot défini.') + '</div>';
    lots.forEach(function (l) {
      var d = depLot(l.id), r = l.marche - d;
      html += '<div class="lot"><button type="button" class="ouvrir" data-lot="' + l.id + '"><div class="t"><span>' + (l.code ? '<span class="code">' + esc(l.code) + '</span>' : '') + '<span class="nom">' + esc(l.nom) + '</span></span><span class="r">' + fmt(l.marche) + '</span></div>' +
        '<div class="barres2"><div class="lb"><span>Avancement</span><span>' + pct(l.avancement) + '</span></div><div class="barre"><i style="width:' + l.avancement + '%"></i></div>' +
        '<div class="lb" style="margin-top:3px"><span>Dépensé ' + fmt(d) + '</span><span' + (r < 0 ? ' class="rouge"' : '') + '>' + (r < 0 ? 'Dépassement ' + fmt(-r) : 'Reste ' + fmt(r)) + '</span></div>' +
        '<div class="barre"><i class="dep' + (r < 0 ? ' trop' : '') + '" style="width:' + (l.marche > 0 ? Math.min(100, d / l.marche * 100) : (d > 0 ? 100 : 0)) + '%"></i></div></div></button></div>';
    });
    var hors = somme(depDe(c.id).filter(function (d) { return !d.lot_id; }), function (d) { return d.montant; });
    if (hors > 0) html += '<p class="aide" style="margin-top:12px">Dépenses non rattachées à un lot : <b>' + fmt(hors, true) + '</b></p>';
    html += '</div>';
    return {
      html: html, apres: function () {
        if ($('#edit-lots')) $('#edit-lots').onclick = function () {
          S.editLots = { ch: c.id, lignes: lotsDe(c.id).map(function (l) { return { id: l.id, code: l.code, nom: l.nom, marche: l.marche, avancement: l.avancement }; }), suppr: [] };
          route();
        };
        $$('[data-lot]').forEach(function (b) { b.onclick = function () { ficheLot(c, lot(b.dataset.lot)); }; });
      }
    };
  }
  function ficheLot(c, l) {
    var deps = S.depenses.filter(function (d) { return d.lot_id === l.id; });
    var d = somme(deps, function (x) { return x.montant; });
    var html = '<p style="margin:0 0 6px;color:var(--doux)">Budget <b style="color:var(--encre)">' + fmt(l.marche, true) + '</b> · Dépensé <b style="color:var(--dep)">' + fmt(d, true) + '</b></p>';
    if (peutSaisir(c)) {
      html += '<div class="champ"><label for="av">Avancement : <b id="av-v">' + l.avancement + ' %</b></label><input id="av" type="range" min="0" max="100" step="5" value="' + l.avancement + '" style="min-height:0;padding:0;border:0"></div>' +
        '<button type="button" class="btn" id="av-ok">Enregistrer l’avancement</button>';
    } else html += '<p style="margin:0">Avancement : <b>' + l.avancement + ' %</b></p>';
    html += '<div class="sous-titre">Dépenses du lot</div>' + (deps.length ? '<ul class="liste">' + deps.map(ligneDepense).join('') + '</ul>' : '<div class="vide">Aucune dépense sur ce lot.</div>');
    ouvrir((l.code ? l.code + ' · ' : '') + l.nom, html, function (dd) {
      var r = $('#av', dd);
      if (r) {
        r.oninput = function () { $('#av-v', dd).textContent = r.value + ' %'; };
        $('#av-ok', dd).onclick = async function () {
          occupe(this, true);
          var x = await sb.rpc('maj_avancement', { lot: l.id, pct: Number(r.value) });
          if (x.error) { occupe(this, false); return toast(erreur(x.error), true); }
          l.avancement = Number(r.value); fermer(); toast('Avancement enregistré'); route();
        };
      }
      brancherDepenses(c, dd);
    });
  }
  function editeurLots(c) {
    var E = S.editLots;
    function ligne(x, i) {
      return '<tr data-i="' + i + '"><td class="c-code" data-l="Code"><input data-k="code" value="' + esc(x.code) + '" placeholder="L' + (i + 1) + '" aria-label="Code"></td>' +
        '<td class="c-nom" data-l="Nom du lot"><input data-k="nom" value="' + esc(x.nom) + '" placeholder="Ex. Gros œuvre" aria-label="Nom du lot"></td>' +
        '<td class="c-m" data-l="Budget (' + esc(S.p.devise) + ')"><input data-k="marche" class="r" inputmode="decimal" value="' + (x.marche || x.marche === 0 ? String(x.marche).replace('.', ',') : '') + '" aria-label="Budget"></td>' +
        '<td class="c-a" data-l="Avanc. %"><input data-k="avancement" class="r" inputmode="numeric" value="' + (x.avancement || 0) + '" aria-label="Avancement %"></td>' +
        '<td class="c-x"><button type="button" class="mini" data-up title="Monter">' + ICO.haut + '</button><button type="button" class="mini" data-down title="Descendre">' + ICO.bas + '</button><button type="button" class="mini x" data-del title="Supprimer">' + ICO.x + '</button></td></tr>';
    }
    var total = somme(E.lignes, function (x) { return num(x.marche) || 0; });
    var html = '<div class="carte"><div class="entete-carte"><h2>Modifier les lots</h2></div>' +
      '<table class="edit-lots"><thead><tr><th>Code</th><th>Nom du lot</th><th>Budget (' + esc(S.p.devise) + ')</th><th>Avanc. %</th><th></th></tr></thead><tbody>' + E.lignes.map(ligne).join('') + '</tbody></table>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="btn btn--petit btn--clair" id="l-plus">' + ICO.plus + 'Ajouter un lot</button>' +
      (S.modeles.length ? '<button type="button" class="btn btn--petit btn--clair" id="l-modele">Ajouter les lots du modèle</button>' : '') + '</div>' +
      '<p class="aide" style="margin-top:12px">Total des budgets : <b id="l-total">' + fmt(total, true) + '</b>' + (E.suppr.length ? ' · ' + E.suppr.length + ' lot(s) seront supprimés (leurs dépenses resteront, sans lot)' : '') + '</p>' +
      '<div class="actions"><button type="button" class="btn btn--clair" id="l-annuler">Annuler</button><button type="button" class="btn" id="l-ok">Enregistrer</button></div><div class="msg" id="l-msg"></div></div>';
    return {
      html: html, apres: function () {
        function lire() {
          $$('.edit-lots tbody tr').forEach(function (tr) {
            var x = E.lignes[Number(tr.dataset.i)];
            $$('input', tr).forEach(function (inp) { x[inp.dataset.k] = inp.value; });
          });
        }
        $$('.edit-lots input').forEach(function (inp) {
          inp.oninput = function () { lire(); $('#l-total').textContent = fmt(somme(E.lignes, function (x) { return num(x.marche) || 0; }), true); };
        });
        $$('.edit-lots tr[data-i]').forEach(function (tr) {
          var i = Number(tr.dataset.i);
          $('[data-up]', tr).onclick = function () { lire(); if (i > 0) { var t = E.lignes[i - 1]; E.lignes[i - 1] = E.lignes[i]; E.lignes[i] = t; route(); } };
          $('[data-down]', tr).onclick = function () { lire(); if (i < E.lignes.length - 1) { var t = E.lignes[i + 1]; E.lignes[i + 1] = E.lignes[i]; E.lignes[i] = t; route(); } };
          $('[data-del]', tr).onclick = function () { lire(); var x = E.lignes.splice(i, 1)[0]; if (x.id) E.suppr.push(x.id); route(); };
        });
        $('#l-plus').onclick = function () {
          lire(); E.lignes.push({ code: '', nom: '', marche: '', avancement: 0 }); route();
          var ins = $$('.edit-lots tbody tr:last-child input'); if (ins[1]) ins[1].focus();
        };
        if ($('#l-modele')) $('#l-modele').onclick = function () {
          lire();
          S.modeles.forEach(function (m) {
            if (!E.lignes.some(function (x) { return x.nom.trim().toLowerCase() === m.nom.trim().toLowerCase(); })) E.lignes.push({ code: m.code, nom: m.nom, marche: '', avancement: 0 });
          });
          route();
        };
        $('#l-annuler').onclick = function () { S.editLots = null; route(); };
        $('#l-ok').onclick = async function () {
          lire();
          var msg = $('#l-msg'), btn = this, lignes = [];
          for (var i = 0; i < E.lignes.length; i++) {
            var x = E.lignes[i], nom = String(x.nom || '').trim();
            if (!nom && !String(x.code || '').trim() && !String(x.marche || '').trim()) continue;
            if (!nom) { msg.className = 'msg ko'; msg.textContent = 'Ligne ' + (i + 1) + ' : le nom du lot est obligatoire.'; return; }
            var m = String(x.marche).trim() === '' ? 0 : num(x.marche), a = num(x.avancement);
            if (!(m >= 0)) { msg.className = 'msg ko'; msg.textContent = 'Ligne ' + (i + 1) + ' : budget invalide.'; return; }
            if (!(a >= 0 && a <= 100)) { msg.className = 'msg ko'; msg.textContent = 'Ligne ' + (i + 1) + ' : avancement entre 0 et 100.'; return; }
            lignes.push({ id: x.id, chantier_id: c.id, code: String(x.code || '').trim(), nom: nom, marche: m, avancement: Math.round(a), ordre: lignes.length + 1 });
          }
          occupe(btn, true);
          try {
            if (E.suppr.length) { var d = await sb.from('lots').delete().in('id', E.suppr); if (d.error) throw d.error; }
            var anciens = lignes.filter(function (x) { return x.id; }), nouveaux = lignes.filter(function (x) { return !x.id; }).map(function (x) { delete x.id; return x; });
            if (anciens.length) { var u = await sb.from('lots').upsert(anciens); if (u.error) throw u.error; }
            if (nouveaux.length) { var n = await sb.from('lots').insert(nouveaux); if (n.error) throw n.error; }
            S.editLots = null; toast('Lots enregistrés'); await recharger();
          } catch (e) { occupe(btn, false); msg.className = 'msg ko'; msg.textContent = erreur(e); }
        };
      }
    };
  }

  // Dépenses
  function ligneDepense(d) {
    var l = d.lot_id ? lot(d.lot_id) : null;
    var sous = [dateFr(d.date, true), l ? (l.code || l.nom) : 'Hors lot'];
    if (d.paye_par) sous.push(d.paye_par);
    if (!estClient() && d.saisi_nom) sous.push('par ' + d.saisi_nom);
    return '<li class="dep"><button type="button" class="ed" data-dep="' + d.id + '"><span class="ico">' + ICO.dep + '</span><span class="q"><b>' + esc(d.libelle) + '</b><span>' + esc(sous.join(' · ')) + (d.photo ? ' <span class="clip">' + ICO.clip + 'ticket</span>' : '') + '</span></span><span class="m">' + fmt(d.montant, true) + '</span></button></li>';
  }
  function brancherDepenses(c, racine) {
    $$('[data-dep]', racine).forEach(function (b) { b.onclick = function () { ficheDepense(c, S.depenses.find(function (d) { return d.id === b.dataset.dep; })); }; });
    var a = $('#ajout-dep', racine); if (a) a.onclick = function () { formDepense(c, null); };
  }
  function ongDepenses(c) {
    var lots = lotsDe(c.id), f = S.filtre;
    var deps = depDe(c.id).filter(function (d) {
      if (f.lot === '_aucun' ? d.lot_id : (f.lot && d.lot_id !== f.lot)) return false;
      if (f.recherche && (d.libelle + ' ' + (d.paye_par || '')).toLowerCase().indexOf(f.recherche.toLowerCase()) < 0) return false;
      return true;
    });
    var html = (peutSaisir(c) ? '<button type="button" class="btn btn--dep" id="ajout-dep" style="margin:0 0 14px">+ Ajouter une dépense</button>' : '') +
      '<div class="filtre"><select id="f-lot" aria-label="Filtrer par lot"><option value="">Tous les lots</option>' + lots.map(function (l) { return '<option value="' + l.id + '"' + (f.lot === l.id ? ' selected' : '') + '>' + esc((l.code ? l.code + ' · ' : '') + l.nom) + '</option>'; }).join('') + '<option value="_aucun"' + (f.lot === '_aucun' ? ' selected' : '') + '>Hors lot</option></select>' +
      '<input id="f-rech" type="search" placeholder="Rechercher" value="' + esc(f.recherche) + '"></div>' +
      '<div class="carte"><div class="entete-carte"><h2>Dépenses <span class="n">' + deps.length + '</span></h2><b style="color:var(--dep)" class="num">' + fmt(somme(deps, function (d) { return d.montant; }), true) + '</b></div>';
    if (!deps.length) html += '<div class="vide">Aucune dépense' + (f.lot || f.recherche ? ' pour ce filtre' : '') + '.</div>';
    var parMois = {};
    deps.forEach(function (d) { var m = d.date.slice(0, 7); (parMois[m] = parMois[m] || []).push(d); });
    Object.keys(parMois).sort().reverse().forEach(function (m) {
      html += '<div class="mois"><span>' + moisFr(m) + '</span><span class="num">' + fmt(somme(parMois[m], function (d) { return d.montant; })) + '</span></div><ul class="liste">' + parMois[m].map(ligneDepense).join('') + '</ul>';
    });
    html += '</div>';
    return {
      html: html, apres: function () {
        brancherDepenses(c);
        $('#f-lot').onchange = function () { f.lot = this.value; route(); };
        var t; $('#f-rech').oninput = function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { f.recherche = v; route(); var i = $('#f-rech'); i.focus(); i.setSelectionRange(v.length, v.length); }, 300); };
      }
    };
  }
  async function ficheDepense(c, d) {
    if (!d) return;
    var l = d.lot_id ? lot(d.lot_id) : null;
    var html = '<div class="ident" style="word-break:normal"><div style="font-size:24px;font-weight:600;color:var(--dep)" class="num">' + fmt(d.montant, true) + '</div>' +
      '<div>' + esc(d.libelle) + '</div><div style="color:var(--doux);font-size:14px">' + dateFr(d.date) + ' · ' + esc(l ? (l.code ? l.code + ' · ' : '') + l.nom : 'Hors lot') + (d.paye_par ? '<br>Payé par ' + esc(d.paye_par) : '') + (d.saisi_nom && !estClient() ? '<br>Saisi par ' + esc(d.saisi_nom) : '') + '</div></div>';
    if (d.photo) html += '<div class="visu" style="margin-top:12px"><img id="ticket" alt="Ticket"></div>';
    if (peutModifier(d)) html += '<div class="actions"><button type="button" class="btn btn--danger" id="d-suppr">Supprimer</button><button type="button" class="btn" id="d-modif">Modifier</button></div>';
    ouvrir('Dépense', html, async function (dd) {
      if ($('#d-modif', dd)) {
        $('#d-modif', dd).onclick = function () { formDepense(c, d); };
        $('#d-suppr', dd).onclick = async function () {
          if (!(await confirmer('Supprimer la dépense « ' + esc(d.libelle) + ' » de ' + fmt(d.montant, true) + ' ?'))) return;
          var r = await sb.from('depenses').delete().eq('id', d.id);
          if (r.error) return toast(erreur(r.error), true);
          if (d.photo) sb.storage.from(BUCKET).remove([d.photo]);
          toast('Dépense supprimée'); recharger();
        };
      }
      if (d.photo) { await urls([d.photo]); var im = $('#ticket', dd); if (im) im.src = S.urls[d.photo] || ''; }
    });
  }
  function formDepense(c, d) {
    var lots = lotsDe(c.id);
    var payeurs = {}; depDe(c.id).forEach(function (x) { if (x.paye_par) payeurs[x.paye_par] = 1; });
    var html = '<form id="fd" novalidate>' +
      '<div class="champ"><label for="d-mt">Montant (' + esc(S.p.devise) + ')</label><input id="d-mt" class="montant" inputmode="decimal" autocomplete="off" value="' + (d ? String(d.montant).replace('.', ',') : '') + '" required></div>' +
      '<div class="champ"><label for="d-lib">Libellé</label><input id="d-lib" maxlength="200" value="' + esc(d ? d.libelle : '') + '" placeholder="Ex. 20 sacs de ciment" required></div>' +
      '<div class="champ"><label for="d-lot">Lot</label><select id="d-lot"><option value="">— Hors lot —</option>' + lots.map(function (l) { return '<option value="' + l.id + '"' + (d && d.lot_id === l.id ? ' selected' : '') + '>' + esc((l.code ? l.code + ' · ' : '') + l.nom) + '</option>'; }).join('') + '</select></div>' +
      '<div class="ligne2"><div class="champ"><label for="d-date">Date</label><input id="d-date" type="date" value="' + (d ? d.date : auj()) + '" max="' + auj() + '"></div>' +
      '<div class="champ"><label for="d-pp">Payé par</label><input id="d-pp" list="payeurs" maxlength="80" value="' + esc(d ? d.paye_par || '' : '') + '" placeholder="Ex. Caisse"><datalist id="payeurs">' + Object.keys(payeurs).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist></div></div>' +
      '<div class="champ"><span class="lbl">Photo du ticket (facultatif)</span><input id="d-photo" type="file" accept="image/*" capture="environment" style="min-height:0;padding:9px">' +
      (d && d.photo ? '<label class="case" style="margin-top:6px"><input type="checkbox" id="d-photo-suppr"> Retirer la photo actuelle</label>' : '') + '</div>' +
      '<button type="submit" class="btn btn--dep">' + (d ? 'Enregistrer' : 'Ajouter la dépense') + '</button><div class="msg" id="d-msg"></div></form>';
    ouvrir(d ? 'Modifier la dépense' : 'Nouvelle dépense', html, function (dd) {
      if (!d) setTimeout(function () { $('#d-mt', dd).focus(); }, 50);
      $('#fd', dd).onsubmit = async function (e) {
        e.preventDefault();
        var msg = $('#d-msg', dd), btn = $('button[type=submit]', dd);
        var mt = num($('#d-mt', dd).value), lib = $('#d-lib', dd).value.trim(), date = $('#d-date', dd).value;
        msg.className = 'msg ko';
        if (!(mt > 0)) { msg.textContent = 'Indiquez un montant.'; return; }
        if (!lib) { msg.textContent = 'Indiquez un libellé.'; return; }
        if (!date) { msg.textContent = 'Indiquez la date.'; return; }
        if (date > auj()) { msg.textContent = 'La date ne peut pas être dans le futur.'; return; }
        var ligne = { chantier_id: c.id, montant: arrondi(mt), libelle: lib, lot_id: $('#d-lot', dd).value || null, date: date, paye_par: $('#d-pp', dd).value.trim() || null };
        occupe(btn, true);
        try {
          var f = $('#d-photo', dd).files[0], ancienne = d && d.photo;
          if (f) { btn.textContent = 'Envoi de la photo…'; ligne.photo = await envoyerImage(c.id, f, false); }
          else if (d && $('#d-photo-suppr', dd) && $('#d-photo-suppr', dd).checked) ligne.photo = null;
          var r = d ? await sb.from('depenses').update(ligne).eq('id', d.id).select() : await sb.from('depenses').insert(ligne).select();
          if (r.error) throw r.error;
          if (d && !r.data.length) throw new Error('Action non autorisée pour votre compte.');
          if (ancienne && ligne.photo !== undefined && ligne.photo !== ancienne) sb.storage.from(BUCKET).remove([ancienne]);
          fermer(); toast(d ? 'Dépense modifiée' : 'Dépense ajoutée : ' + fmt(ligne.montant, true)); recharger();
        } catch (er) { occupe(btn, false); msg.textContent = erreur(er); }
      };
    });
  }

  // Versements
  function ongVersements(c) {
    var vs = verDe(c.id), b = bilan(c.id);
    var html = '<div class="kpi"><div class="c-rec"><span>Total versé</span><b>' + fmt(b.V) + '</b></div><div><span>' + (b.solde >= 0 ? 'Non encore dépensé' : 'Non couvert') + '</span><b class="' + (b.solde >= 0 ? 'vert' : 'rouge') + '">' + fmt(Math.abs(b.solde)) + '</b><small>Versements − dépenses</small></div>' +
      (b.M > 0 ? '<div class="large"><span>Reste à verser pour atteindre le budget</span><b>' + fmt(Math.max(0, b.M - b.V)) + '</b><small>Budget ' + fmt(b.M) + '</small></div>' : '') + '</div>';
    if (estAdmin()) html += '<button type="button" class="btn btn--rec" id="ajout-ver" style="margin:0 0 14px">+ Enregistrer un versement du client</button>';
    html += '<div class="carte"><h2>Versements du client <span class="n">' + vs.length + '</span></h2>' + (vs.length ? '<ul class="liste">' + vs.map(function (v) {
      return '<li class="rec"><button type="button" class="ed" data-ver="' + v.id + '"' + (estAdmin() ? '' : ' disabled') + '><span class="ico">' + ICO.rec + '</span><span class="q"><b>' + esc(v.libelle || 'Versement') + '</b><span>' + dateFr(v.date) + (v.mode ? ' · ' + esc(v.mode) : '') + '</span></span><span class="m">' + fmt(v.montant, true) + '</span></button></li>';
    }).join('') + '</ul>' : '<div class="vide">Aucun versement enregistré.</div>') + '</div>';
    return {
      html: html, apres: function () {
        if ($('#ajout-ver')) $('#ajout-ver').onclick = function () { formVersement(c, null); };
        if (estAdmin()) $$('[data-ver]').forEach(function (b) { b.onclick = function () { formVersement(c, S.versements.find(function (v) { return v.id === b.dataset.ver; })); }; });
      }
    };
  }
  function formVersement(c, v) {
    var modes = ['Espèces', 'Virement', 'Chèque', 'Autre'];
    var html = '<form id="fv" novalidate><div class="champ"><label for="v-mt">Montant (' + esc(S.p.devise) + ')</label><input id="v-mt" class="montant" inputmode="decimal" value="' + (v ? String(v.montant).replace('.', ',') : '') + '"></div>' +
      '<div class="ligne2"><div class="champ"><label for="v-date">Date</label><input id="v-date" type="date" value="' + (v ? v.date : auj()) + '"></div>' +
      '<div class="champ"><label for="v-mode">Mode</label><select id="v-mode"><option value=""></option>' + modes.map(function (m) { return '<option' + (v && v.mode === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="champ"><label for="v-lib">Libellé (facultatif)</label><input id="v-lib" maxlength="200" value="' + esc(v ? v.libelle || '' : '') + '" placeholder="Ex. Acompte 2"></div>' +
      (v ? '<div class="actions"><button type="button" class="btn btn--danger" id="v-suppr">Supprimer</button><button type="submit" class="btn btn--rec">Enregistrer</button></div>' : '<button type="submit" class="btn btn--rec">Enregistrer le versement</button>') +
      '<div class="msg" id="v-msg"></div></form>';
    ouvrir(v ? 'Modifier le versement' : 'Versement du client', html, function (dd) {
      if (v) $('#v-suppr', dd).onclick = async function () {
        if (!(await confirmer('Supprimer ce versement de ' + fmt(v.montant, true) + ' ?'))) return;
        var r = await sb.from('versements').delete().eq('id', v.id);
        if (r.error) return toast(erreur(r.error), true);
        toast('Versement supprimé'); recharger();
      };
      $('#fv', dd).onsubmit = async function (e) {
        e.preventDefault();
        var msg = $('#v-msg', dd), btn = $('button[type=submit]', dd), mt = num($('#v-mt', dd).value);
        msg.className = 'msg ko';
        if (!(mt > 0)) { msg.textContent = 'Indiquez un montant.'; return; }
        if (!$('#v-date', dd).value) { msg.textContent = 'Indiquez la date.'; return; }
        var ligne = { chantier_id: c.id, montant: arrondi(mt), date: $('#v-date', dd).value, mode: $('#v-mode', dd).value || null, libelle: $('#v-lib', dd).value.trim() || null };
        occupe(btn, true);
        var r = v ? await sb.from('versements').update(ligne).eq('id', v.id) : await sb.from('versements').insert(ligne);
        if (r.error) { occupe(btn, false); msg.textContent = erreur(r.error); return; }
        fermer(); toast('Versement enregistré'); recharger();
      };
    });
  }

  // Photos
  function vignette(p) {
    return '<button type="button" data-ph="' + p.id + '"><img data-src="' + esc(mini(p.chemin)) + '" alt="' + esc(p.legende || 'Photo') + '"><span>' + dateFr(p.date, true) + (p.legende ? ' · ' + esc(p.legende) : '') + '</span></button>';
  }
  async function brancherPhotos(c, liste) {
    $$('[data-ph]').forEach(function (b) { b.onclick = function () { fichePhoto(c, S.photos.find(function (p) { return p.id === b.dataset.ph; })); }; });
    if (!liste.length) return;
    await urls(liste.map(function (p) { return mini(p.chemin); }));
    $$('img[data-src]').forEach(function (im) {
      var u = S.urls[im.dataset.src];
      if (u) { im.src = u; im.onerror = function () { im.onerror = null; urls([im.dataset.src.replace('_m.jpg', '.jpg')]).then(function () { im.src = S.urls[im.dataset.src.replace('_m.jpg', '.jpg')] || ''; }); }; }
    });
  }
  function ongPhotos(c) {
    var ph = photosDe(c.id);
    var html = (peutSaisir(c) ? '<button type="button" class="btn" id="ajout-ph" style="margin:0 0 14px">+ Ajouter des photos</button>' : '') +
      '<div class="carte"><h2>Photos <span class="n">' + ph.length + '</span></h2>' + (ph.length ? '<div class="grille">' + ph.map(vignette).join('') + '</div>' : '<div class="vide">Aucune photo du chantier.</div>') + '</div>';
    return {
      html: html, apres: function () {
        brancherPhotos(c, ph);
        if ($('#ajout-ph')) $('#ajout-ph').onclick = function () { formPhotos(c); };
      }
    };
  }
  async function fichePhoto(c, p) {
    if (!p) return;
    var l = p.lot_id ? lot(p.lot_id) : null;
    var html = '<div class="visu"><img id="ph-img" alt=""></div><p style="margin:10px 0 0;color:var(--doux);font-size:14px">' + dateFr(p.date) + (l ? ' · ' + esc(l.nom) : '') + (p.legende ? '<br><span style="color:var(--encre)">' + esc(p.legende) + '</span>' : '') + '</p>' +
      ((estAdmin() || (estChef() && p.saisi_par === S.moi)) ? '<button type="button" class="btn btn--danger" id="ph-suppr">Supprimer la photo</button>' : '');
    ouvrir('Photo', html, async function (dd) {
      if ($('#ph-suppr', dd)) $('#ph-suppr', dd).onclick = async function () {
        if (!(await confirmer('Supprimer cette photo ?'))) return;
        var r = await sb.from('photos').delete().eq('id', p.id);
        if (r.error) return toast(erreur(r.error), true);
        sb.storage.from(BUCKET).remove([p.chemin, mini(p.chemin)]);
        toast('Photo supprimée'); recharger();
      };
      await urls([p.chemin]); var im = $('#ph-img', dd); if (im) im.src = S.urls[p.chemin] || '';
    });
  }
  function formPhotos(c) {
    var lots = lotsDe(c.id);
    var html = '<form id="fp" novalidate><div class="champ"><span class="lbl">Photos</span><input id="p-f" type="file" accept="image/*" multiple style="min-height:0;padding:9px"><small>Vous pouvez en choisir plusieurs.</small></div>' +
      '<div class="champ"><label for="p-lot">Lot (facultatif)</label><select id="p-lot"><option value=""></option>' + lots.map(function (l) { return '<option value="' + l.id + '">' + esc((l.code ? l.code + ' · ' : '') + l.nom) + '</option>'; }).join('') + '</select></div>' +
      '<div class="ligne2"><div class="champ"><label for="p-date">Date</label><input id="p-date" type="date" value="' + auj() + '" max="' + auj() + '"></div><div class="champ"><label for="p-leg">Légende</label><input id="p-leg" maxlength="140" placeholder="Facultatif"></div></div>' +
      '<button type="submit" class="btn">Envoyer</button><div class="msg" id="p-msg"></div></form>';
    ouvrir('Ajouter des photos', html, function (dd) {
      $('#fp', dd).onsubmit = async function (e) {
        e.preventDefault();
        var fs = Array.prototype.slice.call($('#p-f', dd).files), msg = $('#p-msg', dd), btn = $('button[type=submit]', dd);
        msg.className = 'msg ko';
        if (!fs.length) { msg.textContent = 'Choisissez au moins une photo.'; return; }
        occupe(btn, true);
        try {
          for (var i = 0; i < fs.length; i++) {
            btn.textContent = 'Envoi ' + (i + 1) + ' / ' + fs.length + '…';
            var chemin = await envoyerImage(c.id, fs[i], true);
            var r = await sb.from('photos').insert({ chantier_id: c.id, chemin: chemin, lot_id: $('#p-lot', dd).value || null, date: $('#p-date', dd).value || auj(), legende: $('#p-leg', dd).value.trim() || null });
            if (r.error) throw r.error;
          }
          fermer(); toast(fs.length > 1 ? fs.length + ' photos ajoutées' : 'Photo ajoutée'); recharger();
        } catch (er) { occupe(btn, false); msg.textContent = erreur(er); }
      };
    });
  }

  // Infos et accès (admin)
  function ongInfos(c) {
    var cl = client(c.client_id);
    var chefs = S.profils.filter(function (p) { return p.role === 'chef'; });
    var aff = S.affectations.filter(function (a) { return a.chantier_id === c.id; }).map(function (a) { return a.profil_id; });
    var accesClient = S.profils.filter(function (p) { return p.role === 'client' && p.client_id === c.client_id; });
    var html = '<div class="carte"><div class="entete-carte"><h2>Informations</h2><button type="button" class="btn btn--petit btn--clair" id="i-modif">Modifier</button></div>' +
      '<div class="ident" style="word-break:normal">' +
      '<div><span style="color:var(--doux)">Client :</span> <a href="#/cl/' + c.client_id + '">' + esc(cl ? cl.nom : '') + '</a></div>' +
      (c.adresse ? '<div><span style="color:var(--doux)">Adresse :</span> ' + esc(c.adresse) + '</div>' : '') +
      '<div><span style="color:var(--doux)">Statut :</span> ' + STATUTS[c.statut] + '</div>' +
      (c.debut ? '<div><span style="color:var(--doux)">Début :</span> ' + dateFr(c.debut) + '</div>' : '') +
      (c.fin_prevue ? '<div><span style="color:var(--doux)">Fin prévue :</span> ' + dateFr(c.fin_prevue) + '</div>' : '') + '</div></div>';
    html += '<div class="carte"><h2>Chefs de chantier</h2>' + (chefs.length ? '<div class="cases" id="i-chefs">' + chefs.map(function (p) {
      return '<label><input type="checkbox" value="' + p.id + '"' + (aff.indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + esc(p.nom) + (p.actif ? '' : ' <span class="tag off">désactivé</span>') + '</label>';
    }).join('') + '</div><p class="aide">Les chefs cochés voient ce chantier et peuvent y saisir des dépenses et des photos.</p>' : '<div class="vide">Aucun chef de chantier. <a href="#/comptes">Créer un compte</a></div>') + '</div>';
    html += '<div class="carte"><h2>Accès du client</h2>' + (accesClient.length ? '<ul class="liste">' + accesClient.map(function (p) {
      return '<li><span class="q"><b>' + esc(p.nom) + '</b><span>' + esc(p.email || '') + '</span></span>' + (p.actif ? '<span class="tag client">actif</span>' : '<span class="tag off">désactivé</span>') + '</li>';
    }).join('') + '</ul><p class="aide">Ces comptes voient tous les chantiers du client ' + esc(cl ? cl.nom : '') + ', en lecture seule.</p>' : '<div class="vide">Le client n’a pas encore d’accès.</div>') +
      '<button type="button" class="btn btn--clair" id="i-acces">+ Créer un accès pour le client</button></div>';
    html += '<button type="button" class="btn btn--danger" id="i-suppr">Supprimer ce chantier</button>';
    return {
      html: html, apres: function () {
        $('#i-modif').onclick = function () { formChantier(c); };
        $('#i-acces').onclick = function () { formCompte(null, { role: 'client', client_id: c.client_id, nom: cl ? cl.nom : '', email: cl ? cl.email || '' : '', telephone: cl ? cl.telephone || '' : '' }); };
        $$('#i-chefs input').forEach(function (cb) {
          cb.onchange = async function () {
            var r = cb.checked ? await sb.from('affectations').insert({ profil_id: cb.value, chantier_id: c.id })
              : await sb.from('affectations').delete().eq('profil_id', cb.value).eq('chantier_id', c.id);
            if (r.error) { cb.checked = !cb.checked; return toast(erreur(r.error), true); }
            toast(cb.checked ? 'Chef ajouté au chantier' : 'Chef retiré du chantier');
            var a = await tout('affectations'); S.affectations = a;
          };
        });
        $('#i-suppr').onclick = async function () {
          var n = depDe(c.id).length, p = photosDe(c.id).length;
          if (!(await confirmer('Supprimer définitivement le chantier « ' + esc(c.nom) + ' » avec ses lots, ' + n + ' dépense(s), ses versements et ' + p + ' photo(s) ? Cette action est irréversible.'))) return;
          var chemins = [];
          S.depenses.forEach(function (d) { if (d.chantier_id === c.id && d.photo) chemins.push(d.photo); });
          S.photos.forEach(function (x) { if (x.chantier_id === c.id) chemins.push(x.chemin, mini(x.chemin)); });
          var r = await sb.from('chantiers').delete().eq('id', c.id);
          if (r.error) return toast(erreur(r.error), true);
          for (var i = 0; i < chemins.length; i += 100) await sb.storage.from(BUCKET).remove(chemins.slice(i, i + 100));
          toast('Chantier supprimé'); location.hash = '#/'; recharger();
        };
      }
    };
  }

  function formChantier(c, clientId) {
    if (!S.clients.length) { toast('Ajoutez d’abord un client.', true); location.hash = '#/clients'; return; }
    var html = '<form id="fc" novalidate>' +
      '<div class="champ"><label for="c-cl">Client</label><select id="c-cl">' + (c ? '' : '<option value="">— Choisir —</option>') + S.clients.map(function (x) { return '<option value="' + x.id + '"' + ((c ? c.client_id : clientId) === x.id ? ' selected' : '') + '>' + esc(x.nom) + '</option>'; }).join('') + '</select></div>' +
      '<div class="champ"><label for="c-nom">Nom du chantier</label><input id="c-nom" maxlength="120" value="' + esc(c ? c.nom : '') + '" placeholder="Ex. Villa La Marsa"></div>' +
      '<div class="champ"><label for="c-adr">Adresse</label><input id="c-adr" maxlength="200" value="' + esc(c ? c.adresse || '' : '') + '"></div>' +
      '<div class="ligne2"><div class="champ"><label for="c-deb">Début</label><input id="c-deb" type="date" value="' + (c ? c.debut || '' : '') + '"></div><div class="champ"><label for="c-fin">Fin prévue</label><input id="c-fin" type="date" value="' + (c ? c.fin_prevue || '' : '') + '"></div></div>' +
      '<div class="champ"><label for="c-st">Statut</label><select id="c-st">' + Object.keys(STATUTS).map(function (k) { return '<option value="' + k + '"' + ((c ? c.statut : 'en_cours') === k ? ' selected' : '') + '>' + STATUTS[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="champ"><label for="c-notes">Notes</label><textarea id="c-notes" maxlength="2000">' + esc(c ? c.notes || '' : '') + '</textarea><small>Visibles par le client.</small></div>' +
      (!c && S.modeles.length ? '<label class="case"><input type="checkbox" id="c-mod" checked> Créer les ' + S.modeles.length + ' lots du modèle (modifiables ensuite)</label>' : '') +
      '<button type="submit" class="btn">' + (c ? 'Enregistrer' : 'Créer le chantier') + '</button><div class="msg" id="c-msg"></div></form>';
    ouvrir(c ? 'Modifier le chantier' : 'Nouveau chantier', html, function (dd) {
      $('#fc', dd).onsubmit = async function (e) {
        e.preventDefault();
        var msg = $('#c-msg', dd), btn = $('button[type=submit]', dd);
        msg.className = 'msg ko';
        var ligne = { client_id: $('#c-cl', dd).value, nom: $('#c-nom', dd).value.trim(), adresse: $('#c-adr', dd).value.trim() || null, debut: $('#c-deb', dd).value || null, fin_prevue: $('#c-fin', dd).value || null, statut: $('#c-st', dd).value, notes: $('#c-notes', dd).value.trim() || null };
        if (!ligne.client_id) { msg.textContent = 'Choisissez le client.'; return; }
        if (!ligne.nom) { msg.textContent = 'Indiquez le nom du chantier.'; return; }
        occupe(btn, true);
        var r = c ? await sb.from('chantiers').update(ligne).eq('id', c.id).select() : await sb.from('chantiers').insert(ligne).select();
        if (r.error) { occupe(btn, false); msg.textContent = erreur(r.error); return; }
        var id = r.data[0].id;
        if (!c && $('#c-mod', dd) && $('#c-mod', dd).checked) {
          await sb.from('lots').insert(S.modeles.map(function (m, i) { return { chantier_id: id, code: m.code, nom: m.nom, ordre: i + 1 }; }));
        }
        fermer(); toast(c ? 'Chantier modifié' : 'Chantier créé');
        if (!c) { await charger(); location.hash = '#/c/' + id + '/lots'; } else recharger();
      };
    });
  }

  // ---------- Clients ----------
  function vueClients() {
    var q = S.filtre.recherche_cl || '';
    var liste = S.clients.filter(function (c) { return !q || (c.nom + ' ' + (c.telephone || '') + ' ' + (c.email || '')).toLowerCase().indexOf(q.toLowerCase()) >= 0; });
    var html = '<button type="button" class="btn" id="n-cl" style="margin:0 0 14px">+ Nouveau client</button>' +
      (S.clients.length > 6 ? '<div class="filtre"><input id="r-cl" type="search" placeholder="Rechercher un client" value="' + esc(q) + '"></div>' : '') +
      '<div class="carte"><h2>Clients <span class="n">' + S.clients.length + '</span></h2>' + (liste.length ? '<ul class="liste">' + liste.map(function (c) {
        var chs = S.chantiers.filter(function (x) { return x.client_id === c.id; });
        var actifs = chs.filter(function (x) { return x.statut !== 'termine'; }).length;
        return '<li><a class="ed" href="#/cl/' + c.id + '"><span class="q"><b>' + esc(c.nom) + '</b><span>' + esc([c.telephone, c.email].filter(Boolean).join(' · ') || '—') + '</span></span><span class="tag">' + chs.length + ' chantier' + (chs.length > 1 ? 's' : '') + (actifs ? ' · ' + actifs + ' en cours' : '') + '</span></a></li>';
      }).join('') + '</ul>' : '<div class="vide">' + (S.clients.length ? 'Aucun résultat.' : 'Aucun client pour l’instant.') + '</div>') + '</div>';
    cadre({ titre: 'Clients', nav: 'cl', html: html });
    $('#n-cl').onclick = function () { formClient(null); };
    if ($('#r-cl')) { var t; $('#r-cl').oninput = function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { S.filtre.recherche_cl = v; vueClients(); var i = $('#r-cl'); i.focus(); i.setSelectionRange(v.length, v.length); }, 250); }; }
  }
  function vueClient(id) {
    var c = client(id); if (!c) { location.replace('#/clients'); return; }
    var chs = S.chantiers.filter(function (x) { return x.client_id === id; });
    var acces = S.profils.filter(function (p) { return p.role === 'client' && p.client_id === id; });
    var tel = c.telephone ? c.telephone.replace(/[^\d+]/g, '') : '';
    var html = '<div class="carte"><div class="entete-carte"><h2>Coordonnées</h2><button type="button" class="btn btn--petit btn--clair" id="m-cl">Modifier</button></div><div class="ident" style="word-break:normal">' +
      (c.telephone ? '<div><a href="tel:' + esc(tel) + '">' + esc(c.telephone) + '</a> · <a href="https://wa.me/' + esc(tel.replace(/^\+/, '').replace(/^00/, '')) + '" target="_blank" rel="noopener">WhatsApp</a></div>' : '') +
      (c.email ? '<div><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></div>' : '') +
      (c.adresse ? '<div>' + esc(c.adresse) + '</div>' : '') +
      (c.notes ? '<div style="color:var(--doux);white-space:pre-wrap;margin-top:6px">' + esc(c.notes) + '</div>' : '') +
      (!c.telephone && !c.email && !c.adresse && !c.notes ? '<div style="color:var(--doux)">Aucune coordonnée.</div>' : '') + '</div></div>';
    html += '<div class="entete-carte" style="margin-top:6px"><h2>Chantiers <span class="n">' + chs.length + '</span></h2><button type="button" class="btn btn--petit" id="n-ch">+ Nouveau chantier</button></div>' +
      (chs.length ? chs.map(carteChantier).join('') : '<div class="carte vide">Aucun chantier pour ce client.</div>');
    html += '<div class="carte"><h2>Accès à l’espace client</h2>' + (acces.length ? '<ul class="liste">' + acces.map(function (p) {
      return '<li><button type="button" class="ed" data-p="' + p.id + '"><span class="q"><b>' + esc(p.nom) + '</b><span>' + esc(p.email || '') + '</span></span>' + (p.actif ? '<span class="tag client">actif</span>' : '<span class="tag off">désactivé</span>') + '</button></li>';
    }).join('') + '</ul>' : '<p class="aide" style="margin:0">Créez un accès pour que le client suive ses chantiers (lecture seule).</p>') +
      '<button type="button" class="btn btn--clair" id="n-acc">+ Créer un accès</button></div>' +
      '<button type="button" class="btn btn--danger" id="s-cl">Supprimer ce client</button>';
    cadre({ titre: c.nom, sous: 'Client', retour: '#/clients', nav: 'cl', html: html });
    $('#m-cl').onclick = function () { formClient(c); };
    $('#n-ch').onclick = function () { formChantier(null, c.id); };
    $('#n-acc').onclick = function () { formCompte(null, { role: 'client', client_id: c.id, nom: c.nom, email: c.email || '', telephone: c.telephone || '' }); };
    $$('[data-p]').forEach(function (b) { b.onclick = function () { formCompte(S.profils.find(function (p) { return p.id === b.dataset.p; })); }; });
    $('#s-cl').onclick = async function () {
      if (chs.length) return toast('Ce client a encore ' + chs.length + ' chantier(s) : supprimez-les d’abord.', true);
      if (!(await confirmer('Supprimer le client « ' + esc(c.nom) + ' » ?' + (acces.length ? ' Ses ' + acces.length + ' accès seront aussi supprimés.' : '')))) return;
      try {
        for (var i = 0; i < acces.length; i++) await fonction({ action: 'supprimer', id: acces[i].id });
        var r = await sb.from('clients').delete().eq('id', c.id); if (r.error) throw r.error;
        toast('Client supprimé'); location.hash = '#/clients'; recharger();
      } catch (e) { toast(erreur(e), true); }
    };
  }
  function formClient(c) {
    var html = '<form id="fcl" novalidate><div class="champ"><label for="k-nom">Nom</label><input id="k-nom" maxlength="120" value="' + esc(c ? c.nom : '') + '" placeholder="Nom et prénom ou société"></div>' +
      '<div class="ligne2"><div class="champ"><label for="k-tel">Téléphone</label><input id="k-tel" type="tel" maxlength="40" value="' + esc(c ? c.telephone || '' : '') + '"></div><div class="champ"><label for="k-mail">E-mail</label><input id="k-mail" type="email" maxlength="200" value="' + esc(c ? c.email || '' : '') + '"></div></div>' +
      '<div class="champ"><label for="k-adr">Adresse</label><input id="k-adr" maxlength="200" value="' + esc(c ? c.adresse || '' : '') + '"></div>' +
      '<div class="champ"><label for="k-notes">Notes</label><textarea id="k-notes" maxlength="2000">' + esc(c ? c.notes || '' : '') + '</textarea><small>Visibles uniquement par vous.</small></div>' +
      '<button type="submit" class="btn">' + (c ? 'Enregistrer' : 'Ajouter le client') + '</button><div class="msg" id="k-msg"></div></form>';
    ouvrir(c ? 'Modifier le client' : 'Nouveau client', html, function (dd) {
      $('#fcl', dd).onsubmit = async function (e) {
        e.preventDefault();
        var msg = $('#k-msg', dd), btn = $('button[type=submit]', dd);
        var ligne = { nom: $('#k-nom', dd).value.trim(), telephone: $('#k-tel', dd).value.trim() || null, email: $('#k-mail', dd).value.trim() || null, adresse: $('#k-adr', dd).value.trim() || null, notes: $('#k-notes', dd).value.trim() || null };
        msg.className = 'msg ko';
        if (!ligne.nom) { msg.textContent = 'Indiquez le nom du client.'; return; }
        occupe(btn, true);
        var r = c ? await sb.from('clients').update(ligne).eq('id', c.id).select() : await sb.from('clients').insert(ligne).select();
        if (r.error) { occupe(btn, false); msg.textContent = erreur(r.error); return; }
        fermer(); toast(c ? 'Client modifié' : 'Client ajouté');
        if (!c) { await charger(); location.hash = '#/cl/' + r.data[0].id; } else recharger();
      };
    });
  }

  // ---------- Comptes ----------
  function vueComptes() {
    var html = '<button type="button" class="btn" id="n-co" style="margin:0 0 14px">+ Nouveau compte</button>';
    ['admin', 'chef', 'client'].forEach(function (r) {
      var l = S.profils.filter(function (p) { return p.role === r; });
      html += '<div class="carte"><h2>' + { admin: 'Administrateurs', chef: 'Chefs de chantier', client: 'Clients' }[r] + ' <span class="n">' + l.length + '</span></h2>' + (l.length ? '<ul class="liste">' + l.map(function (p) {
        var info = r === 'chef' ? S.affectations.filter(function (a) { return a.profil_id === p.id; }).map(function (a) { var c = chantier(a.chantier_id); return c ? c.nom : ''; }).filter(Boolean).join(', ') || 'Aucun chantier attribué'
          : r === 'client' ? ((client(p.client_id) || {}).nom || '') : '';
        return '<li><button type="button" class="ed" data-p="' + p.id + '"><span class="q"><b>' + esc(p.nom) + (p.id === S.moi ? ' <span class="tag">vous</span>' : '') + '</b><span>' + esc(p.email || '') + (info ? '<br>' + esc(info) : '') + '</span></span>' + (p.actif ? '' : '<span class="tag off">désactivé</span>') + '</button></li>';
      }).join('') + '</ul>' : '<div class="vide">Aucun compte.</div>') + '</div>';
    });
    cadre({ titre: 'Comptes', nav: 'co', html: html });
    $('#n-co').onclick = function () { formCompte(null); };
    $$('[data-p]').forEach(function (b) { b.onclick = function () { formCompte(S.profils.find(function (p) { return p.id === b.dataset.p; })); }; });
  }
  function motDePasse() {
    var a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', o = new Uint32Array(10), s = '';
    crypto.getRandomValues(o);
    for (var i = 0; i < 10; i++) s += a[o[i] % a.length];
    return s.slice(0, 5) + '-' + s.slice(5);
  }
  function formCompte(p, defaut) {
    var v = p || defaut || {}, r0 = v.role || 'chef';
    var aff = p ? S.affectations.filter(function (a) { return a.profil_id === p.id; }).map(function (a) { return a.chantier_id; }) : [];
    var moi = p && p.id === S.moi;
    var html = '<form id="fco" novalidate autocomplete="off">' +
      '<div class="champ"><span class="lbl">Rôle</span><div class="puces" id="o-role">' + ['chef', 'client', 'admin'].map(function (r) { return '<button type="button" data-r="' + r + '" aria-pressed="' + (r0 === r) + '"' + (moi ? ' disabled' : '') + '>' + ROLES[r] + '</button>'; }).join('') + '</div><small id="o-aide"></small></div>' +
      '<div class="champ"><label for="o-nom">Nom</label><input id="o-nom" maxlength="120" value="' + esc(v.nom || '') + '"></div>' +
      '<div class="ligne2"><div class="champ"><label for="o-mail">E-mail (identifiant)</label><input id="o-mail" type="email" maxlength="200" value="' + esc(v.email || '') + '" autocomplete="off"></div><div class="champ"><label for="o-tel">Téléphone</label><input id="o-tel" type="tel" maxlength="40" value="' + esc(v.telephone || '') + '"></div></div>' +
      '<div class="champ" id="o-cl-b"><label for="o-cl">Client rattaché</label><select id="o-cl"><option value="">— Choisir —</option>' + S.clients.map(function (c) { return '<option value="' + c.id + '"' + (v.client_id === c.id ? ' selected' : '') + '>' + esc(c.nom) + '</option>'; }).join('') + '</select><small>Le compte verra tous les chantiers de ce client.</small></div>' +
      '<div class="champ" id="o-ch-b"><span class="lbl">Chantiers attribués</span>' + (S.chantiers.length ? '<div class="cases">' + S.chantiers.map(function (c) { return '<label><input type="checkbox" value="' + c.id + '"' + (aff.indexOf(c.id) >= 0 ? ' checked' : '') + '> ' + esc(c.nom) + ' <span style="color:var(--pale);font-size:13px">' + esc((client(c.client_id) || {}).nom || '') + '</span></label>'; }).join('') + '</div>' : '<small>Aucun chantier pour l’instant.</small>') + '</div>' +
      '<div class="champ"><label for="o-mdp">' + (p ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe') + '</label><div style="display:flex;gap:8px"><input id="o-mdp" type="text" minlength="8" maxlength="72" autocomplete="new-password" value="' + (p ? '' : motDePasse()) + '" style="font-family:ui-monospace,Menlo,monospace"><button type="button" class="btn btn--petit btn--clair" id="o-gen">Générer</button></div><small>8 caractères minimum. Vous le transmettrez à la personne.</small></div>' +
      (p && !moi ? '<label class="case"><input type="checkbox" id="o-actif"' + (p.actif ? ' checked' : '') + '> Compte actif</label>' : '') +
      '<button type="submit" class="btn">' + (p ? 'Enregistrer' : 'Créer le compte') + '</button>' +
      (p && !moi ? '<button type="button" class="btn btn--danger" id="o-suppr">Supprimer le compte</button>' : '') +
      '<div class="msg" id="o-msg"></div></form>';
    ouvrir(p ? 'Compte de ' + p.nom : 'Nouveau compte', html, function (dd) {
      var role = r0;
      function maj() {
        $$('#o-role button', dd).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.r === role); });
        $('#o-cl-b', dd).hidden = role !== 'client';
        $('#o-ch-b', dd).hidden = role !== 'chef';
        $('#o-aide', dd).textContent = { admin: 'Accès complet : clients, chantiers, comptes, réglages.', chef: 'Voit uniquement ses chantiers ; saisit dépenses, photos et avancement.', client: 'Lecture seule : budget, versements, dépenses, avancement et photos de ses chantiers.' }[role];
      }
      maj();
      $$('#o-role button', dd).forEach(function (b) { b.onclick = function () { role = b.dataset.r; maj(); }; });
      $('#o-gen', dd).onclick = function () { $('#o-mdp', dd).value = motDePasse(); };
      if ($('#o-suppr', dd)) $('#o-suppr', dd).onclick = async function () {
        if (!(await confirmer('Supprimer le compte de « ' + esc(p.nom) + ' » ? La personne ne pourra plus se connecter. Ses saisies sont conservées.'))) return;
        try { await fonction({ action: 'supprimer', id: p.id }); toast('Compte supprimé'); recharger(); } catch (e) { toast(erreur(e), true); }
      };
      $('#fco', dd).onsubmit = async function (e) {
        e.preventDefault();
        var msg = $('#o-msg', dd), btn = $('button[type=submit]', dd);
        msg.className = 'msg ko';
        var corps = {
          action: p ? 'modifier' : 'creer', id: p ? p.id : undefined, role: role,
          nom: $('#o-nom', dd).value.trim(), email: $('#o-mail', dd).value.trim(), telephone: $('#o-tel', dd).value.trim(),
          client_id: role === 'client' ? $('#o-cl', dd).value : null,
          chantiers: role === 'chef' ? $$('#o-ch-b input:checked', dd).map(function (x) { return x.value; }) : [],
          mot_de_passe: $('#o-mdp', dd).value.trim() || undefined,
          actif: $('#o-actif', dd) ? $('#o-actif', dd).checked : true
        };
        if (!corps.nom) { msg.textContent = 'Indiquez le nom.'; return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corps.email)) { msg.textContent = 'Indiquez une adresse e-mail valide.'; return; }
        if (role === 'client' && !corps.client_id) { msg.textContent = 'Choisissez le client rattaché.'; return; }
        if (!p && !corps.mot_de_passe) { msg.textContent = 'Indiquez un mot de passe.'; return; }
        if (corps.mot_de_passe && corps.mot_de_passe.length < 8) { msg.textContent = 'Le mot de passe doit faire au moins 8 caractères.'; return; }
        occupe(btn, true);
        try {
          await fonction(corps);
          await charger();
          if (corps.mot_de_passe) identifiants(corps.nom, corps.email, corps.mot_de_passe, corps.telephone, !p);
          else { fermer(); toast('Compte modifié'); }
          route();
        } catch (er) { occupe(btn, false); msg.textContent = erreur(er); }
      };
    });
  }
  function identifiants(nom, email, mdp, tel, nouveau) {
    var adresse = location.origin + location.pathname;
    var texte = 'Bonjour ' + nom.split(' ')[0] + ',\n\nVoici votre accès au suivi de chantier ' + S.p.entreprise + ' :\n' + adresse + '\n\nIdentifiant : ' + email + '\nMot de passe : ' + mdp + '\n\nVous pourrez changer votre mot de passe dans « Mon compte ».';
    var t = (tel || '').replace(/[^\d]/g, '').replace(/^00/, '');
    var html = '<p style="margin:0 0 10px">' + (nouveau ? 'Le compte est créé.' : 'Le mot de passe est changé.') + ' Transmettez ces identifiants à ' + esc(nom) + ' :</p>' +
      '<div class="ident"><div>' + esc(adresse) + '</div><div>Identifiant : <b>' + esc(email) + '</b></div><div>Mot de passe : <b style="font-family:ui-monospace,Menlo,monospace">' + esc(mdp) + '</b></div></div>' +
      '<div class="actions"><button type="button" class="btn btn--clair" id="id-copie">Copier le message</button><a class="btn" style="background:#1FA855" target="_blank" rel="noopener" href="https://wa.me/' + esc(t) + '?text=' + encodeURIComponent(texte) + '">WhatsApp</a></div>' +
      '<p class="aide" style="margin-top:12px">Ce mot de passe ne sera plus affiché. En cas d’oubli, vous pourrez en attribuer un nouveau.</p>';
    ouvrir('Identifiants à transmettre', html, function (dd) {
      $('#id-copie', dd).onclick = async function () {
        try { await navigator.clipboard.writeText(texte); toast('Message copié'); } catch (e) { toast('Copie impossible : sélectionnez le texte.', true); }
      };
    });
  }

  // ---------- Réglages / mon compte ----------
  function vueReglages() {
    var html = '';
    if (estAdmin()) {
      html += '<div class="carte"><h2>Entreprise</h2><form id="fe" novalidate>' +
        '<div class="champ"><label for="e-nom">Nom de l’entreprise</label><input id="e-nom" maxlength="120" value="' + esc(S.p.entreprise) + '"></div>' +
        '<div class="ligne2"><div class="champ"><label for="e-dev">Devise</label><input id="e-dev" maxlength="8" value="' + esc(S.p.devise) + '"><small>Ex. DT, €, MAD</small></div>' +
        '<div class="champ"><label for="e-dec">Décimales</label><select id="e-dec">' + [0, 2, 3].map(function (n) { return '<option' + (S.p.decimales === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select><small>3 pour le dinar, 2 pour l’euro</small></div></div>' +
        '<div class="champ"><span class="lbl">Logo</span><div class="apercu">' + (S.p.logo ? '<img src="' + esc(S.p.logo) + '" alt="Logo" style="object-fit:contain;background:#fff;border:1px solid var(--ligne)">' : '') + '<input id="e-logo" type="file" accept="image/*" style="min-height:0;padding:9px;flex:1"></div>' + (S.p.logo ? '<label class="case" style="margin-top:6px"><input type="checkbox" id="e-logo-x"> Retirer le logo</label>' : '') + '</div>' +
        '<button type="submit" class="btn">Enregistrer</button><div class="msg" id="e-msg"></div></form></div>';
      html += '<div class="carte"><h2>Modèle de lots</h2><p class="aide" style="margin:-6px 0 12px">Lots proposés à la création d’un chantier. Chaque chantier garde ensuite ses propres lots, modifiables.</p>' +
        '<table class="edit-lots" id="mod"><thead><tr><th>Code</th><th>Nom du lot</th><th></th></tr></thead><tbody>' + S.modeles.map(function (m, i) {
          return '<tr data-i="' + i + '"><td class="c-code" data-l="Code"><input data-k="code" value="' + esc(m.code) + '"></td><td class="c-nom" data-l="Nom"><input data-k="nom" value="' + esc(m.nom) + '"></td><td class="c-x"><button type="button" class="mini" data-up title="Monter">' + ICO.haut + '</button><button type="button" class="mini" data-down title="Descendre">' + ICO.bas + '</button><button type="button" class="mini x" data-del title="Supprimer">' + ICO.x + '</button></td></tr>';
        }).join('') + '</tbody></table>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="btn btn--petit btn--clair" id="m-plus">' + ICO.plus + 'Ajouter</button>' + (!S.modeles.length ? '<button type="button" class="btn btn--petit btn--clair" id="m-type">Proposer une liste type</button>' : '') + '</div>' +
        '<button type="button" class="btn" id="m-ok">Enregistrer le modèle</button><div class="msg" id="m-msg"></div></div>';
    }
    html += '<div class="carte"><h2>Mon compte</h2><div class="ident" style="word-break:normal"><div><b>' + esc(S.profil.nom) + '</b> <span class="tag ' + role() + '">' + ROLES[role()] + '</span></div><div style="color:var(--doux)">' + esc(S.profil.email || '') + '</div></div>' +
      '<form id="fm" novalidate><div class="champ"><label for="u-mdp">Nouveau mot de passe</label><input id="u-mdp" type="password" minlength="8" maxlength="72" autocomplete="new-password"></div>' +
      '<div class="champ"><label for="u-mdp2">Confirmer</label><input id="u-mdp2" type="password" autocomplete="new-password"></div>' +
      '<button type="submit" class="btn btn--clair">Changer mon mot de passe</button><div class="msg" id="u-msg"></div></form>' +
      '<button type="button" class="btn btn--danger" id="u-sortir">Se déconnecter</button></div>';
    cadre({ titre: estAdmin() ? 'Réglages' : 'Mon compte', nav: 're', html: html });

    if (estAdmin()) {
      $('#fe').onsubmit = async function (e) {
        e.preventDefault();
        var msg = $('#e-msg'), btn = $('#fe button[type=submit]');
        var maj = { entreprise: $('#e-nom').value.trim() || 'Mon entreprise', devise: $('#e-dev').value.trim() || 'DT', decimales: Number($('#e-dec').value), modifie_le: new Date().toISOString() };
        occupe(btn, true);
        try {
          var f = $('#e-logo').files[0];
          if (f) { var b = await reduire(f, 256, 0.9); maj.logo = await new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.readAsDataURL(b); }); }
          else if ($('#e-logo-x') && $('#e-logo-x').checked) maj.logo = null;
          var r = await sb.from('parametres').update(maj).eq('id', 1); if (r.error) throw r.error;
          toast('Réglages enregistrés'); recharger();
        } catch (er) { occupe(btn, false); msg.className = 'msg ko'; msg.textContent = erreur(er); }
      };
      var M = S.modeles.map(function (m) { return { id: m.id, code: m.code, nom: m.nom }; }), suppr = [];
      function lireM() { $$('#mod tbody tr').forEach(function (tr) { var x = M[Number(tr.dataset.i)]; $$('input', tr).forEach(function (i) { x[i.dataset.k] = i.value; }); }); }
      function dessinerM() {
        $('#mod tbody').innerHTML = M.map(function (m, i) {
          return '<tr data-i="' + i + '"><td class="c-code" data-l="Code"><input data-k="code" value="' + esc(m.code) + '"></td><td class="c-nom" data-l="Nom"><input data-k="nom" value="' + esc(m.nom) + '"></td><td class="c-x"><button type="button" class="mini" data-up title="Monter">' + ICO.haut + '</button><button type="button" class="mini" data-down title="Descendre">' + ICO.bas + '</button><button type="button" class="mini x" data-del title="Supprimer">' + ICO.x + '</button></td></tr>';
        }).join('');
        brancherM();
      }
      function brancherM() {
        $$('#mod tbody tr').forEach(function (tr) {
          var i = Number(tr.dataset.i);
          $('[data-up]', tr).onclick = function () { lireM(); if (i > 0) { var t = M[i - 1]; M[i - 1] = M[i]; M[i] = t; dessinerM(); } };
          $('[data-down]', tr).onclick = function () { lireM(); if (i < M.length - 1) { var t = M[i + 1]; M[i + 1] = M[i]; M[i] = t; dessinerM(); } };
          $('[data-del]', tr).onclick = function () { lireM(); var x = M.splice(i, 1)[0]; if (x.id) suppr.push(x.id); dessinerM(); };
        });
      }
      brancherM();
      $('#m-plus').onclick = function () { lireM(); M.push({ code: 'L' + (M.length + 1), nom: '' }); dessinerM(); var ins = $$('#mod tbody tr:last-child input'); if (ins[1]) ins[1].focus(); };
      if ($('#m-type')) $('#m-type').onclick = function () {
        lireM();
        ['Installation de chantier', 'Terrassement', 'Gros œuvre', 'Étanchéité', 'Menuiserie aluminium', 'Menuiserie bois', 'Plomberie et sanitaires', 'Électricité', 'Climatisation', 'Revêtements de sol et murs', 'Enduits et peinture', 'Faux plafonds', 'Ferronnerie', 'Aménagements extérieurs', 'Divers']
          .forEach(function (n, i) { M.push({ code: 'L' + String(i + 1).padStart(2, '0'), nom: n }); });
        dessinerM(); this.remove();
      };
      $('#m-ok').onclick = async function () {
        lireM();
        var msg = $('#m-msg'), btn = this;
        var lignes = M.filter(function (m) { return String(m.nom).trim(); }).map(function (m, i) { var o = { code: String(m.code || '').trim(), nom: String(m.nom).trim(), ordre: i + 1 }; if (m.id) o.id = m.id; return o; });
        occupe(btn, true);
        try {
          if (suppr.length) { var d = await sb.from('modeles_lots').delete().in('id', suppr); if (d.error) throw d.error; }
          var a = lignes.filter(function (x) { return x.id; }), n = lignes.filter(function (x) { return !x.id; });
          if (a.length) { var u = await sb.from('modeles_lots').upsert(a); if (u.error) throw u.error; }
          if (n.length) { var ins = await sb.from('modeles_lots').insert(n); if (ins.error) throw ins.error; }
          toast('Modèle enregistré'); recharger();
        } catch (er) { occupe(btn, false); msg.className = 'msg ko'; msg.textContent = erreur(er); }
      };
    }
    $('#fm').onsubmit = async function (e) {
      e.preventDefault();
      var msg = $('#u-msg'), a = $('#u-mdp').value, b = $('#u-mdp2').value, btn = $('#fm button[type=submit]');
      msg.className = 'msg ko';
      if (a.length < 8) { msg.textContent = '8 caractères minimum.'; return; }
      if (a !== b) { msg.textContent = 'Les deux mots de passe sont différents.'; return; }
      occupe(btn, true);
      var r = await sb.auth.updateUser({ password: a });
      occupe(btn, false);
      if (r.error) { msg.textContent = /different|same/i.test(r.error.message) ? 'Choisissez un mot de passe différent de l’actuel.' : erreur(r.error); return; }
      $('#u-mdp').value = $('#u-mdp2').value = ''; msg.className = 'msg ok'; msg.textContent = 'Mot de passe changé.';
    };
    $('#u-sortir').onclick = async function () { await sb.auth.signOut(); location.hash = ''; location.reload(); };
  }

  // ---------- Connexion / installation ----------
  function ecranAcces(html) {
    document.body.classList.add('sans-nav');
    app.innerHTML = '<div class="acces"><div class="carte"><div class="marque"><div class="logo">' + (S.p.logo ? '<img src="' + esc(S.p.logo) + '" alt="">' : logoHtml()) + '</div><div><b>' + esc(S.p.entreprise && S.p.entreprise !== 'Mon entreprise' ? S.p.entreprise : 'Suivi de chantiers') + '</b><span>Suivi de chantiers</span></div></div>' + html + '</div></div>';
  }
  function ecranConnexion(message) {
    ecranAcces('<form id="fl" novalidate><div class="champ"><label for="l-mail">E-mail</label><input id="l-mail" type="email" autocomplete="username" required></div>' +
      '<div class="champ"><label for="l-mdp">Mot de passe</label><input id="l-mdp" type="password" autocomplete="current-password" required></div>' +
      '<button type="submit" class="btn">Se connecter</button><div class="msg ko" id="l-msg">' + esc(message || '') + '</div>' +
      '<p class="aide">Mot de passe oublié ? Demandez-en un nouveau à votre interlocuteur.</p></form>');
    var cap = window.CAPTCHA.monter($('#fl'));
    $('#fl').onsubmit = async function (e) {
      e.preventDefault();
      var btn = $('#fl button[type=submit]'), msg = $('#l-msg');
      occupe(btn, true, 'Connexion…');
      var jeton = '';
      try { jeton = await cap.jeton(); } catch (er) { occupe(btn, false); msg.textContent = er.message; return; }
      var r = await sb.auth.signInWithPassword({ email: $('#l-mail').value.trim(), password: $('#l-mdp').value, options: jeton ? { captchaToken: jeton } : undefined });
      cap.reinitialiser();
      if (r.error) {
        occupe(btn, false);
        if (/captcha/i.test(r.error.message)) { msg.textContent = 'Vérification anti-robot échouée : réessayez.'; return; }
        msg.textContent = /invalid/i.test(r.error.message) ? 'E-mail ou mot de passe incorrect.' : /banned/i.test(r.error.message) ? 'Ce compte est désactivé.' : erreur(r.error);
        return;
      }
      demarrer();
    };
  }
  function ecranInstallation() {
    ecranAcces('<p style="margin:0 0 6px"><b>Première utilisation</b></p><p class="aide" style="margin:0 0 14px">Créez le compte administrateur de l’entreprise. Vous ajouterez ensuite vos clients, chantiers et les comptes de vos équipes.</p>' +
      '<form id="fi" novalidate><div class="champ"><label for="i-ent">Nom de l’entreprise</label><input id="i-ent" maxlength="120"></div>' +
      '<div class="champ"><label for="i-nom">Votre nom</label><input id="i-nom" maxlength="120" autocomplete="name"></div>' +
      '<div class="champ"><label for="i-mail">Votre e-mail</label><input id="i-mail" type="email" autocomplete="username"></div>' +
      '<div class="champ"><label for="i-mdp">Mot de passe</label><input id="i-mdp" type="password" minlength="8" autocomplete="new-password"><small>8 caractères minimum.</small></div>' +
      '<div class="champ"><label for="i-mdp2">Confirmer le mot de passe</label><input id="i-mdp2" type="password" autocomplete="new-password"></div>' +
      '<button type="submit" class="btn">Créer le compte administrateur</button><div class="msg ko" id="i-msg"></div></form>');
    var cap = window.CAPTCHA.monter($('#fi'));
    $('#fi').onsubmit = async function (e) {
      e.preventDefault();
      var msg = $('#i-msg'), btn = $('#fi button[type=submit]');
      var ent = $('#i-ent').value.trim(), nom = $('#i-nom').value.trim(), mail = $('#i-mail').value.trim(), a = $('#i-mdp').value;
      if (!ent || !nom) { msg.textContent = 'Indiquez le nom de l’entreprise et le vôtre.'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { msg.textContent = 'Adresse e-mail invalide.'; return; }
      if (a.length < 8) { msg.textContent = 'Mot de passe : 8 caractères minimum.'; return; }
      if (a !== $('#i-mdp2').value) { msg.textContent = 'Les deux mots de passe sont différents.'; return; }
      occupe(btn, true, 'Création…');
      try {
        await fonction({ action: 'installer', nom: nom, email: mail, mot_de_passe: a });
        var jeton = await cap.jeton();
        var r = await sb.auth.signInWithPassword({ email: mail, password: a, options: jeton ? { captchaToken: jeton } : undefined }); if (r.error) throw r.error;
        await sb.from('parametres').update({ entreprise: ent }).eq('id', 1);
        demarrer();
      } catch (er) { occupe(btn, false); msg.textContent = erreur(er); }
    };
  }

  async function demarrer() {
    app.innerHTML = '<div class="acces"><div style="color:#fff;opacity:.8">Chargement…</div></div>';
    document.body.classList.add('sans-nav');
    var s = (await sb.auth.getSession()).data.session;
    if (!s) {
      var inst = await sb.rpc('installation_requise');
      if (inst.error) return ecranConnexion('Service indisponible. Réessayez dans un instant.');
      return inst.data ? ecranInstallation() : ecranConnexion();
    }
    S.moi = s.user.id;
    var p = await sb.from('profils').select('*').eq('id', S.moi).maybeSingle();
    if (p.error) return ecranConnexion(erreur(p.error));
    if (!p.data || !p.data.actif) { await sb.auth.signOut(); return ecranConnexion('Ce compte est désactivé ou n’existe plus.'); }
    S.profil = p.data;
    try { await charger(); } catch (e) { return ecranConnexion(erreur(e)); }
    route();
  }
  sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' && S.profil) { S.profil = null; ecranConnexion(); } });

  // Rafraîchir les données au retour sur l'application
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    verifierVersion();
    if (S.profil && !dlg.open && !S.editLots) recharger();
  });
  // Mise à jour automatique de l'application
  function verifierVersion() {
    if (VERSION.indexOf('__') === 0) return;
    fetch('version.txt?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (v) {
      v = v.trim(); if (v && v !== VERSION && !dlg.open) location.reload();
    }).catch(function () {});
  }

  window.__S = S;
  demarrer();
})();
