// HT Portage — Espace consultant : client Supabase, contrôle d'accès, menu et utilitaires communs.
(function () {
  'use strict';

  var cfg = window.HTP_CONFIG || {};
  var db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'htp-espace' }
  });

  // ---------- Utilitaires ----------
  var nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { return v == null || v === '' ? null : Number(v); }
  function eur(v, dec) {
    if (v == null || v === '' || isNaN(Number(v))) return '—';
    return (dec ? nf2 : nf0).format(Number(v)) + ' €';
  }
  function n0(v) { return v == null || isNaN(Number(v)) ? '—' : nf0.format(Number(v)); }
  function parseDate(d) {
    if (!d) return null;
    if (d instanceof Date) return d;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
  }
  function date(d) {
    var x = parseDate(d);
    return x ? x.getDate() + ' ' + MOIS[x.getMonth()] + ' ' + x.getFullYear() : '—';
  }
  function moisCourt(d) { var x = parseDate(d); return x ? MOIS[x.getMonth()] : ''; }
  function moisLong(d) { var x = parseDate(d); return x ? MOIS_LONG[x.getMonth()] + ' ' + x.getFullYear() : ''; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function initiales(p, email) {
    var a = ((p && p.prenom) || '').trim().charAt(0) + ((p && p.nom) || '').trim().charAt(0);
    return (a || (email || '?').charAt(0)).toUpperCase();
  }
  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('is-ok', 'is-error');
    if (kind) el.classList.add(kind === 'ok' ? 'is-ok' : 'is-error');
  }
  function errText(err) {
    var m = (err && (err.message || err.error_description)) || '';
    if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
    if (/Email not confirmed/i.test(m)) return "Votre adresse n'est pas encore confirmée : cliquez sur le lien reçu par e-mail.";
    if (/already registered|already been registered/i.test(m)) return 'Un compte existe déjà avec cette adresse : connectez-vous.';
    if (/Password should be at least/i.test(m)) return 'Le mot de passe est trop court.';
    if (/rate limit|too many/i.test(m)) return 'Trop de tentatives : réessayez dans quelques minutes.';
    if (/captcha/i.test(m)) return 'La vérification anti-robot a échoué : rechargez la page et réessayez.';
    if (/violates check constraint/i.test(m)) return 'Une valeur saisie n’est pas au bon format.';
    if (/row-level security|permission denied/i.test(m)) return "Action non autorisée.";
    return m || 'Une erreur est survenue. Réessayez.';
  }
  async function urlSignee(path, bucket) {
    var r = await db.storage.from(bucket || 'documents').createSignedUrl(path, 120);
    if (r.error) throw r.error;
    return r.data.signedUrl;
  }

  // Boutons « Télécharger » : <button data-doc="chemin" [data-bucket="cv"]>
  function brancherTelechargements(root) {
    (root || document).addEventListener('click', async function (e) {
      var b = e.target.closest('[data-doc]');
      if (!b) return;
      e.preventDefault();
      var w = window.open('', '_blank'); // ouvert tout de suite pour ne pas être bloqué
      try {
        var url = await urlSignee(b.dataset.doc, b.dataset.bucket);
        if (w) { w.opener = null; w.location.href = url; } else { location.href = url; }
      } catch (err) {
        if (w) w.close();
        alert('Document indisponible pour le moment.');
      }
    });
  }

  // ---------- Menu ----------
  var ICONS = {
    accueil: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    contractualisation: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
    contrats: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    reporting: '<path d="M5 20V11M11 20V5M17 20v-6M3 20h18"/>',
    ambassadeur: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>',
    cv: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h4M14.5 13.5h3"/>',
    informations: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.2 4.1-6.5 8-6.5s7 2.3 8 6.5"/>',
    admin: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    valider: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    import: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    demandes: '<path d="M4 5h16v11H8l-4 4z"/>',
    offres: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18"/>',
    journal: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  // Menu de l'administration (sections de admin.html)
  var PAGES_ADMIN = [
    ['accueil', 'apercu', 'Vue d’ensemble'],
    ['ambassadeur', 'consultants', 'Consultants'],
    ['valider', 'a-valider', 'Dossiers à valider'],
    ['contrats', 'signatures', 'Contrats et signatures'],
    ['import', 'import', 'Import VSP'],
    ['demandes', 'demandes', 'Demandes reçues'],
    ['offres', 'offres', 'Offres d’emploi'],
    ['cv', 'cv', 'Convertisseur de CV'],
    ['journal', 'journal', 'Journal']
  ];
  var PAGES = [
    ['accueil', 'index.html', 'Tableau de bord'],
    ['contractualisation', 'contractualisation.html', 'Contractualisation'],
    ['contrats', 'contrats.html', 'Contrats et missions'],
    ['reporting', 'reporting.html', 'Reporting financier'],
    ['ambassadeur', 'ambassadeur.html', 'Ambassadeur'],
    ['cv', 'cv.html', 'Mon CV HT Portage'],
    ['informations', 'informations.html', 'Mes informations']
  ];
  var LOGO = '<svg width="36" height="18" viewBox="0 0 160 81" aria-hidden="true" fill="none" stroke="#FFFFFF" stroke-width="5"><path d="M3.5 69 V10.5 A8 8 0 0 1 19.5 10.5 V24 A8 8 0 0 0 27.5 32 H34 A8 8 0 0 0 42 24 V11.5 A8 8 0 0 1 50 3.5 H97 A7.25 7.25 0 0 1 97 18 H95.5 A8 8 0 0 0 87.5 26 V69 A8.25 8.25 0 0 1 71 69 V24.5 A6 6 0 0 0 59 24.5 V41 A8 8 0 0 1 51 49 H27.5 A8 8 0 0 0 19.5 57 V69 A8 8 0 0 1 3.5 69 Z"/><path d="M42.5 62.5 A8.5 8.5 0 0 1 59.5 62.5 V68.25 A8.5 8.5 0 0 1 42.5 68.25 Z"/><path d="M114 69 V11.5 A8 8 0 0 1 122 3.5 H136 A20.5 20.5 0 0 1 136 44.5 A6 6 0 0 0 130 50.5 V69 A8 8 0 0 1 114 69 Z"/></svg>';

  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>'; }

  function sectionAdmin() {
    var h = (location.hash || '').slice(1);
    return PAGES_ADMIN.some(function (p) { return p[1] === h; }) ? h : 'apercu';
  }
  // Pastille de compteur dans le menu de l'administration (0 = masquée)
  function badge(section, n) {
    var a = document.querySelector('#sidebar [data-section="' + section + '"] [data-pill]');
    if (!a) return;
    a.hidden = !n; a.textContent = n > 99 ? '99+' : String(n || '');
    a.setAttribute('aria-label', n + ' à traiter');
  }

  function renderSidebar(state) {
    var el = document.getElementById('sidebar');
    if (!el) return;
    var current = document.body.dataset.page;
    var links;
    if (state.isAdmin) {
      var section = sectionAdmin();
      links = PAGES_ADMIN.map(function (p) {
        return '<a href="admin.html#' + p[1] + '" data-section="' + p[1] + '"' + (p[1] === section ? ' aria-current="page"' : '') + '>' + icon(p[0]) + '<span>' + esc(p[2]) + '</span><span class="pill" data-pill hidden></span></a>';
      }).join('');
    } else {
      links = PAGES.map(function (p) {
        return '<a href="' + p[1] + '"' + (p[0] === current ? ' aria-current="page"' : '') + '>' + icon(p[0]) + esc(p[2]) + '</a>';
      }).join('');
    }
    el.innerHTML =
      '<div class="sidebar__top">' +
        '<a class="sidebar__brand" href="' + (state.isAdmin ? 'admin.html' : 'index.html') + '">' +
        '<span class="sidebar__name"><strong>HT Portage</strong><span>' + (state.isAdmin ? 'Administration' : 'Espace consultant') + '</span></span></a>' +
        '<span class="sidebar__logo" aria-hidden="true">' + LOGO + '</span>' +
        '<button class="sidebar__toggle" type="button" aria-expanded="false" aria-controls="sidebar-nav" aria-label="Ouvrir le menu">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
      '</div>' +
      '<div class="sidebar__nav" id="sidebar-nav">' + links + '</div>' +
      '<div class="sidebar__foot">' +
        (state.isAdmin ? '<div class="contact-card"><span>Connecté</span><strong>' + esc([state.profil.prenom, state.profil.nom].filter(Boolean).join(' ') || state.user.email) + '</strong><span style="text-transform:none;letter-spacing:0">Administrateur</span></div>' :
        '<div class="contact-card"><span>Votre contact</span><strong>Équipe HT Portage</strong><a href="mailto:' + esc(cfg.contactEmail || 'contact@htportage.fr') + '">' + esc(cfg.contactEmail || 'contact@htportage.fr') + '</a></div>') +
        (state.apercu ? '<a class="logout" href="admin.html#consultants" data-fin-apercu style="text-align:center">Quitter l\'aperçu</a>' : '<button class="logout" type="button" data-logout>Se déconnecter</button>') +
      '</div>';
    // Logo seul, en haut à droite du contenu (sur mobile : dans la barre du haut, à côté du menu)
    var contenu = document.querySelector('.content');
    if (contenu && !contenu.querySelector('.coin-logo')) {
      contenu.insertAdjacentHTML('afterbegin', '<a class="coin-logo" href="../index.html" aria-label="Site HT Portage">' + LOGO + '</a>');
    }
    var toggle = el.querySelector('.sidebar__toggle');
    toggle.addEventListener('click', function () {
      var open = el.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    });
    if (state.apercu) el.querySelector('[data-fin-apercu]').addEventListener('click', function () { try { sessionStorage.removeItem('htp-apercu'); } catch (e) { /* rien */ } });
    else el.querySelector('[data-logout]').addEventListener('click', async function () {
      await db.auth.signOut();
      location.replace('connexion.html');
    });
    document.querySelectorAll('[data-avatar]').forEach(function (a) { a.textContent = initiales(state.profil, state.user.email); });
    if (state.isAdmin) {
      window.addEventListener('hashchange', function () {
        var sec = sectionAdmin();
        el.querySelectorAll('[data-section]').forEach(function (a) {
          if (a.dataset.section === sec) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
        el.classList.remove('is-open');
      });
    }
  }

  // ---------- Contrôle d'accès ----------
  // Renvoie l'état de la session, ou redirige vers la connexion.
  async function guard(opts) {
    opts = opts || {};
    var s = await db.auth.getSession();
    var session = s.data && s.data.session;
    if (!session) {
      var suite = location.pathname.split('/').pop() + location.search;
      location.replace('connexion.html?suite=' + encodeURIComponent(suite));
      return null;
    }
    var user = session.user;
    var res = await Promise.all([
      db.from('profils').select('*').eq('id', user.id).maybeSingle(),
      db.rpc('compte_admin')
    ]);
    // compte_admin (v8) indique l'appartenance à l'équipe ; repli sur is_admin si le script n'est pas encore passé
    var estAdmin = res[1].error ? (await db.rpc('is_admin')).data === true : res[1].data === true;
    // Double authentification obligatoire pour un administrateur
    if (estAdmin && !opts.sansDoubleAuth) {
      var niv = await db.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!niv.data || niv.data.currentLevel !== 'aal2') {
        var cible = location.pathname.split('/').pop() + location.search + location.hash;
        location.replace('securite.html?suite=' + encodeURIComponent(/^admin\.html/.test(cible) ? cible : 'admin.html'));
        return null;
      }
    }
    var state = { user: user, profil: res[0].data || { id: user.id, email: user.email }, isAdmin: estAdmin };
    if (opts.admin && !state.isAdmin) { location.replace('index.html'); return null; }
    // Aperçu : un administrateur voit l'espace d'un consultant tel que celui-ci le verra (lecture seule)
    if (!opts.admin && state.isAdmin) {
      var cibleId = apercuDemande();
      if (cibleId) {
        var c = await db.from('profils').select('*').eq('id', cibleId).maybeSingle();
        if (c.data) {
          state = { user: { id: c.data.id, email: c.data.email }, profil: c.data, isAdmin: false, apercu: true, admin: user };
          activerLectureSeule(state);
          ESPACE.state = state;
          renderSidebar(state);
          document.body.classList.add('is-ready');
          return state;
        }
      }
    }
    // Un administrateur n'a pas d'espace consultant : il va directement à l'administration.
    if (!opts.admin && state.isAdmin) { location.replace('admin.html'); return null; }
    ESPACE.state = state;
    renderSidebar(state);
    await enregistrerSimulationEnAttente(state);
    document.body.classList.add('is-ready');
    return state;
  }

  // ---------- Aperçu administrateur (lecture seule) ----------
  // admin : lien « Voir son espace » → index.html?apercu=<id du consultant> ; mémorisé pour l'onglet.
  function apercuDemande() {
    var q = new URLSearchParams(location.search).get('apercu');
    try {
      if (q === 'fin') { sessionStorage.removeItem('htp-apercu'); return null; }
      if (q && /^[0-9a-f-]{36}$/i.test(q)) sessionStorage.setItem('htp-apercu', q);
      return sessionStorage.getItem('htp-apercu');
    } catch (e) { return q && /^[0-9a-f-]{36}$/i.test(q) ? q : null; }
  }
  function activerLectureSeule(state) {
    var refus = { data: null, error: { message: 'Aperçu en lecture seule : aucune modification n\'est enregistrée.' } };
    // Toute écriture (base, fichiers, fonctions) est refusée côté navigateur pendant l'aperçu
    var from = db.from.bind(db);
    db.from = function (t) {
      var q = from(t);
      ['insert', 'update', 'upsert', 'delete'].forEach(function (m) {
        q[m] = function () {
          var faux = { then: function (ok, ko) { return Promise.resolve(refus).then(ok, ko); } };
          ['eq', 'neq', 'in', 'select', 'single', 'maybeSingle', 'match', 'is', 'order', 'limit'].forEach(function (k) { faux[k] = function () { return faux; }; });
          return faux;
        };
      });
      return q;
    };
    db.functions.invoke = async function () { return refus; };
    document.addEventListener('submit', function (e) {
      e.preventDefault(); e.stopImmediatePropagation();
      var st = e.target.querySelector('.form-status');
      if (st) setStatus(st, 'Aperçu administrateur : les formulaires sont désactivés.', 'error');
    }, true);
    var nom = [state.profil.prenom, state.profil.nom].filter(Boolean).join(' ') || state.profil.email;
    var bandeau = document.createElement('div');
    bandeau.className = 'bandeau-apercu';
    bandeau.setAttribute('role', 'status');
    bandeau.innerHTML = '<span><strong>Aperçu administrateur</strong> · espace de ' + esc(nom) + ' (' + esc(state.profil.email) + '), tel qu\'il le verra. Lecture seule.</span>' +
      '<a class="btn btn--light btn--sm" href="admin.html#consultants" data-fin-apercu>Quitter l\'aperçu</a>';
    document.body.insertBefore(bandeau, document.body.firstChild);
    bandeau.querySelector('[data-fin-apercu]').addEventListener('click', function () { try { sessionStorage.removeItem('htp-apercu'); } catch (e) { /* rien */ } });
  }

  // Recommandations de l'ambassadeur : la base filtre déjà pour un consultant ; en aperçu (administrateur), on filtre ici
  function filtreRecos(q, state) {
    if (!state || !state.apercu) return q;
    return q.or('user_id.eq.' + state.user.id + ',ambassadeur_email.ilike."' + String(state.user.email || '').replace(/["\\%_]/g, '') + '"');
  }

  // Simulation faite avant l'inscription : enregistrée au premier passage dans l'espace.
  async function enregistrerSimulationEnAttente(state) {
    var raw = null;
    try { raw = localStorage.getItem('htp-simulation'); } catch (e) { return; }
    if (!raw) return;
    try {
      var sim = JSON.parse(raw);
      var tjm = parseInt(sim.tjm, 10), jours = parseInt(sim.jours, 10), net = parseInt(sim.net, 10);
      if (tjm >= 100 && tjm <= 5000 && jours >= 1 && jours <= 31 && net >= 0) {
        await db.from('simulations').insert({ user_id: state.user.id, tjm: tjm, jours: jours, net_estime: net });
      }
    } catch (e) { /* simulation illisible : ignorée */ }
    try { localStorage.removeItem('htp-simulation'); } catch (e) { /* rien */ }
  }

  db.auth.onAuthStateChange(function (event) {
    var page = document.body.dataset.page;
    if (event === 'SIGNED_OUT' && page && page !== 'connexion' && page !== 'reset') {
      location.replace('connexion.html');
    }
  });

  // ---------- Libellés et étiquettes de statut ----------
  var LIBELLES = {
    mission: {
      brouillon: ['Brouillon', 'tag--rose'], a_valider: ['En vérification', 'tag--rose'], validee: ['Validée', ''],
      active: ['Active', ''], terminee: ['Terminée', 'tag--muted'], annulee: ['Annulée', 'tag--muted']
    },
    document: {
      en_preparation: ['En préparation', 'tag--rose'], a_signer: ['À signer', 'tag--dark'], signe: ['Signé', ''], disponible: ['Disponible', ''],
      refuse: ['Signature refusée', 'tag--rose'], annule: ['Annulé', 'tag--muted']
    },
    reco: {
      nouvelle: ['Reçue', ''], 'en cours': ['En discussion', 'tag--rose'], validee: ['Aboutie · prime à venir', 'tag--dark'],
      'prime versee': ['Prime versée', 'tag--dark'], refusee: ['Non retenue', 'tag--muted']
    },
    typeDoc: {
      cdi: 'CDI de portage salarial', annexe: 'Annexe · conditions de la prestation', avenant: 'Avenant', bulletin: 'Bulletin de paie',
      compte_activite: "Compte d'activité", attestation: 'Attestation', autre: 'Document'
    },
    typeReco: { consultant: 'Consultant', mission: 'Mission', client: 'Client', formation: 'Formation' }
  };
  function tag(groupe, valeur) {
    var l = (LIBELLES[groupe] || {})[valeur] || [valeur || '—', 'tag--muted'];
    return '<span class="tag ' + l[1] + '">' + esc(l[0]) + '</span>';
  }

  // Informations obligatoires pour établir le contrat (mêmes règles que la fonction « contrats »)
  var EXIGENCES = {
    identite: [['civilite', 'civilité'], ['prenom', 'prénom'], ['nom', 'nom'], ['date_naissance', 'date de naissance'], ['lieu_naissance', 'lieu de naissance']],
    // N° de sécurité sociale et IBAN : facultatifs (demandés plus tard par l'équipe si besoin)
    coordonnees: [['adresse', 'adresse'], ['code_postal', 'code postal'], ['ville', 'ville']]
  };
  function manquants(p) {
    p = p || {};
    var f = function (liste) { return liste.filter(function (x) { return !p[x[0]]; }).map(function (x) { return x[1]; }); };
    return { identite: f(EXIGENCES.identite), coordonnees: f(EXIGENCES.coordonnees) };
  }
  function listeFr(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' et ' + a[a.length - 1]; }

  var ESPACE = {
    db: db, cfg: cfg, guard: guard, state: null, filtreRecos: filtreRecos, LIBELLES: LIBELLES, tag: tag, EXIGENCES: EXIGENCES, manquants: manquants, listeFr: listeFr,
    sectionAdmin: sectionAdmin, badge: badge, PAGES_ADMIN: PAGES_ADMIN,
    esc: esc, num: num, eur: eur, n0: n0, date: date, parseDate: parseDate,
    moisCourt: moisCourt, moisLong: moisLong, cap: cap, initiales: initiales,
    setStatus: setStatus, errText: errText, urlSignee: urlSignee, brancherTelechargements: brancherTelechargements
  };
  window.ESPACE = ESPACE;
})();
