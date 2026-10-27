// Espace HT Portage — migration des salariés depuis VSP (administration, rubrique « Import VSP »).
// L'administrateur dépose les exports VSP tels quels :
//   • ListeSalaries_*.xlsx       → comptes et profils (identité, adresse, naissance, n° de sécurité sociale…)
//   • ListeAffaires_*.xlsx       → missions (client, TJ, dates, n° de contrat)
//   • ProductionMensuelle_*.xlsx → comptes d'activité mensuels (jours, CA)
//   • bulletins et contrats PDF, seuls ou en .zip (noms VSP « NOM_Prénom_… ») → documents de l'espace
// Tout est analysé dans le navigateur, montré en aperçu, puis importé. Aucun e-mail n'est envoyé :
// les invitations partent ensuite, quand l'administrateur le décide.
(function () {
  'use strict';
  var E = window.ESPACE;
  var zone = document.getElementById('migration');
  if (!E || !zone) return;
  var db = E.db, esc = E.esc;

  var LIBS = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    zip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  };
  var charges = {};
  function charger(url) {
    if (!charges[url]) charges[url] = new Promise(function (ok, ko) {
      var s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = function () { ko(new Error('Bibliothèque indisponible : ' + url)); };
      document.head.appendChild(s);
    });
    return charges[url];
  }

  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  // Clé de rapprochement : « NOM Prénom » sans accents, casse ni ponctuation
  function cle(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ''); }
  function txt(v) { return v == null ? '' : String(v).trim().replace(/\s+/g, ' '); }
  // Dates Excel lues en numéro de série (sans fuseau horaire : pas de décalage d'un jour)
  function iso(v) {
    if (!v) return '';
    if (typeof v === 'number' && window.XLSX) { var c = window.XLSX.SSF.parse_date_code(v); return c ? c.y + '-' + ('0' + c.m).slice(-2) + '-' + ('0' + c.d).slice(-2) : ''; }
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
    var m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v)); if (m) return m[3] + '-' + m[2] + '-' + m[1];
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m ? m[0] : '';
  }
  function frDate(isoD) { return isoD ? isoD.split('-').reverse().join('/') : ''; }
  function nombre(v) { if (typeof v === 'number') return v; var n = Number(String(v || '').replace(/[\s  €]/g, '').replace(',', '.')); return isNaN(n) ? null : n; }
  function arrondi(n) { return Math.round(n * 100) / 100; }
  function aujourdhui() { return iso(new Date()); }

  // ---------------------------------------------------------------------
  // Lecture des fichiers
  // ---------------------------------------------------------------------
  var etat = { salaries: [], affaires: [], production: [], pdfs: [], fichiers: [], hash: {} };

  async function sha(buf) {
    var h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function lireXlsx(nom, buf) {
    await charger(LIBS.xlsx);
    var wb = window.XLSX.read(buf, { type: 'array' });
    var lignes = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
    var h = Object.keys(lignes[0] || {});
    if (h.indexOf('Numéro de sécurité sociale') >= 0 || h.indexOf("Nom d'usage") >= 0) { etat.salaries = lignes; return 'Liste des salariés : ' + lignes.length + ' ligne(s)'; }
    if (h.indexOf('Num. contrat') >= 0 && h.indexOf('Collaborateur(s)') >= 0) { etat.affaires = lignes; return 'Liste des affaires : ' + lignes.length + ' ligne(s)'; }
    if (h.indexOf('Mois/Année') >= 0 && h.indexOf('Collaborateur') >= 0) { etat.production = lignes; return 'Production mensuelle : ' + lignes.length + ' ligne(s)'; }
    return 'non reconnu (colonnes inattendues)';
  }
  function typePdf(nom) {
    if (/\bcdi\b/i.test(nom)) return 'cdi';
    if (/annexe/i.test(nom)) return 'annexe';
    if (/avenant/i.test(nom)) return 'avenant';
    if (/(^|[^a-z])bp([^a-z]|$)|bulletin|payslip/i.test(nom)) return 'bulletin';
    if (/attestation/i.test(nom)) return 'attestation';
    return 'autre';
  }
  // Mois et net payé lus dans le bulletin (le nom du fichier sert de secours)
  async function lireBulletin(buf, nom) {
    var info = { mois: null, net: null };
    try {
      await charger(LIBS.pdf);
      var lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
      var doc = await lib.getDocument({ data: buf.slice(0) }).promise;
      var page = await doc.getPage(1), c = await page.getTextContent();
      var t = c.items.map(function (i) { return i.str; }).join(' ');
      var n = /Net pay[ée]\s*:?\s*([\d\s  .,]+)\s*(?:€|euros?)/i.exec(t);
      if (n) info.net = nombre(n[1].replace(/\s/g, ''));
      // Fin de période : la date la plus récente qui tombe un dernier jour de mois
      var fins = (t.match(/\b\d{2}\/\d{2}\/20\d{2}\b/g) || []).map(iso).filter(function (d) {
        var x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + 1); return x.getDate() === 1;
      }).sort();
      if (fins.length) info.mois = fins[fins.length - 1].slice(0, 7) + '-01';
    } catch (e) { /* lecture impossible : on se rabat sur le nom du fichier */ }
    if (!info.mois) { var m = /(\d{2})[._-](20\d{2})/.exec(nom); if (m) info.mois = m[2] + '-' + m[1] + '-01'; }
    return info;
  }
  async function ajouterPdf(nom, buf) {
    var h = await sha(buf);
    if (etat.hash[h]) return 'doublon de « ' + etat.hash[h] + ' » : ignoré';
    etat.hash[h] = nom;
    var court = nom.split('/').pop();
    var parts = court.split('_');
    var p = { nom: court, buf: buf, hash: h, type: typePdf(court), cle: parts.length > 2 ? cle(parts[0] + ' ' + parts[1]) : '' };
    if (p.type === 'bulletin') Object.assign(p, await lireBulletin(buf, court));
    etat.pdfs.push(p);
    return p.type === 'bulletin' ? 'bulletin' + (p.mois ? ' de ' + MOIS[Number(p.mois.slice(5, 7)) - 1] + ' ' + p.mois.slice(0, 4) : ' (mois non trouvé)') : (p.type === 'autre' ? 'document' : p.type.toUpperCase());
  }
  async function lireFichier(f) {
    var buf = await f.arrayBuffer(), nom = f.name;
    if (/\.xlsx?$/i.test(nom)) return [[nom, await lireXlsx(nom, buf)]];
    if (/\.pdf$/i.test(nom)) return [[nom, await ajouterPdf(nom, buf)]];
    if (/\.zip$/i.test(nom)) {
      await charger(LIBS.zip);
      var z = await window.JSZip.loadAsync(buf), res = [];
      var noms = Object.keys(z.files).filter(function (n) { return /\.pdf$/i.test(n) && !z.files[n].dir && !/__MACOSX/.test(n); });
      for (var i = 0; i < noms.length; i++) res.push([noms[i].split('/').pop(), await ajouterPdf(noms[i], await z.files[noms[i]].async('arraybuffer'))]);
      return res.length ? res : [[nom, 'archive sans PDF']];
    }
    return [[nom, 'format non pris en charge']];
  }

  // ---------------------------------------------------------------------
  // Rapprochement : un dossier par salarié
  // ---------------------------------------------------------------------
  function dates(texte) { return (String(texte || '').match(/\d{2}\/\d{2}\/\d{4}/g) || []).map(iso); }
  function intitule(objet) {
    var s = txt(objet).replace(/\s*_\s*/g, ' – ').replace(/[\s–-]+$/, '');
    return s.length >= 2 ? s.slice(0, 300) : 'Assistance technique';
  }
  function missionDepuis(a, prod) {
    var regie = txt(a['Régie mono-intervenant (Dates et PV par volet)']) || txt(a['Volet(s)']);
    var d = dates(regie); if (!d.length) d = dates(a['Titre 1ier volet']);
    var debut = d[0] || iso(a['Date de début saisie']) || iso(a.Date);
    var fin = iso(a['Date de fin courante']) || d[1] || '';
    var pv = /\[([\d\s.,]+)\s*EUR HT\/j\]/i.exec(regie), tjm = pv ? nombre(pv[1].replace(/\s/g, '')) : null;
    if (!tjm) {
      var l = prod.filter(function (x) { return x['Réf. affaire'] === a['Num. contrat'] || x['Réf. affaire'] === a['Référence']; }).sort(function (x, y) { return String(y['Mois/Année']).localeCompare(String(x['Mois/Année'])); })[0];
      if (l) tjm = nombre(l['PV/j']);
    }
    if (tjm != null && (tjm < 100 || tjm > 5000)) tjm = null;
    if (fin && debut && fin < debut) fin = '';
    return {
      intitule: intitule(a.Objet), client: txt(a.Client).slice(0, 200) || null, client_final: txt(a['Client final']).slice(0, 200) || null,
      date_debut: debut || null, date_fin: fin || null, tjm: tjm,
      statut: fin && fin < aujourdhui() ? 'terminee' : 'active',
      numero_contrat: txt(a['Num. contrat']).slice(0, 50) || null, vsp_id: txt(a['Référence']).slice(0, 100) || null,
      competences: txt(a['Compétence(s)']).slice(0, 500) || null,
      interlocuteur_nom: txt(a["Donneur d'ordre"]).slice(0, 200) || null,
      interlocuteur_email: txt(a["Donneur d'ordre : e-mail"]).slice(0, 254) || null,
      interlocuteur_tel: (txt(a["Donneur d'ordre : mobile"]) || txt(a["Donneur d'ordre : tél"])).slice(0, 40) || null,
      htp_interlocuteur_nom: txt(a.Commercial).slice(0, 200) || null
    };
  }
  function dossiers(adminsEmails) {
    var prod = etat.production;
    return etat.salaries.filter(function (s) { return txt(s["Nom d'usage"]) || txt(s['Prénom']); }).map(function (s) {
      var nom = txt(s["Nom d'usage"]) || txt(s['Nom de naissance']), prenomComplet = txt(s['Prénom']);
      var k = cle(nom + ' ' + prenomComplet);
      var perso = txt(s['Email personnel']).toLowerCase(), pro = txt(s['Email professionnel']).toLowerCase();
      var paysNaiss = txt(s['Pays de naissance']), lieu = txt(s['Lieu de naissance']);
      var d = {
        cle: k, inclus: true, alertes: [],
        prenom: prenomComplet.split(',')[0].trim(), nom: nom,
        emails: [perso, pro].filter(function (e, i, t) { return EMAIL_RE.test(e) && t.indexOf(e) === i; }),
        profil: {
          civilite: /^h/i.test(txt(s.Genre)) ? 'M.' : /^f/i.test(txt(s.Genre)) ? 'Mme' : null,
          telephone: txt(s['Téléphone mobile personnel']) || txt(s['Téléphone mobile professionnel']) || txt(s['Téléphone fixe personnel']) || null,
          vsp_id: txt(s['Id utilisateur (technique)']) || txt(s.Matricule) || null,
          date_naissance: iso(s['Date de naissance']) || null,
          lieu_naissance: lieu ? (paysNaiss && !/^france$/i.test(paysNaiss) ? lieu + ' (' + paysNaiss + ')' : lieu) : null,
          nationalite: txt(s['Nationalité']) || null,
          num_secu: txt(s['Numéro de sécurité sociale']).replace(/\s/g, '') || null,
          adresse: txt(s['Adresse - N. et rue']) || null, code_postal: txt(s['Adresse - Code postal']) || null,
          ville: txt(s['Adresse - Ville']) || null, pays: txt(s['Adresse - Pays']) || 'France',
          competences: txt(s['Intitulé du poste']) || txt(s['Fonction (utilisateur)']) || null
        },
        dateSortie: iso(s['Date de sortie'])
      };
      d.email = d.emails[0] || '';
      // Contrôles et signalements
      if (!d.email) { d.alertes.push('aucune adresse e-mail'); d.inclus = false; }
      if (d.emails.some(function (e) { return adminsEmails.indexOf(e) >= 0; }) || d.emails.some(function (e) { return /@htportage\.fr$/.test(e); })) { d.alertes.push('compte administrateur HT Portage'); d.inclus = false; }
      if (d.dateSortie && d.dateSortie <= aujourdhui()) { d.alertes.push('sorti le ' + frDate(d.dateSortie)); d.inclus = false; }
      if (d.prenom && d.prenom === d.prenom.toUpperCase() && d.nom && d.nom !== d.nom.toUpperCase()) d.alertes.push('nom et prénom peut-être inversés : vérifiez');
      if (d.profil.num_secu && !/^[12][0-9]{4}(2A|2B|[0-9]{2})[0-9]{6}([0-9]{2})?$/.test(d.profil.num_secu)) d.alertes.push('n° de sécurité sociale au format inattendu : non repris');
      // Missions
      d.missions = etat.affaires.filter(function (a) { var c = cle(a['Collaborateur(s)']); return c === k || (c.indexOf(k) >= 0 && k.length > 5); })
        .map(function (a) { return missionDepuis(a, prod); });
      // Comptes d'activité (jours et CA par mois, toutes missions confondues)
      var parMois = {};
      prod.filter(function (x) { return cle(txt(x.Nom) + ' ' + txt(x['Prénom'])) === k || cle(x.Collaborateur) === k; }).forEach(function (x) {
        var m = String(x['Mois/Année'] || ''); if (!/^\d{6}$/.test(m)) return;
        var mo = m.slice(0, 4) + '-' + m.slice(4) + '-01';
        parMois[mo] = parMois[mo] || { mois: mo, jours: 0, ca_ht: 0 };
        parMois[mo].jours += nombre(x['Nb de jours']) || 0; parMois[mo].ca_ht += nombre(x['Total HT']) || 0;
      });
      // Documents PDF
      d.pdfs = etat.pdfs.filter(function (p) { return p.cle && (p.cle === k || (k.indexOf(p.cle) === 0 && p.cle.length > 5)); });
      d.pdfs.forEach(function (p) { p.rattache = true; });
      // Un seul bulletin par mois (le plus récent dans la liste des fichiers déposés)
      var vus = {};
      d.bulletins = d.pdfs.filter(function (p) { return p.type === 'bulletin' && p.mois; }).reverse().filter(function (p) { if (vus[p.mois]) return false; vus[p.mois] = 1; return true; }).reverse();
      d.autresPdfs = d.pdfs.filter(function (p) { return p.type !== 'bulletin' || !p.mois; });
      d.bulletins.forEach(function (b) { if (b.net != null) { parMois[b.mois] = parMois[b.mois] || { mois: b.mois, jours: null, ca_ht: null }; parMois[b.mois].net_verse = b.net; } });
      var moisCourant = aujourdhui().slice(0, 7) + '-01';
      d.comptes = Object.keys(parMois).sort().map(function (m) {
        var c = parMois[m];
        return { mois: m, jours: c.jours != null ? arrondi(c.jours) : null, ca_ht: c.ca_ht != null ? arrondi(c.ca_ht) : null,
          frais_gestion: c.ca_ht != null ? arrondi(c.ca_ht * 0.05) : null, net_verse: c.net_verse != null ? c.net_verse : null,
          statut: m < moisCourant && c.net_verse != null ? 'definitif' : 'provisoire', source: 'vsp' };
      });
      return d;
    });
  }

  // ---------------------------------------------------------------------
  // Interface
  // ---------------------------------------------------------------------
  var depot = document.getElementById('migration-fichiers'), journal = document.getElementById('migration-journal');
  var apercu = document.getElementById('migration-apercu'), statut = document.getElementById('migration-statut');
  var btnImporter = document.getElementById('migration-importer'), btnInviter = document.getElementById('migration-inviter');
  var btnVider = document.getElementById('migration-vider');
  var liste = [], importes = [];

  async function adminsEmails() {
    var r = await db.rpc('ids_admins'), ids = (r.data || []).map(function (x) { return typeof x === 'string' ? x : (x && x.ids_admins) || x; });
    if (E.state && E.state.user) ids.push(E.state.user.id);
    if (!ids.length) return [];
    var p = await db.from('profils').select('id, email').in('id', ids);
    return (p.data || []).map(function (x) { return (x.email || '').toLowerCase(); });
  }

  depot.addEventListener('change', async function () {
    var fichiers = Array.from(depot.files || []);
    if (!fichiers.length) return;
    E.setStatus(statut, 'Lecture de ' + fichiers.length + ' fichier(s)…');
    for (var i = 0; i < fichiers.length; i++) {
      try { (await lireFichier(fichiers[i])).forEach(function (l) { etat.fichiers.push(l); }); }
      catch (e) { etat.fichiers.push([fichiers[i].name, 'illisible : ' + e.message]); }
    }
    depot.value = '';
    await analyser();
  });
  btnVider.addEventListener('click', function () {
    etat = { salaries: [], affaires: [], production: [], pdfs: [], fichiers: [], hash: {} };
    liste = []; importes = []; apercu.innerHTML = ''; journal.innerHTML = ''; journal.hidden = true;
    btnImporter.hidden = true; btnInviter.hidden = true; btnVider.hidden = true; E.setStatus(statut, '');
  });

  async function analyser() {
    btnVider.hidden = false;
    journal.hidden = false;
    journal.innerHTML = '<details><summary>' + etat.fichiers.length + ' fichier(s) lu(s)</summary><ul>' + etat.fichiers.map(function (f) { return '<li><strong>' + esc(f[0]) + '</strong> : ' + esc(f[1]) + '</li>'; }).join('') + '</ul></details>';
    if (!etat.salaries.length) { E.setStatus(statut, 'Ajoutez la liste des salariés (ListeSalaries….xlsx) : elle sert de base à la migration.', 'error'); apercu.innerHTML = ''; btnImporter.hidden = true; return; }
    etat.pdfs.forEach(function (p) { p.rattache = false; });
    liste = dossiers(await adminsEmails());
    var orphelins = etat.pdfs.filter(function (p) { return !p.rattache; });
    var manque = [];
    if (!etat.affaires.length) manque.push('la liste des affaires (missions)');
    if (!etat.production.length) manque.push('la production mensuelle (comptes d\'activité)');
    if (!etat.pdfs.length) manque.push('les bulletins et contrats PDF');
    rendre(orphelins, manque);
  }

  function rendre(orphelins, manque) {
    var n = liste.filter(function (d) { return d.inclus; }).length;
    E.setStatus(statut, n + ' salarié(s) prêt(s) à importer. Vérifiez l\'aperçu : rien n\'est enregistré et aucun e-mail n\'est envoyé avant « Importer ».', 'ok');
    btnImporter.hidden = !n; btnImporter.textContent = 'Importer ' + n + ' salarié' + (n > 1 ? 's' : '');
    apercu.innerHTML =
      (manque.length ? '<div class="alerte alerte--info" style="margin-top:12px"><span>Vous pouvez encore ajouter : ' + esc(E.listeFr(manque)) + '.</span></div>' : '') +
      (orphelins.length ? '<div class="alerte alerte--manque" style="margin-top:12px"><strong>' + orphelins.length + ' PDF non rattaché(s)</strong><span>Le nom du fichier doit commencer par « NOM_Prénom_ » comme dans les exports VSP. Ils ne seront pas importés.</span><ul>' + orphelins.map(function (p) { return '<li>' + esc(p.nom) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="table-wrap" style="margin-top:12px"><table class="table" style="min-width:980px"><thead><tr><th scope="col">Importer</th><th scope="col">Prénom</th><th scope="col">Nom</th><th scope="col">E-mail de connexion</th><th scope="col">Profil</th><th scope="col">Missions</th><th scope="col">Activité</th><th scope="col">Documents</th></tr></thead><tbody>' +
      liste.map(function (d, i) {
        var p = d.profil, champs = [p.civilite, p.date_naissance, p.lieu_naissance, p.nationalite, p.num_secu, p.adresse, p.telephone].filter(Boolean).length;
        return '<tr data-i="' + i + '"' + (d.inclus ? '' : ' style="opacity:.6"') + '>' +
          '<td><input type="checkbox" data-champ="inclus" aria-label="Importer ' + esc(d.prenom + ' ' + d.nom) + '"' + (d.inclus ? ' checked' : '') + (d.email ? '' : ' disabled') + '></td>' +
          '<td><input class="input" data-champ="prenom" value="' + esc(d.prenom) + '" maxlength="100" style="width:140px;min-height:38px;font-size:14px" aria-label="Prénom"></td>' +
          '<td><input class="input" data-champ="nom" value="' + esc(d.nom) + '" maxlength="100" style="width:140px;min-height:38px;font-size:14px" aria-label="Nom"></td>' +
          '<td>' + (d.emails.length > 1 ? '<select class="select" data-champ="email" style="min-height:38px;font-size:14px" aria-label="E-mail de connexion">' + d.emails.map(function (e) { return '<option' + (e === d.email ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') + '</select>' : esc(d.email || '—')) +
            (d.alertes.length ? '<br><span class="tag tag--manque" style="margin-top:4px;white-space:normal">' + esc(d.alertes.join(' · ')) + '</span>' : '') + '</td>' +
          '<td class="small">' + champs + '/7 infos' + (p.num_secu ? '' : '<br>sans n° sécu') + '<br>sans IBAN</td>' +
          '<td class="small">' + (d.missions.length ? d.missions.map(function (m) { return esc((m.client || '?') + (m.tjm ? ' · ' + m.tjm + ' €/j' : '') + (m.statut === 'terminee' ? ' · terminée' : '')); }).join('<br>') : '—') + '</td>' +
          '<td class="small">' + (d.comptes.length ? d.comptes.length + ' mois<br>' + esc(frDate(d.comptes[0].mois).slice(3)) + ' → ' + esc(frDate(d.comptes[d.comptes.length - 1].mois).slice(3)) : '—') + '</td>' +
          '<td class="small">' + d.bulletins.length + ' bulletin(s)' + (d.autresPdfs.length ? '<br>' + d.autresPdfs.length + ' autre(s) document(s)' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="small" style="font-size:13px;margin-top:8px">Les IBAN ne figurent pas dans les exports VSP : les consultants les ajouteront dans « Mes informations » (facultatif). Une information déjà saisie dans l\'espace n\'est jamais écrasée.</p>';
  }
  apercu.addEventListener('change', function (e) {
    var tr = e.target.closest('[data-i]'); if (!tr) return;
    var d = liste[Number(tr.dataset.i)], c = e.target.dataset.champ;
    if (c === 'inclus') { d.inclus = e.target.checked; tr.style.opacity = d.inclus ? '' : '.6'; var n = liste.filter(function (x) { return x.inclus; }).length; btnImporter.hidden = !n; btnImporter.textContent = 'Importer ' + n + ' salarié' + (n > 1 ? 's' : ''); }
    else if (c === 'email') d.email = e.target.value;
    else if (c) d[c] = e.target.value.trim();
  });

  // ---------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------
  function titreBulletin(mois) { return 'Bulletin de paie · ' + MOIS[Number(mois.slice(5, 7)) - 1] + ' ' + mois.slice(0, 4); }
  var TITRES = { cdi: 'CDI de portage salarial', annexe: 'Annexe de mission', avenant: 'Avenant', attestation: 'Attestation', autre: 'Document', bulletin: 'Bulletin de paie' };
  function nomFichier(n) { return n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80); }

  async function importerUn(d, log) {
    var r = await db.functions.invoke('consultants', { body: { action: 'creer', consultants: [Object.assign({ prenom: d.prenom, nom: d.nom, email: d.email }, d.profil)] } });
    var res = r.data;
    if (r.error) { try { res = await r.error.context.json(); } catch (e) { res = null; } }
    var x = res && res.resultats && res.resultats[0];
    if (!x || !x.ok) throw new Error((x && x.erreur) || (res && res.erreur) || 'création du compte impossible');
    var uid = x.id, bilan = [x.cree ? 'compte créé' : 'compte existant complété'];

    // Missions (une mission déjà présente avec le même n° de contrat est mise à jour, pas dupliquée)
    var ex = await db.from('consultant_missions').select('id, numero_contrat, vsp_id').eq('user_id', uid);
    var existantes = ex.data || [], ids = {};
    for (var i = 0; i < d.missions.length; i++) {
      var m = Object.assign({ user_id: uid, frais_gestion: 5 }, d.missions[i]);
      var deja = existantes.find(function (e) { return (m.numero_contrat && e.numero_contrat === m.numero_contrat) || (m.vsp_id && e.vsp_id === m.vsp_id); });
      var q = deja ? await db.from('consultant_missions').update(m).eq('id', deja.id).select('id') : await db.from('consultant_missions').insert(m).select('id');
      if (q.error) throw new Error('mission ' + (m.numero_contrat || m.client) + ' : ' + E.errText(q.error));
      ids[m.numero_contrat || i] = q.data[0].id;
    }
    if (d.missions.length) bilan.push(d.missions.length + ' mission(s)');

    // Comptes d'activité
    if (d.comptes.length) {
      var lignes = d.comptes.map(function (c) { var o = Object.assign({ user_id: uid }, c); Object.keys(o).forEach(function (k) { if (o[k] === null) delete o[k]; }); return o; });
      var ca = await db.from('comptes_activite').upsert(lignes, { onConflict: 'user_id,mois' });
      if (ca.error) throw new Error('comptes d\'activité : ' + E.errText(ca.error));
      bilan.push(d.comptes.length + ' mois d\'activité');
    }

    // Documents (bulletins rattachés au mois ; un document déjà déposé avec le même titre est ignoré)
    var docs = (await db.from('documents').select('titre, type').eq('user_id', uid)).data || [];
    var aDeposer = d.bulletins.concat(d.autresPdfs), deposes = 0;
    var missionEnCours = d.missions.filter(function (m) { return m.statut === 'active'; })[0] || d.missions[0];
    for (var j = 0; j < aDeposer.length; j++) {
      var p = aDeposer[j];
      var titre = p.type === 'bulletin' && p.mois ? titreBulletin(p.mois) : (TITRES[p.type] + ' · ' + p.nom.replace(/\.pdf$/i, '').split('_').slice(2).join(' ')).slice(0, 200);
      if (docs.some(function (x) { return x.titre === titre; })) continue;
      var chemin = uid + '/vsp-' + p.hash.slice(0, 10) + '-' + nomFichier(p.nom);
      var up = await db.storage.from('documents').upload(chemin, new Blob([p.buf], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
      if (up.error) throw new Error(p.nom + ' : ' + E.errText(up.error));
      var ins = await db.from('documents').insert({
        user_id: uid, type: p.type, titre: titre, statut: ['cdi', 'annexe', 'avenant'].indexOf(p.type) >= 0 ? 'signe' : 'disponible',
        date_document: p.mois || null, storage_path: chemin,
        mission_id: ['annexe', 'avenant'].indexOf(p.type) >= 0 && missionEnCours ? (ids[missionEnCours.numero_contrat] || null) : null
      });
      if (ins.error) throw new Error(p.nom + ' : ' + E.errText(ins.error));
      deposes++;
    }
    if (deposes) bilan.push(deposes + ' document(s)');
    log(d, true, bilan.join(' · '));
    return uid;
  }

  btnImporter.addEventListener('click', async function () {
    var choix = liste.filter(function (d) { return d.inclus; });
    var sansMail = choix.filter(function (d) { return !EMAIL_RE.test(d.email || ''); });
    if (sansMail.length) { E.setStatus(statut, 'Adresse e-mail manquante pour ' + sansMail.map(function (d) { return d.prenom + ' ' + d.nom; }).join(', ') + '.', 'error'); return; }
    if (!confirm('Importer ' + choix.length + ' salarié(s) dans l\'espace HT Portage ?\n\nLes comptes, profils, missions, comptes d\'activité et documents seront créés. Aucun e-mail ne sera envoyé.')) return;
    btnImporter.disabled = true; btnVider.disabled = true; importes = [];
    var lignes = [];
    function log(d, ok, msg) { lignes.push('<li>' + (ok ? '✅' : '⚠️') + ' <strong>' + esc(d.prenom + ' ' + d.nom) + '</strong> : ' + esc(msg) + '</li>'); journal.innerHTML = '<strong>Import</strong><ul>' + lignes.join('') + '</ul>'; }
    for (var i = 0; i < choix.length; i++) {
      E.setStatus(statut, 'Import ' + (i + 1) + '/' + choix.length + ' : ' + choix[i].prenom + ' ' + choix[i].nom + '…');
      try { importes.push({ id: await importerUn(choix[i], log), d: choix[i] }); }
      catch (e) { log(choix[i], false, e.message); }
    }
    btnImporter.disabled = false; btnVider.disabled = false; btnImporter.hidden = true;
    var ko = choix.length - importes.length;
    E.setStatus(statut, importes.length + ' salarié(s) importé(s)' + (ko ? ', ' + ko + ' en erreur (détail ci-dessous ; vous pouvez relancer l\'import, sans doublon)' : '') + '. Aucun e-mail n\'a été envoyé.', ko ? 'error' : 'ok');
    btnInviter.hidden = !importes.length;
    btnInviter.textContent = 'Inviter les ' + importes.length + ' consultant(s) importé(s)';
    if (window.HTP_ADMIN && window.HTP_ADMIN.recharger) window.HTP_ADMIN.recharger();
  });

  btnInviter.addEventListener('click', async function () {
    var inv = await db.from('invitations').select('user_id');
    var deja = (inv.data || []).map(function (x) { return x.user_id; });
    var cibles = importes.filter(function (x) { return deja.indexOf(x.id) < 0; });
    if (!cibles.length) { E.setStatus(statut, 'Ils ont tous déjà reçu leur invitation (renvoi possible depuis leur fiche).', 'ok'); return; }
    if (!confirm('Envoyer l\'e-mail « Votre espace consultant HT Portage est prêt » à ' + cibles.length + ' consultant(s) ?\n\n' + cibles.map(function (x) { return '• ' + x.d.prenom + ' ' + x.d.nom + ' (' + x.d.email + ')'; }).join('\n'))) return;
    btnInviter.disabled = true;
    var ok = 0, erreurs = [];
    for (var i = 0; i < cibles.length; i++) {
      E.setStatus(statut, 'Invitation ' + (i + 1) + '/' + cibles.length + '…');
      var r = await db.functions.invoke('consultants', { body: { action: 'inviter', user_id: cibles[i].id } });
      var d = r.data; if (r.error) { try { d = await r.error.context.json(); } catch (e) { d = null; } }
      if (d && d.ok) ok++; else erreurs.push(cibles[i].d.prenom + ' ' + cibles[i].d.nom + ' : ' + ((d && d.erreur) || 'échec'));
    }
    btnInviter.disabled = false; btnInviter.hidden = !erreurs.length;
    E.setStatus(statut, ok + ' invitation(s) envoyée(s).' + (erreurs.length ? ' Erreurs : ' + erreurs.join(' ; ') : ''), erreurs.length ? 'error' : 'ok');
    if (window.HTP_ADMIN && window.HTP_ADMIN.recharger) window.HTP_ADMIN.recharger();
  });

  // Pour les tests
  window.HTP_MIGRATION = { cle: cle, missionDepuis: missionDepuis, typePdf: typePdf, etat: function () { return etat; }, liste: function () { return liste; } };
})();
