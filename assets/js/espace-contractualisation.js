// Espace consultant — contractualisation : étapes, déclaration de mission, envoi en validation.
(async function () {
  'use strict';
  var E = window.ESPACE, db = E.db, esc = E.esc;
  var st = await E.guard();
  if (!st) return;
  var p = st.profil, uid = st.user.id;

  var CHAMPS = ['intitule', 'competences', 'date_debut', 'date_fin', 'tjm', 'adresse_execution',
    'client', 'client_siret', 'client_adresse', 'client_representant', 'client_representant_qualite', 'client_signataire_email', 'client_final',
    'interlocuteur_nom', 'interlocuteur_tel', 'interlocuteur_email'];
  var OBLIGATOIRES = {
    intitule: 'l’objet de la prestation', competences: 'vos compétences', date_debut: 'la date de début', tjm: 'le taux journalier',
    adresse_execution: 'l’adresse d’exécution', client: 'la société cliente', client_adresse: 'l’adresse du client',
    client_representant: 'le représentant du client', client_signataire_email: 'l’e-mail du signataire côté client',
    interlocuteur_nom: 'l’interlocuteur chez le client', interlocuteur_email: 'l’e-mail de l’interlocuteur'
  };
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  var r = await Promise.all([
    db.from('consultant_missions').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    db.from('simulations').select('tjm').eq('user_id', uid).order('created_at', { ascending: false }).limit(1),
    db.from('documents').select('id, type, statut, mission_id').eq('user_id', uid).in('type', ['cdi', 'annexe'])
  ]);
  var missions = r[0].data || [], sim = (r[1].data || [])[0], contrats = r[2].data || [];
  var aCdi = contrats.some(function (d) { return d.type === 'cdi' && (d.statut === 'signe' || d.statut === 'a_signer'); });
  var manque = E.manquants(p);
  var etape1 = manque.identite.length === 0;
  var etape2 = manque.coordonnees.length === 0;

  var dossier = missions.find(function (m) { return m.statut === 'brouillon' || m.statut === 'a_valider'; }) || null;
  var derniereValidee = missions.find(function (m) { return ['validee', 'active', 'terminee'].indexOf(m.statut) >= 0; }) || null;
  var nouveau = false; // l'utilisateur a demandé à déclarer une nouvelle mission

  function rendre() {
    var enCours = dossier || ((nouveau || !derniereValidee) ? {} : null);
    var renvoye = dossier && dossier.statut === 'brouillon' && dossier.commentaire_admin;
    var etat3 = dossier && dossier.statut === 'a_valider' ? 'done' : (renvoye ? 'missing' : (enCours ? (etape1 && etape2 ? 'current' : 'todo') : 'done'));
    var etat4 = dossier && dossier.statut === 'a_valider' ? 'current' : (!enCours && derniereValidee ? 'done' : 'todo');
    var docsMission = derniereValidee ? contrats.filter(function (d) { return d.mission_id === derniereValidee.id; }) : [];
    var aSigner = docsMission.some(function (d) { return d.statut === 'a_signer'; });
    var signe = docsMission.length > 0 && docsMission.every(function (d) { return d.statut === 'signe'; });
    var etat5 = !enCours && derniereValidee ? (signe ? 'done' : 'current') : 'todo';
    var libelle5 = signe ? 'Signé' : (aSigner ? 'Signature en cours' : (etat5 === 'current' ? 'Contrats en préparation' : 'À venir'));
    var etapes = [
      ['Identité', etape1 ? 'done' : 'missing', etape1 ? 'Complète' : manque.identite.length + ' élément' + (manque.identite.length > 1 ? 's' : '') + ' à compléter', 'informations.html'],
      ['Coordonnées', etape2 ? 'done' : 'missing', etape2 ? 'Complète' : manque.coordonnees.length + ' élément' + (manque.coordonnees.length > 1 ? 's' : '') + ' à compléter', 'informations.html'],
      ['Mission et client', etat3, etat3 === 'done' ? 'Envoyée' : (etat3 === 'missing' ? 'À corriger' : (etat3 === 'todo' ? 'À venir' : 'En cours'))],
      ['Validation HT Portage', etat4, etat4 === 'done' ? 'Validée' : (etat4 === 'current' ? 'En cours' : 'À venir')],
      ['Signature en ligne', etat5, libelle5]
    ];
    document.getElementById('etapes').innerHTML = etapes.map(function (e, i) {
      var tagOuvrant = e[3] && e[1] === 'missing' ? '<li><a class="etape is-' + e[1] + '" href="' + e[3] + '">' : '<li class="etape is-' + e[1] + '"' + (e[1] === 'current' ? ' aria-current="step"' : '') + '>';
      var tagFermant = e[3] && e[1] === 'missing' ? '</a></li>' : '</li>';
      return tagOuvrant + '<span class="etape__num">' +
        (e[1] === 'done' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : (i + 1)) +
        '</span><span class="etape__txt"><span>Étape ' + (i + 1) + ' · ' + esc(e[2]) + '</span><strong>' + esc(e[0]) + '</strong></span>' + tagFermant;
    }).join('');

    var retour = document.getElementById('retour');
    if (dossier && dossier.statut === 'brouillon' && dossier.commentaire_admin) {
      retour.innerHTML = '<div class="alerte alerte--rose" role="status"><strong>HT Portage vous demande de compléter votre dossier</strong><span>' + esc(dossier.commentaire_admin) + '</span></div>';
      retour.hidden = false;
    } else retour.hidden = true;

    var zone = document.getElementById('zone-mission');
    if (!etape1 || !etape2) {
      var tout = manque.identite.concat(manque.coordonnees);
      zone.innerHTML = '<div class="alerte alerte--manque"><strong>Il manque ' + tout.length + ' information' + (tout.length > 1 ? 's' : '') + ' pour établir votre contrat</strong><span>' + esc(E.cap(E.listeFr(tout))) + '.</span>' +
        '<a class="btn btn--dark btn--sm" href="informations.html" style="align-self:flex-start;margin-top:6px">Compléter mes informations</a></div>' +
        (enCours ? formulaire(enCours) : '');
    } else if (dossier && dossier.statut === 'a_valider') {
      zone.innerHTML = '<div class="alerte alerte--info" role="status"><strong>Dossier envoyé le ' + E.date(dossier.soumise_le || dossier.updated_at) + '</strong><span>HT Portage vérifie vos informations. Vous recevrez ensuite par e-mail votre ' + (aCdi ? 'annexe de mission' : 'CDI et votre annexe de mission') + ' à signer en ligne.</span></div>' + recap(dossier);
    } else if (enCours) {
      zone.innerHTML = formulaire(enCours);
    } else {
      zone.innerHTML = '<div class="alerte alerte--info" role="status"><strong>Votre dernière mission a été validée' + (derniereValidee.validee_le ? ' le ' + E.date(derniereValidee.validee_le) : '') + '</strong>' +
        '<span>' + esc(derniereValidee.intitule) + (derniereValidee.client ? ' · ' + esc(derniereValidee.client) : '') + '. ' + (signe ? 'Vos contrats sont signés : retrouvez-les dans « Contrats et missions ».' : aSigner ? 'Vos contrats vous ont été envoyés par e-mail par Yousign : signez-les depuis le lien reçu (pensez à vérifier vos courriers indésirables).' : 'Vos contrats sont en préparation : vous les recevrez par e-mail pour signature.') + '</span></div>' +
        '<button class="btn btn--ghost-dark btn--sm" type="button" id="btn-nouvelle" style="align-self:flex-start">Déclarer une nouvelle mission</button>';
      document.getElementById('btn-nouvelle').addEventListener('click', function () { nouveau = true; rendre(); });
    }
    if (zone.querySelector('#form-mission')) brancherFormulaire(enCours);
    rendreAside(enCours || dossier || derniereValidee);
  }

  function f(name, label, o) {
    o = o || {};
    var tag = o.textarea ? '<textarea class="textarea" style="min-height:96px"' : '<input class="input" type="' + (o.type || 'text') + '"';
    var attrs = ' id="m-' + name + '" name="' + name + '"' + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.min != null ? ' min="' + o.min + '"' : '') +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + (o.mode ? ' inputmode="' + o.mode + '"' : '') + (o.auto ? ' autocomplete="' + o.auto + '"' : '');
    var requis = OBLIGATOIRES[name] ? '<span class="requis" aria-hidden="true"> *</span><span class="visually-hidden"> (obligatoire)</span>' : '';
    return '<div class="field' + (o.full ? ' full' : '') + '"><label for="m-' + name + '">' + esc(label) + requis + (o.hint ? ' <span class="hint">(' + esc(o.hint) + ')</span>' : '') + '</label>' +
      (o.textarea ? tag + attrs + '></textarea>' : tag + attrs + '>') + '</div>';
  }

  function formulaire(m) {
    return '<form id="form-mission" novalidate style="display:flex;flex-direction:column;gap:16px">' +
      '<p class="legende-requis"><span class="requis">*</span> Obligatoire pour envoyer votre dossier. Vous pouvez enregistrer un brouillon à tout moment.</p>' +
      '<fieldset class="box"><legend>La mission</legend><div class="grid-form">' +
        f('intitule', 'Objet de la prestation', { full: true, textarea: true, max: 300, placeholder: 'Ex. : développement d’une application de gestion des sinistres' }) +
        f('competences', 'Vos compétences', { full: true, max: 500, hint: 'article 3 du CDI', placeholder: 'Ex. : développement full stack .NET' }) +
        f('date_debut', 'Date de début', { type: 'date' }) + f('date_fin', 'Date de fin prévue', { type: 'date', hint: 'facultatif' }) +
        f('tjm', 'Taux journalier (€ HT)', { type: 'number', min: 100, mode: 'numeric' }) +
        f('adresse_execution', 'Adresse d’exécution', { full: true, max: 300, placeholder: 'Adresse du site où vous intervenez' }) +
      '</div></fieldset>' +
      '<fieldset class="box"><legend>Le client</legend><p class="small" style="font-size:14px">La société avec laquelle HT Portage signe le contrat commercial.</p><div class="grid-form">' +
        f('client', 'Société cliente', { max: 200, auto: 'organization' }) + f('client_siret', 'SIRET', { max: 17, mode: 'numeric', hint: 'facultatif' }) +
        f('client_adresse', 'Adresse du siège', { full: true, max: 300 }) +
        f('client_representant', 'Représentant légal ou signataire', { max: 200, placeholder: 'Prénom Nom' }) + f('client_representant_qualite', 'Fonction', { max: 200, placeholder: 'Ex. : Directeur général' }) +
        f('client_signataire_email', 'E-mail du signataire', { full: true, type: 'email', max: 254, hint: 'il recevra l’annexe à signer' }) +
        f('client_final', 'Client final', { full: true, max: 200, hint: 'si vous intervenez chez le client de votre client' }) +
      '</div></fieldset>' +
      '<fieldset class="box"><legend>Votre interlocuteur chez le client</legend><div class="grid-form">' +
        f('interlocuteur_nom', 'Nom et prénom', { max: 200 }) + f('interlocuteur_tel', 'Téléphone', { type: 'tel', max: 40 }) +
        f('interlocuteur_email', 'E-mail', { full: true, type: 'email', max: 254 }) +
      '</div></fieldset>' +
      '<div class="actions-row"><p class="form-status" role="status" aria-live="polite"></p><div style="display:flex;flex-wrap:wrap;gap:10px">' +
        '<button class="btn btn--light" type="button" data-action="enregistrer">Enregistrer le brouillon</button>' +
        '<button class="btn btn--rose" type="submit">Envoyer à HT Portage</button></div></div>' +
      '</form>';
  }

  function brancherFormulaire(m) {
    var form = document.getElementById('form-mission');
    CHAMPS.forEach(function (k) { if (form[k] && m[k] != null) form[k].value = m[k]; });
    if (!m.id) {
      if (!form.tjm.value && sim) form.tjm.value = sim.tjm;
      if (!form.competences.value && p.competences) form.competences.value = p.competences;
    }
    var status = form.querySelector('.form-status');
    form.addEventListener('input', function (e) { e.target.removeAttribute('aria-invalid'); if (e.target.value) e.target.classList.remove('is-manquant'); if (e.target.name === 'tjm') rendreAside(lire()); });

    function lire() {
      var d = {};
      CHAMPS.forEach(function (k) { var v = (form[k].value || '').trim(); d[k] = v === '' ? null : v; });
      if (d.tjm != null) d.tjm = Number(d.tjm);
      if (d.client_siret) d.client_siret = d.client_siret.replace(/\s/g, '');
      ['client_signataire_email', 'interlocuteur_email'].forEach(function (k) { if (d[k]) d[k] = d[k].toLowerCase(); });
      return d;
    }
    function erreur(champ, msg) {
      if (champ && form[champ]) { form[champ].setAttribute('aria-invalid', 'true'); form[champ].focus(); }
      E.setStatus(status, msg, 'error');
      return false;
    }
    function verifier(d, complet) {
      if (!d.intitule) return erreur('intitule', 'Indiquez au moins l’objet de la prestation.');
      if (d.tjm != null && (isNaN(d.tjm) || d.tjm < 100 || d.tjm > 5000)) return erreur('tjm', 'Le taux journalier doit être compris entre 100 et 5 000 € HT.');
      if (d.client_siret && !/^[0-9]{14}$/.test(d.client_siret)) return erreur('client_siret', 'Le SIRET doit comporter 14 chiffres.');
      if (d.date_debut && d.date_fin && d.date_fin < d.date_debut) return erreur('date_fin', 'La date de fin doit être postérieure à la date de début.');
      if (d.client_signataire_email && !EMAIL.test(d.client_signataire_email)) return erreur('client_signataire_email', 'L’e-mail du signataire n’est pas valide.');
      if (d.interlocuteur_email && !EMAIL.test(d.interlocuteur_email)) return erreur('interlocuteur_email', 'L’e-mail de l’interlocuteur n’est pas valide.');
      if (complet) {
        var vides = Object.keys(OBLIGATOIRES).filter(function (k) { return !d[k]; });
        form.querySelectorAll('.is-manquant').forEach(function (el) { el.classList.remove('is-manquant'); });
        if (vides.length) {
          vides.forEach(function (k) { form[k].classList.add('is-manquant'); form[k].setAttribute('aria-invalid', 'true'); });
          form[vides[0]].focus();
          E.setStatus(status, 'Il manque ' + vides.length + ' information' + (vides.length > 1 ? 's' : '') + ' : ' + E.listeFr(vides.map(function (k) { return OBLIGATOIRES[k]; })) + '.', 'error');
          return false;
        }
        if (!etape1 || !etape2) return erreur(null, 'Avant l’envoi, complétez dans « Mes informations » : ' + E.listeFr(manque.identite.concat(manque.coordonnees)) + '.');
      }
      return true;
    }
    async function enregistrer(statut) {
      var d = lire();
      if (!verifier(d, statut === 'a_valider')) return;
      d.statut = statut;
      var boutons = form.querySelectorAll('button');
      boutons.forEach(function (b) { b.disabled = true; });
      E.setStatus(status, statut === 'a_valider' ? 'Envoi…' : 'Enregistrement…');
      var res = m.id ? await db.from('consultant_missions').update(d).eq('id', m.id) : await db.from('consultant_missions').insert(Object.assign({ user_id: uid }, d));
      boutons.forEach(function (b) { b.disabled = false; });
      if (res.error) { E.setStatus(status, E.errText(res.error), 'error'); return; }
      var rl = await db.from('consultant_missions').select('*').eq('user_id', uid).order('created_at', { ascending: false });
      missions = rl.data || [];
      dossier = missions.find(function (x) { return x.statut === 'brouillon' || x.statut === 'a_valider'; }) || null;
      nouveau = false;
      rendre();
      var st2 = document.querySelector('#form-mission .form-status');
      if (statut === 'brouillon' && st2) E.setStatus(st2, 'Brouillon enregistré.', 'ok');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); enregistrer('a_valider'); });
    form.querySelector('[data-action=enregistrer]').addEventListener('click', function () { enregistrer('brouillon'); });
  }

  function recap(m) {
    function l(t, v) { return '<div><dt>' + esc(t) + '</dt><dd>' + (v ? esc(v) : '—') + '</dd></div>'; }
    return '<section class="box" aria-labelledby="t-recap"><h2 class="box__title" id="t-recap">Votre dossier</h2><dl class="recap">' +
      l('Objet', m.intitule) + l('Compétences', m.competences) + l('Période', E.date(m.date_debut) + (m.date_fin ? ' → ' + E.date(m.date_fin) : '')) +
      l('Taux journalier', m.tjm ? E.eur(m.tjm) + ' HT' : '') + l('Adresse d’exécution', m.adresse_execution) +
      l('Client', [m.client, m.client_siret ? 'SIRET ' + m.client_siret : ''].filter(Boolean).join(' · ')) + l('Adresse du client', m.client_adresse) +
      l('Signataire client', [m.client_representant, m.client_representant_qualite, m.client_signataire_email].filter(Boolean).join(' · ')) +
      l('Client final', m.client_final) + l('Interlocuteur', [m.interlocuteur_nom, m.interlocuteur_tel, m.interlocuteur_email].filter(Boolean).join(' · ')) +
      '</dl></section>';
  }

  function rendreAside(m) {
    var tjm = m && m.tjm ? Number(m.tjm) : (sim ? sim.tjm : null);
    var ca = tjm ? tjm * 19 : null;
    var nomClient = (m && m.client) || 'le client';
    document.getElementById('zone-aside').innerHTML =
      '<section class="box box--dark" aria-labelledby="t-est"><h2 class="box__title" id="t-est">Votre estimation</h2>' +
        '<dl class="dl" style="grid-template-columns:1fr;gap:10px">' +
          '<div style="flex-direction:row;justify-content:space-between"><dt style="color:var(--on-dark)">CA mensuel (19 j)</dt><dd>' + (ca ? E.eur(ca) + ' HT' : '—') + '</dd></div>' +
          '<div style="flex-direction:row;justify-content:space-between"><dt style="color:var(--on-dark)">Frais de gestion</dt><dd>5 %</dd></div>' +
          '<div style="flex-direction:row;justify-content:space-between;padding-top:10px;border-top:1px solid var(--navy-500)"><dt style="color:var(--on-dark)">Net estimé / mois</dt><dd style="font-size:20px;color:var(--rose-50)">' + (ca ? E.eur(ca * 0.67) : '—') + '</dd></div>' +
        '</dl><a href="../simulateur.html" style="color:var(--rose-50);font-size:14px;font-weight:600">Refaire une simulation</a></section>' +
      '<section class="box" aria-labelledby="t-docs"><h2 class="box__title" id="t-docs">Documents à signer</h2><ul class="list">' +
        (aCdi ? '' : '<li><span class="list__main"><strong>CDI de portage salarial</strong><span>Votre contrat de travail avec HT Portage</span></span></li>') +
        '<li><span class="list__main"><strong>Annexe 1 · Conditions de la prestation</strong><span>Une par mission</span></span></li></ul>' +
        '<p class="small" style="font-size:14px;font-weight:600;color:var(--ink)">Signataires</p><ul class="signataires">' +
          '<li>Vous : ' + (aCdi ? 'l’annexe' : 'le CDI et l’annexe') + '</li><li>' + esc(nomClient) + ' : l’annexe</li><li>HT Portage : ' + (aCdi ? 'l’annexe' : 'les deux documents') + '</li>' +
        '</ul><p class="small" style="font-size:13px">Signature électronique sécurisée : tout le monde reçoit en même temps un e-mail avec un lien personnel, sans attendre les autres.</p></section>';
  }

  rendre();
})();
