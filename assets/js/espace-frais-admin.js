// Espace HT Portage — administration, rubrique « Contrôle des notes de frais ».
// Données : public.notes_frais (recopiées de VSP par vsp-sync), classées par mois de la note.
// Vue globale (tous les consultants) et vue fine (un consultant), avec contrôles de cohérence :
// chaque anomalie est affichée en rouge, avec sa raison, pour vérification avant remboursement.
(function () {
  'use strict';
  var E = window.ESPACE;
  var zone = document.getElementById('nf-contenu');
  if (!E || !zone) return;
  var db = E.db, esc = E.esc;

  // ---------------------------------------------------------------------
  // Réglages des contrôles (montants TTC, en euros)
  // ---------------------------------------------------------------------
  var REGLES = {
    grosMontant: 150,          // une ligne au-dessus : à justifier
    tresGrosMontant: 500,      // au-dessus : gravité haute
    ecartHabituel: 0.15,       // repas / km : écart toléré avec le montant habituel du consultant (15 %)
    ecartMinEuros: 2,          // … et d'au moins 2 €
    occurrencesHabitude: 3,    // il faut au moins 3 lignes pour connaître un « montant habituel »
    materielParAn: 1,          // achats d'ordinateur / téléphone / tablette autorisés sur 12 mois glissants
    materielCher: 1500,        // un seul achat de matériel au-dessus : gravité haute
    hausseMensuelle: 1.5,      // total du mois > 1,5 × la moyenne des autres mois du consultant
    ratioCa: 0.15              // frais du mois > 15 % du CA du mois
  };

  // Catégories, reconnues au type et au motif de la ligne VSP
  var CATS = [
    ['km', 'Frais kilométriques', /kilom|\bik\b|ind[eé]mnit[eé]s? km|bar[eè]me km|v[eé]hicule personnel/],
    ['repas', 'Repas', /repas|restaurant|d[eé]jeuner|d[iî]ner|midi|ticket resto|sandwich|traiteur/],
    ['materiel', 'Matériel informatique / téléphone', /ordinateur|\bpc\b|laptop|macbook|portable (?!t[eé]l[eé]phone)|[eé]cran|moniteur|clavier|souris|tablette|ipad|smartphone|iphone|samsung galaxy|achat (de )?t[eé]l[eé]phone|t[eé]l[eé]phone (portable|mobile) (neuf|achat)|mat[eé]riel( informatique)?|imprimante/],
    ['telecom', 'Téléphone / internet', /box|internet|forfait|abonnement|t[eé]l[eé]phone|mobile|fibre/],
    ['transport', 'Transport', /train|sncf|tgv|avion|vol |a[eé]rien|taxi|uber|vtc|p[eé]age|parking|navigo|transport|m[eé]tro|bus|location (de )?voiture|carburant|essence|gasoil/],
    ['hebergement', 'Hébergement', /h[oô]tel|airbnb|h[eé]bergement|nuit[eé]e|logement/],
    ['formation', 'Formation / documentation', /formation|livre|documentation|certification|abonnement (logiciel|saas)|licence|logiciel/],
    ['autre', 'Autres', /.*/]
  ];
  function categorie(f) {
    var t = ((f.type || '') + ' ' + (f.motif || '')).toLowerCase();
    // Un abonnement (box, forfait) n'est jamais un achat de matériel
    for (var i = 0; i < CATS.length; i++) {
      if (CATS[i][0] === 'materiel' && /box|internet|forfait|abonnement|fibre/.test(t)) continue;
      if (CATS[i][2].test(t)) return CATS[i][0];
    }
    return 'autre';
  }
  var LIB_CAT = {}; CATS.forEach(function (c) { LIB_CAT[c[0]] = c[1]; });

  // Jours fériés (France métropolitaine)
  function paques(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  }
  var feries = {};
  function estFerie(iso) {
    var y = Number(iso.slice(0, 4));
    if (!feries[y]) {
      var p = paques(y), s = {}, add = function (d) { s[d.toISOString().slice(0, 10)] = 1; };
      ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].forEach(function (md) { s[y + '-' + md] = 1; });
      [1, 39, 50].forEach(function (n) { add(new Date(p.getTime() + n * 864e5)); });
      feries[y] = s;
    }
    return !!feries[y][iso];
  }
  function finDeSemaine(iso) { var d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 0 || d === 6; }
  function mode(vals) {
    var c = {}; vals.forEach(function (v) { var k = v.toFixed(2); c[k] = (c[k] || 0) + 1; });
    var best = null, n = 0; Object.keys(c).forEach(function (k) { if (c[k] > n) { n = c[k]; best = Number(k); } });
    return { valeur: best, nb: n };
  }

  // ---------------------------------------------------------------------
  // Contrôles : chaque ligne reçoit la liste de ses anomalies { niveau: 'haute'|'moyenne', texte }
  // Les habitudes (montant habituel, achats de matériel) se calculent sur TOUT l'historique chargé.
  // ---------------------------------------------------------------------
  function controler(lignes) {
    var parQui = {};
    lignes.forEach(function (f) {
      f.cat = categorie(f); f.ttc = Number(f.montant_ttc) || 0; f.anomalies = [];
      (parQui[f.user_id] = parQui[f.user_id] || []).push(f);
    });
    Object.keys(parQui).forEach(function (uid) {
      var l = parQui[uid];
      // Montant habituel par catégorie (repas, km)
      var habitude = {};
      ['repas', 'km'].forEach(function (c) {
        var v = l.filter(function (f) { return f.cat === c && f.ttc > 0; }).map(function (f) { return f.ttc; });
        if (v.length >= REGLES.occurrencesHabitude) { var m = mode(v); if (m.nb >= 2) habitude[c] = m.valeur; }
      });
      // Doublons et repas multiples le même jour
      var cles = {}, repasJour = {};
      l.forEach(function (f) {
        var k = f.date_frais + '|' + f.cat + '|' + f.ttc.toFixed(2);
        (cles[k] = cles[k] || []).push(f);
        if (f.cat === 'repas' && f.date_frais) (repasJour[f.date_frais] = repasJour[f.date_frais] || []).push(f);
      });
      Object.keys(cles).forEach(function (k) {
        if (cles[k].length > 1 && cles[k][0].date_frais) cles[k].forEach(function (f) { f.anomalies.push({ niveau: 'haute', texte: 'Doublon possible : ' + cles[k].length + ' lignes identiques le même jour' }); });
      });
      Object.keys(repasJour).forEach(function (d) {
        if (repasJour[d].length > 1) repasJour[d].forEach(function (f) { f.anomalies.push({ niveau: 'haute', texte: repasJour[d].length + ' repas déclarés le même jour' }); });
      });
      // Matériel informatique / téléphone : pas plus de N achats sur 12 mois glissants
      var materiel = l.filter(function (f) { return f.cat === 'materiel' && f.date_frais; }).sort(function (a, b) { return a.date_frais < b.date_frais ? -1 : 1; });
      materiel.forEach(function (f) {
        var t = Date.parse(f.date_frais);
        var autres = materiel.filter(function (g) { return g !== f && Math.abs(Date.parse(g.date_frais) - t) < 365 * 864e5; });
        if (autres.length >= REGLES.materielParAn) f.anomalies.push({ niveau: 'haute', texte: 'Achat de matériel : ' + (autres.length + 1) + ' achats en moins de 12 mois (' + autres.map(function (g) { return E.date(g.date_frais); }).join(', ') + ')' });
        if (f.ttc >= REGLES.materielCher) f.anomalies.push({ niveau: 'haute', texte: 'Matériel au-dessus de ' + E.eur(REGLES.materielCher) });
      });
      l.forEach(function (f) {
        // Gros montants
        if (f.ttc >= REGLES.tresGrosMontant) f.anomalies.push({ niveau: 'haute', texte: 'Montant élevé (≥ ' + E.eur(REGLES.tresGrosMontant) + ')' });
        else if (f.ttc >= REGLES.grosMontant && f.cat !== 'hebergement' && f.cat !== 'transport') f.anomalies.push({ niveau: 'moyenne', texte: 'Montant important (≥ ' + E.eur(REGLES.grosMontant) + ') pour un frais « ' + LIB_CAT[f.cat].toLowerCase() + ' »' });
        // Repas et km : même montant que d'habitude sur la mission
        if (habitude[f.cat] != null && f.ttc > 0) {
          var h = habitude[f.cat], ecart = Math.abs(f.ttc - h);
          if (ecart > REGLES.ecartMinEuros && ecart / h > REGLES.ecartHabituel) f.anomalies.push({ niveau: 'moyenne', texte: LIB_CAT[f.cat] + ' : ' + E.eur(f.ttc, true) + ' au lieu de ' + E.eur(h, true) + ' habituellement' });
        }
        // Repas et km un week-end ou un jour férié
        if ((f.cat === 'repas' || f.cat === 'km') && f.date_frais) {
          if (finDeSemaine(f.date_frais)) f.anomalies.push({ niveau: 'moyenne', texte: LIB_CAT[f.cat] + ' un week-end' });
          else if (estFerie(f.date_frais)) f.anomalies.push({ niveau: 'moyenne', texte: LIB_CAT[f.cat] + ' un jour férié' });
        }
        // Dépense très ancienne par rapport au mois de la note
        if (f.date_frais && f.mois && (Date.parse(f.mois) - Date.parse(f.date_frais)) > 92 * 864e5) f.anomalies.push({ niveau: 'moyenne', texte: 'Dépense de plus de 3 mois avant la note' });
        if (!f.motif) f.anomalies.push({ niveau: 'moyenne', texte: 'Sans motif' });
        // Justificatif : obligatoire sauf pour les repas (forfait)
        if (f.justificatif === false && f.cat !== 'repas') f.anomalies.push({ niveau: 'haute', texte: 'Aucun justificatif joint dans VSP' });
      });
    });
    // Lignes validées par un administrateur : elles ne ressortent plus, tant que le montant n'a pas changé dans VSP
    lignes.forEach(function (f) {
      f.validee = false;
      if (!f.valide_le) return;
      if (Math.abs((Number(f.valide_montant) || 0) - f.ttc) < 0.005) { f.validee = true; f.anomaliesValidees = f.anomalies; f.anomalies = []; }
      else f.anomalies.unshift({ niveau: 'haute', texte: 'Montant modifié dans VSP depuis la validation (' + E.eur(Number(f.valide_montant), true) + ' validés)' });
    });
    return parQui;
  }

  // ---------------------------------------------------------------------
  // Chargement
  // ---------------------------------------------------------------------
  var selAnnee = document.getElementById('nf-annee'), selMois = document.getElementById('nf-mois'), selQui = document.getElementById('nf-qui'), chkAno = document.getElementById('nf-anomalies');
  var D = { lignes: [], noms: {}, ca: {} };
  var NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function libMois(m) { return NOMS_MOIS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4); }

  async function charger() {
    zone.innerHTML = '<p class="loading">Chargement…</p>';
    var cols = 'id, user_id, mois, date_frais, type, montant_ht, montant_ttc, motif, valide_le, valide_par, valide_montant, valide_commentaire';
    var r = await db.from('notes_frais').select(cols + ', justificatif').order('date_frais').limit(20000);
    // colonne « justificatif » pas encore créée (espace-v24.sql) : on charge sans
    if (r.error && /justificatif/.test(r.error.message || '')) r = await db.from('notes_frais').select(cols).order('date_frais').limit(20000);
    if (r.error) { zone.innerHTML = '<p class="small">' + esc(E.errText(r.error)) + '</p>'; return; }
    D.lignes = r.data || [];
    var ids = D.lignes.map(function (f) { return f.user_id; }).filter(function (v, i, t) { return t.indexOf(v) === i; });
    var p = ids.length ? await db.from('profils').select('id, prenom, nom, email').in('id', ids) : { data: [] };
    D.noms = {}; (p.data || []).forEach(function (x) { D.noms[x.id] = [x.prenom, x.nom].filter(Boolean).join(' ') || x.email; });
    var ca = ids.length ? await db.from('comptes_activite').select('user_id, mois, ca_ht').in('user_id', ids) : { data: [] };
    D.ca = {}; (ca.data || []).forEach(function (c) { D.ca[c.user_id + '|' + String(c.mois).slice(0, 7)] = Number(c.ca_ht) || 0; });
    controler(D.lignes);
    // Filtres
    var annees = D.lignes.map(function (f) { return String(f.mois).slice(0, 4); }).concat([String(new Date().getFullYear())]).filter(function (v, i, t) { return t.indexOf(v) === i; }).sort().reverse();
    var a = selAnnee.value; selAnnee.innerHTML = annees.map(function (y) { return '<option>' + y + '</option>'; }).join(''); if (a && annees.indexOf(a) >= 0) selAnnee.value = a;
    var q = selQui.value;
    selQui.innerHTML = '<option value="">Tous (vue globale)</option>' + ids.slice().sort(function (x, y) { return String(D.noms[x]).localeCompare(String(D.noms[y])); }).map(function (id) { return '<option value="' + id + '">' + esc(D.noms[id] || '—') + '</option>'; }).join('');
    if (q && ids.indexOf(q) >= 0) selQui.value = q;
    remplirMois();
    afficher();
  }
  function remplirMois() {
    var an = selAnnee.value, m = selMois.value;
    var mois = D.lignes.map(function (f) { return String(f.mois).slice(0, 7); }).filter(function (v, i, t) { return v.slice(0, 4) === an && t.indexOf(v) === i; }).sort().reverse();
    selMois.innerHTML = '<option value="">Toute l\'année</option>' + mois.map(function (x) { return '<option value="' + x + '">' + esc(libMois(x)) + '</option>'; }).join('');
    if (m && mois.indexOf(m) >= 0) selMois.value = m;
  }

  // ---------------------------------------------------------------------
  // Affichage
  // ---------------------------------------------------------------------
  var ROUGE = 'color:#b42318', FOND_ROUGE = 'background:#fdecea';
  function pastille(n, haute) { return n ? '<span style="display:inline-block;min-width:22px;padding:2px 8px;border-radius:999px;font-weight:700;font-size:13px;' + (haute ? 'background:#b42318;color:#fff' : 'background:#fdecea;color:#b42318') + '">' + n + '</span>' : '<span class="small">—</span>'; }
  // Cellule « Contrôle » : raisons + bouton Valider, ou mention de validation + Annuler
  var VERT = 'color:#1f7a4d';
  function controle(f) {
    if (f.anomalies.length) return raisons(f) + '<button class="btn btn--light btn--sm" type="button" data-valider="' + esc(f.id) + '" style="margin-top:6px">Valider</button>';
    if (f.validee) {
      return '<div style="' + VERT + ';font-size:13px;font-weight:700">✓ Validée par ' + esc(f.valide_par || '—') + ' le ' + esc(E.date(f.valide_le)) + '</div>' +
        (f.valide_commentaire ? '<div class="small" style="font-size:13px">« ' + esc(f.valide_commentaire) + ' »</div>' : '') +
        '<div class="small" style="font-size:12px">Signalée pour : ' + esc((f.anomaliesValidees || []).map(function (a) { return a.texte; }).join(' · ')) + '</div>' +
        '<button class="link-btn" type="button" data-annuler="' + esc(f.id) + '" style="font-size:12px">Annuler la validation</button>';
    }
    return '<span class="small">OK</span>';
  }
  function raisons(f) { return f.anomalies.map(function (a) { return '<div style="' + ROUGE + ';font-size:13px;font-weight:' + (a.niveau === 'haute' ? 700 : 600) + '">⚠ ' + esc(a.texte) + '</div>'; }).join(''); }
  function kpi(label, val, note, rouge) { return '<div class="kpi' + (rouge ? '' : '') + '"' + (rouge ? ' style="' + FOND_ROUGE + '"' : '') + '><span class="kpi__label">' + esc(label) + '</span><span class="kpi__value"' + (rouge ? ' style="' + ROUGE + '"' : '') + '>' + val + '</span><span class="kpi__note">' + esc(note || '') + '</span></div>'; }

  function periode() {
    var an = selAnnee.value, m = selMois.value;
    return D.lignes.filter(function (f) { var x = String(f.mois); return m ? x.slice(0, 7) === m : x.slice(0, 4) === an; });
  }
  function tableLignes(lignes, avecQui) {
    var l = chkAno.checked ? lignes.filter(function (f) { return f.anomalies.length; }) : lignes;
    if (!l.length) return '<p class="small" style="margin:0">' + (chkAno.checked ? 'Aucune anomalie sur la période.' : 'Aucune note de frais sur la période.') + '</p>';
    return '<div class="table-wrap"><table class="table"><thead><tr>' + (avecQui ? '<th scope="col">Consultant</th>' : '') + '<th scope="col">Note</th><th scope="col">Date</th><th scope="col">Catégorie</th><th scope="col">Type · motif</th><th scope="col" style="text-align:right">TTC</th><th scope="col">Contrôle</th></tr></thead><tbody>' +
      l.map(function (f) {
        var ko = f.anomalies.length;
        return '<tr' + (ko ? ' style="' + FOND_ROUGE + '"' : '') + '>' + (avecQui ? '<td><a href="#frais" data-qui="' + f.user_id + '">' + esc(D.noms[f.user_id] || '—') + '</a></td>' : '') +
          '<td class="small">' + esc(libMois(String(f.mois).slice(0, 7))) + '</td><td>' + esc(E.date(f.date_frais)) + '</td><td>' + esc(LIB_CAT[f.cat]) + '</td><td>' + esc(f.type || '—') + (f.motif ? '<div class="small">' + esc(f.motif) + '</div>' : '') + '</td>' +
          '<td style="text-align:right' + (ko ? ';' + ROUGE + ';font-weight:700' : '') + '">' + E.eur(f.ttc, true) + '</td><td>' + controle(f) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function parCategorie(lignes) {
    var c = {}; lignes.forEach(function (f) { var x = c[f.cat] = c[f.cat] || { n: 0, ttc: 0, ko: 0 }; x.n++; x.ttc += f.ttc; if (f.anomalies.length) x.ko++; });
    return '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Catégorie</th><th scope="col" style="text-align:right">Lignes</th><th scope="col" style="text-align:right">Total TTC</th><th scope="col" style="text-align:right">Moyenne</th><th scope="col" style="text-align:right">Anomalies</th></tr></thead><tbody>' +
      CATS.map(function (k) { return k[0]; }).filter(function (k) { return c[k]; }).map(function (k) {
        var x = c[k]; return '<tr><td>' + esc(LIB_CAT[k]) + '</td><td style="text-align:right">' + x.n + '</td><td style="text-align:right">' + E.eur(x.ttc, true) + '</td><td style="text-align:right">' + E.eur(x.ttc / x.n, true) + '</td><td style="text-align:right">' + pastille(x.ko, false) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  // Indicateurs mensuels d'un consultant : total, moyenne des autres mois, part du CA
  function moisConsultant(uid, an) {
    var parMois = {};
    D.lignes.filter(function (f) { return f.user_id === uid && String(f.mois).slice(0, 4) === an; }).forEach(function (f) {
      var m = String(f.mois).slice(0, 7), x = parMois[m] = parMois[m] || { ttc: 0, n: 0, ko: 0 }; x.ttc += f.ttc; x.n++; if (f.anomalies.length) x.ko++;
    });
    var ms = Object.keys(parMois).sort();
    ms.forEach(function (m) {
      var autres = ms.filter(function (o) { return o !== m; }), moy = autres.length ? autres.reduce(function (t, o) { return t + parMois[o].ttc; }, 0) / autres.length : null;
      var x = parMois[m]; x.moyAutres = moy; x.ca = D.ca[uid + '|' + m] || null;
      x.alertes = [];
      if (moy && autres.length >= 2 && x.ttc > REGLES.hausseMensuelle * moy) x.alertes.push('+' + Math.round((x.ttc / moy - 1) * 100) + ' % par rapport à sa moyenne');
      if (x.ca && x.ttc / x.ca > REGLES.ratioCa) x.alertes.push(Math.round(100 * x.ttc / x.ca) + ' % du CA du mois');
    });
    return { mois: ms, parMois: parMois };
  }

  function vueGlobale() {
    var l = periode(), an = selAnnee.value;
    var ko = l.filter(function (f) { return f.anomalies.length; }), haute = ko.filter(function (f) { return f.anomalies.some(function (a) { return a.niveau === 'haute'; }); });
    var total = l.reduce(function (t, f) { return t + f.ttc; }, 0), totalKo = ko.reduce(function (t, f) { return t + f.ttc; }, 0);
    var ids = l.map(function (f) { return f.user_id; }).filter(function (v, i, t) { return t.indexOf(v) === i; }).sort(function (x, y) { return String(D.noms[x]).localeCompare(String(D.noms[y])); });
    var lignesQui = ids.map(function (uid) {
      var mine = l.filter(function (f) { return f.user_id === uid; }), t = mine.reduce(function (s, f) { return s + f.ttc; }, 0);
      var a = mine.filter(function (f) { return f.anomalies.length; }), h = a.filter(function (f) { return f.anomalies.some(function (x) { return x.niveau === 'haute'; }); });
      var mc = moisConsultant(uid, an), alertesMois = [];
      Object.keys(mc.parMois).filter(function (m) { return !selMois.value || m === selMois.value; }).forEach(function (m) { mc.parMois[m].alertes.forEach(function (x) { alertesMois.push(libMois(m) + ' : ' + x); }); });
      // Part du CA : seulement sur les mois dont le CA est connu (sinon le ratio serait faussé)
      var moisCa = Object.keys(mc.parMois).filter(function (m) { return (!selMois.value || m === selMois.value) && mc.parMois[m].ca; });
      var ca = moisCa.reduce(function (s, m) { return s + mc.parMois[m].ca; }, 0), fraisCa = moisCa.reduce(function (s, m) { return s + mc.parMois[m].ttc; }, 0);
      var rouge = a.length || alertesMois.length;
      return '<tr' + (rouge ? ' style="' + FOND_ROUGE + '"' : '') + '><td><a href="#frais" data-qui="' + uid + '"><strong>' + esc(D.noms[uid] || '—') + '</strong></a></td><td style="text-align:right">' + mine.length + '</td><td style="text-align:right">' + E.eur(t, true) + '</td>' +
        '<td style="text-align:right">' + (ca ? Math.round(100 * fraisCa / ca) + ' %' : '—') + '</td><td style="text-align:right">' + pastille(h.length, true) + '</td><td style="text-align:right">' + pastille(a.length - h.length, false) + '</td>' +
        '<td>' + alertesMois.map(function (x) { return '<div style="' + ROUGE + ';font-size:13px;font-weight:600">⚠ ' + esc(x) + '</div>'; }).join('') + '</td></tr>';
    }).join('');
    var aVerifier = ko.slice().sort(function (a, b) {
      var ha = a.anomalies.some(function (x) { return x.niveau === 'haute'; }), hb = b.anomalies.some(function (x) { return x.niveau === 'haute'; });
      return ha !== hb ? (ha ? -1 : 1) : b.ttc - a.ttc;
    });
    zone.innerHTML =
      '<section class="kpis" aria-label="Synthèse">' +
        kpi('Frais déclarés', E.eur(total, true), l.length + ' lignes · ' + ids.length + ' consultant' + (ids.length > 1 ? 's' : '')) +
        kpi('Lignes à vérifier', String(ko.length), E.eur(totalKo, true) + ' concernés' + (l.filter(function (f) { return f.validee; }).length ? ' · ' + l.filter(function (f) { return f.validee; }).length + ' déjà validée(s)' : ''), ko.length) +
        kpi('Anomalies graves', String(haute.length), 'doublons, matériel, très gros montants', haute.length) +
      '</section>' +
      '<section class="box"><div class="box__head"><h2 class="box__title">Par consultant</h2><span class="small">Cliquez sur un nom pour sa vue détaillée</span></div>' +
        (ids.length ? '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Consultant</th><th scope="col" style="text-align:right">Lignes</th><th scope="col" style="text-align:right">Total TTC</th><th scope="col" style="text-align:right">Part du CA</th><th scope="col" style="text-align:right">Graves</th><th scope="col" style="text-align:right">À vérifier</th><th scope="col">Alertes du mois</th></tr></thead><tbody>' + lignesQui + '</tbody></table></div>' : '<p class="small">Aucune note de frais sur la période.</p>') + '</section>' +
      '<section class="box"><div class="box__head"><h2 class="box__title" style="' + (ko.length ? ROUGE : '') + '">À vérifier (' + ko.length + ')</h2><span class="small">Graves d\'abord, puis par montant</span></div>' + (ko.length ? tableLignes(aVerifier, true).replace('Aucune anomalie sur la période.', '') : '<p class="small" style="margin:0">Aucune anomalie détectée sur la période.</p>') + '</section>' +
      '<section class="box"><h2 class="box__title">Par catégorie</h2>' + parCategorie(l) + '</section>' +
      regles();
  }

  function vueConsultant(uid) {
    var an = selAnnee.value, l = periode().filter(function (f) { return f.user_id === uid; });
    var toutes = D.lignes.filter(function (f) { return f.user_id === uid; });
    var ko = l.filter(function (f) { return f.anomalies.length; }), total = l.reduce(function (t, f) { return t + f.ttc; }, 0);
    var mc = moisConsultant(uid, an);
    // Part globale des frais dans le CA, sur les mois de la période dont le CA est connu
    var moisCa = mc.mois.filter(function (m) { return (!selMois.value || m === selMois.value) && mc.parMois[m].ca; });
    var caPer = moisCa.reduce(function (s, m) { return s + mc.parMois[m].ca; }, 0), fraisPer = moisCa.reduce(function (s, m) { return s + mc.parMois[m].ttc; }, 0);
    var ratio = caPer ? fraisPer / caPer : null;
    var noteRatio = caPer ? E.eur(fraisPer, true) + ' de frais pour ' + E.eur(caPer) + ' HT de CA (' + moisCa.length + ' mois' + (moisCa.length < mc.mois.filter(function (m) { return !selMois.value || m === selMois.value; }).length ? ' dont le CA est connu' : '') + ')' : 'CA non disponible sur la période';
    // Montants habituels (sur tout l'historique)
    var hab = ['repas', 'km'].map(function (c) {
      var v = toutes.filter(function (f) { return f.cat === c && f.ttc > 0; }).map(function (f) { return f.ttc; });
      if (!v.length) return null;
      var m = mode(v); return '<li>' + esc(LIB_CAT[c]) + ' : <strong>' + E.eur(m.valeur, true) + '</strong> dans ' + m.nb + ' cas sur ' + v.length + '</li>';
    }).filter(Boolean);
    var mat = toutes.filter(function (f) { return f.cat === 'materiel'; });
    zone.innerHTML =
      '<p style="margin:0 0 12px"><a href="#frais" data-qui="">← Vue globale</a></p>' +
      '<section class="kpis" aria-label="Synthèse du consultant">' +
        kpi(D.noms[uid] || '—', E.eur(total, true), l.length + ' lignes sur la période') +
        kpi('Frais / CA', ratio != null ? (Math.round(ratio * 1000) / 10).toLocaleString('fr-FR') + ' %' : '—', noteRatio + (ratio != null && ratio > REGLES.ratioCa ? ' · au-dessus de ' + Math.round(REGLES.ratioCa * 100) + ' %' : ''), ratio != null && ratio > REGLES.ratioCa) +
        kpi('Lignes à vérifier', String(ko.length), E.eur(ko.reduce(function (t, f) { return t + f.ttc; }, 0), true) + ' concernés', ko.length) +
        kpi('Achats de matériel', String(mat.length), mat.length ? mat.map(function (f) { return E.date(f.date_frais); }).join(', ') : 'aucun dans l\'historique', mat.length > REGLES.materielParAn) +
      '</section>' +
      '<section class="box"><h2 class="box__title">Mois par mois (' + esc(an) + ')</h2>' +
        (mc.mois.length ? '<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Mois de la note</th><th scope="col" style="text-align:right">Lignes</th><th scope="col" style="text-align:right">Total TTC</th><th scope="col" style="text-align:right">Moyenne des autres mois</th><th scope="col" style="text-align:right">Part du CA</th><th scope="col" style="text-align:right">À vérifier</th><th scope="col">Alertes</th></tr></thead><tbody>' +
          mc.mois.slice().reverse().map(function (m) {
            var x = mc.parMois[m], rouge = x.alertes.length || x.ko;
            return '<tr' + (rouge ? ' style="' + FOND_ROUGE + '"' : '') + '><td>' + esc(libMois(m)) + '</td><td style="text-align:right">' + x.n + '</td><td style="text-align:right' + (x.alertes.length ? ';' + ROUGE + ';font-weight:700' : '') + '">' + E.eur(x.ttc, true) + '</td><td style="text-align:right">' + (x.moyAutres != null ? E.eur(x.moyAutres, true) : '—') + '</td><td style="text-align:right">' + (x.ca ? Math.round(100 * x.ttc / x.ca) + ' %' : '—') + '</td><td style="text-align:right">' + pastille(x.ko, false) + '</td><td>' + x.alertes.map(function (a) { return '<div style="' + ROUGE + ';font-size:13px;font-weight:600">⚠ ' + esc(a) + '</div>'; }).join('') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="small">Aucune note sur l\'année.</p>') + '</section>' +
      '<section class="box"><h2 class="box__title">Habitudes sur la mission</h2>' + (hab.length ? '<ul class="small" style="font-size:14px;margin:0;padding-left:20px">' + hab.join('') + '</ul><p class="small" style="margin:6px 0 0">Un repas ou un frais kilométrique d\'un autre montant ressort en rouge.</p>' : '<p class="small" style="margin:0">Pas encore assez de repas ou de frais kilométriques pour établir un montant habituel.</p>') + '</section>' +
      '<section class="box"><h2 class="box__title">Par catégorie</h2>' + parCategorie(l) + '</section>' +
      '<section class="box"><div class="box__head"><h2 class="box__title">Détail des lignes</h2><span class="small">Anomalies en rouge · plus récentes d\'abord</span></div>' + tableLignes(l.slice().reverse(), false) + '</section>';
  }
  function regles() {
    return '<details class="box"><summary class="small" style="cursor:pointer;font-weight:600">Contrôles appliqués</summary><ul class="small" style="font-size:14px;margin:10px 0 0;padding-left:20px;display:grid;gap:4px">' +
      '<li>Montant d\'une ligne ≥ ' + E.eur(REGLES.grosMontant) + ' (hors transport et hébergement) ; ≥ ' + E.eur(REGLES.tresGrosMontant) + ' : grave.</li>' +
      '<li>Repas et frais kilométriques : montant différent de plus de ' + Math.round(REGLES.ecartHabituel * 100) + ' % du montant habituel du consultant ; déclarés un week-end ou un jour férié ; plusieurs repas le même jour (grave).</li>' +
      '<li>Matériel informatique ou téléphone (PC, écran, tablette, smartphone…) : plus de ' + REGLES.materielParAn + ' achat sur 12 mois glissants (grave) ; un achat ≥ ' + E.eur(REGLES.materielCher) + ' (grave). Les abonnements box / forfait ne sont pas du matériel.</li>' +
      '<li>Doublons : même jour, même catégorie, même montant (grave).</li>' +
      '<li>Aucun justificatif joint dans VSP, sauf pour les repas (grave).</li>' +
      '<li>Dépense de plus de 3 mois avant le mois de la note ; ligne sans motif.</li>' +
      '<li>Par consultant et par mois : total supérieur à ' + REGLES.hausseMensuelle + ' × la moyenne de ses autres mois ; frais supérieurs à ' + Math.round(REGLES.ratioCa * 100) + ' % de son CA du mois.</li>' +
      '</ul><p class="small" style="margin:8px 0 0">La catégorie est déduite du type et du motif saisis dans VSP. Une anomalie n\'est pas une fraude : c\'est une ligne à regarder.</p></details>';
  }

  function afficher() { if (selQui.value) vueConsultant(selQui.value); else vueGlobale(); }
  selAnnee.addEventListener('change', function () { remplirMois(); afficher(); });
  selMois.addEventListener('change', afficher);
  selQui.addEventListener('change', afficher);
  chkAno.addEventListener('change', afficher);
  zone.addEventListener('click', async function (e) {
    var v = e.target.closest('[data-valider],[data-annuler]');
    if (v) {
      e.preventDefault();
      var valider = v.hasAttribute('data-valider');
      var commentaire = null;
      if (valider) {
        commentaire = window.prompt('Valider cette note de frais. Commentaire (facultatif), par exemple « justificatif reçu » :', '');
        if (commentaire === null) return; // Annuler dans la fenêtre
      } else if (!window.confirm('Annuler la validation ? La ligne ressortira de nouveau en anomalie.')) return;
      v.disabled = true;
      var r = await db.rpc('valider_note_frais', { p_id: v.dataset.valider || v.dataset.annuler, p_valider: valider, p_commentaire: commentaire });
      if (r.error) { v.disabled = false; window.alert('Enregistrement impossible : ' + E.errText(r.error)); return; }
      var y = window.scrollY; await charger(); window.scrollTo(0, y);
      return;
    }
    var a = e.target.closest('[data-qui]');
    if (!a) return;
    e.preventDefault(); selQui.value = a.dataset.qui; afficher(); window.scrollTo(0, 0);
  });

  var charge = false;
  function siOuvert() { if (!charge && E.sectionAdmin() === 'frais') { charge = true; charger(); } }
  window.addEventListener('hashchange', siOuvert);
  var t = setInterval(function () { if (E.state) { clearInterval(t); siOuvert(); } }, 200);
  window.HTP_FRAIS = { recharger: function () { if (charge) charger(); } };
})();
