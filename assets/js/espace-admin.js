// Espace HT Portage — administration (réservée aux comptes de la table admins).
(async function () {
  'use strict';
  var E = window.ESPACE, db = E.db, esc = E.esc;
  var st = await E.guard({ admin: true });
  if (!st) return;

  var profils = [];
  var STATUTS_PROFIL = [['candidat', 'Candidat'], ['consultant', 'Consultant'], ['sorti', 'Sorti']];
  var STATUTS_MISSION = [['brouillon', 'Brouillon'], ['a_valider', 'À valider'], ['validee', 'Validée'], ['active', 'Active'], ['terminee', 'Terminée'], ['annulee', 'Annulée']];

  function options(liste, val) {
    return liste.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  }
  function nomDe(p) { return [p.prenom, p.nom].filter(Boolean).join(' ') || p.email; }

  // =====================================================================
  // Consultants
  // =====================================================================
  var listeEl = document.getElementById('liste-consultants');
  async function chargerProfils() {
    var r = await db.from('profils').select('*').order('created_at', { ascending: false });
    if (r.error) { listeEl.innerHTML = '<p class="form-status is-error">' + esc(E.errText(r.error)) + '</p>'; return; }
    profils = r.data || [];
    afficherProfils();
  }
  function afficherProfils() {
    var q = document.getElementById('recherche').value.trim().toLowerCase();
    var liste = profils.filter(function (p) { return !q || (nomDe(p) + ' ' + p.email).toLowerCase().indexOf(q) >= 0; });
    if (!liste.length) { listeEl.innerHTML = '<div class="empty-state">' + (profils.length ? 'Aucun résultat.' : 'Aucun compte créé pour le moment.') + '</div>'; return; }
    listeEl.innerHTML = '<div class="table-wrap"><table class="table" style="min-width:860px"><thead><tr>' +
      '<th scope="col">Nom</th><th scope="col">E-mail</th><th scope="col">Dossier</th><th scope="col">Statut</th><th scope="col">ID VSP</th><th scope="col">Inscrit le</th><th scope="col"><span class="visually-hidden">Actions</span></th>' +
      '</tr></thead><tbody>' + liste.map(function (p) {
        var mqc = E.manquants(p), complet = !mqc.identite.length && !mqc.coordonnees.length;
        return '<tr data-id="' + p.id + '"><td><strong>' + esc(nomDe(p)) + '</strong></td><td>' + esc(p.email) + '</td>' +
          '<td>' + (complet ? '<span class="tag">Complet</span>' : '<span class="tag tag--rose">Incomplet</span>') + '</td>' +
          '<td><label class="visually-hidden" for="s-' + p.id + '">Statut de ' + esc(nomDe(p)) + '</label><select class="select" id="s-' + p.id + '" data-champ="statut">' + options(STATUTS_PROFIL, p.statut) + '</select></td>' +
          '<td><label class="visually-hidden" for="v-' + p.id + '">ID VSP de ' + esc(nomDe(p)) + '</label><input class="input" id="v-' + p.id + '" data-champ="vsp_id" value="' + esc(p.vsp_id || '') + '" maxlength="100" style="width:120px"></td>' +
          '<td style="white-space:nowrap">' + E.date(p.created_at) + '</td>' +
          '<td><div class="row-actions"><button class="btn btn--light btn--sm" type="button" data-action="enregistrer">Enregistrer</button>' +
          '<button class="btn btn--dark btn--sm" type="button" data-action="fiche">Fiche</button></div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  document.getElementById('recherche').addEventListener('input', afficherProfils);
  listeEl.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-action]');
    if (!b) return;
    var tr = b.closest('tr'), id = tr.dataset.id;
    var p = profils.find(function (x) { return x.id === id; });
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
  // Fiche consultant (missions et documents)
  // =====================================================================
  var fiche = document.getElementById('fiche'), courant = null;
  fiche.querySelector('[data-fermer]').addEventListener('click', function () { fiche.close(); });

  async function ouvrirFiche(p) {
    courant = p;
    document.getElementById('fiche-titre').textContent = nomDe(p);
    document.getElementById('fiche-sous').textContent = p.email + (p.telephone ? ' · ' + p.telephone : '') + (p.competences ? ' · ' + p.competences : '');
    fiche.querySelectorAll('form').forEach(function (f) { f.reset(); E.setStatus(f.querySelector('.form-status'), ''); });
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
    chargerValider();
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
  // Missions à valider
  // =====================================================================
  var valEl = document.getElementById('liste-valider');
  var dossiers = [];
  async function prochainNumero() {
    var an = new Date().getFullYear();
    var r = await db.from('consultant_missions').select('numero_contrat').in('statut', ['validee', 'active', 'terminee']);
    var max = 0;
    (r.data || []).forEach(function (x) { var m = new RegExp('^HTP-' + an + '-(\\d+)$').exec(x.numero_contrat || ''); if (m) max = Math.max(max, Number(m[1])); });
    return 'HTP-' + an + '-' + ('00' + (max + 1)).slice(-3);
  }
  async function chargerValider() {
    var r = await db.from('consultant_missions').select('*').eq('statut', 'a_valider').order('soumise_le', { ascending: true });
    dossiers = r.data || [];
    if (!dossiers.length) { valEl.innerHTML = '<p class="small" style="font-size:15px">Aucun dossier en attente de validation.</p>'; return; }
    var numero = await prochainNumero();
    var moi = st.profil;
    function l(t, v) { return '<div><dt>' + esc(t) + '</dt><dd>' + (v ? esc(v) : '—') + '</dd></div>'; }
    valEl.innerHTML = dossiers.map(function (m, i) {
      var p = profils.find(function (x) { return x.id === m.user_id; }) || { email: '?' };
      var mq = E.manquants(p), manq = mq.identite.concat(mq.coordonnees), complet = manq.length === 0;
      var id = m.id;
      return '<article class="box" data-id="' + id + '" style="background:var(--bg);border:0">' +
        '<div class="box__head"><h3 class="box__title">' + esc(nomDe(p)) + ' · ' + esc(m.client || 'Client ?') + '</h3>' +
        '<span class="small">Envoyé le ' + E.date(m.soumise_le || m.updated_at) + '</span></div>' +
        (complet ? '' : '<div class="alerte alerte--manque"><strong>Informations personnelles incomplètes</strong><span>Manque : ' + esc(E.listeFr(manq)) + '. Renvoyez le dossier au consultant.</span></div>') +
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
          '<div class="field"><label for="n-' + id + '">N° du contrat commercial</label><input class="input" id="n-' + id + '" name="numero_contrat" maxlength="50" value="' + esc(m.numero_contrat || numero) + '"></div>' +
          '<div class="field"><label for="f-' + id + '">Frais de gestion</label><input class="input" id="f-' + id + '" value="5 %" readonly></div>' +
          '<div class="field"><label for="hn-' + id + '">Interlocuteur HT Portage</label><input class="input" id="hn-' + id + '" name="htp_interlocuteur_nom" maxlength="200" value="' + esc(m.htp_interlocuteur_nom || nomDe(moi)) + '"></div>' +
          '<div class="field"><label for="ht-' + id + '">Téléphone</label><input class="input" id="ht-' + id + '" name="htp_interlocuteur_tel" maxlength="40" value="' + esc(m.htp_interlocuteur_tel || moi.telephone || '') + '"></div>' +
          '<div class="field full"><label for="he-' + id + '">E-mail</label><input class="input" id="he-' + id + '" name="htp_interlocuteur_email" type="email" maxlength="254" value="' + esc(m.htp_interlocuteur_email || st.user.email) + '"></div>' +
          '<div class="field full"><label for="c-' + id + '">Message au consultant <span class="hint">(obligatoire pour renvoyer le dossier)</span></label><textarea class="textarea" id="c-' + id + '" name="commentaire_admin" maxlength="2000" style="min-height:80px" placeholder="Ex. : merci de préciser l’adresse du client final"></textarea></div>' +
          '<div class="full actions-row"><p class="form-status" role="status" aria-live="polite"></p><div class="row-actions">' +
            '<button class="btn btn--light btn--sm" type="button" data-decision="renvoyer">Renvoyer au consultant</button>' +
            '<button class="btn btn--dark btn--sm" type="button" data-decision="valider">Valider le dossier</button></div></div>' +
        '</form></article>';
    }).join('');
  }
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
    chargerValider();
    chargerSignatures();
  });

  // =====================================================================
  // Contrats et signatures (dossiers validés)
  // =====================================================================
  var signEl = document.getElementById('liste-signatures');
  async function chargerSignatures() {
    var r = await Promise.all([
      db.from('consultant_missions').select('*').in('statut', ['validee', 'active']).order('validee_le', { ascending: false }).limit(30),
      db.from('documents').select('*').in('type', ['cdi', 'annexe']).order('created_at', { ascending: false })
    ]);
    var missions = r[0].data || [], docs = r[1].data || [];
    if (!missions.length) { signEl.innerHTML = '<p class="small" style="font-size:15px">Aucun dossier validé pour le moment.</p>'; return; }
    signEl.innerHTML = missions.map(function (m) {
      var p = profils.find(function (x) { return x.id === m.user_id; }) || { email: '?' };
      var sesDocs = docs.filter(function (d) { return d.mission_id === m.id || (d.type === 'cdi' && d.user_id === m.user_id); });
      var annexe = sesDocs.find(function (d) { return d.type === 'annexe' && d.mission_id === m.id && ['a_signer', 'signe'].indexOf(d.statut) >= 0; });
      var etat = sesDocs.length ? '<ul class="list">' + sesDocs.map(function (d) {
        return '<li><span class="list__main"><strong>' + esc(d.titre) + '</strong><span>' + (d.envoye_le ? 'Envoyé le ' + E.date(d.envoye_le) : E.date(d.created_at)) +
          (d.signe_le ? ' · signé le ' + E.date(d.signe_le) : '') + '</span></span>' + E.tag('document', d.statut) +
          (d.storage_path ? ' <button class="link-btn" type="button" data-doc="' + esc(d.storage_path) + '">PDF</button>' : '') + '</li>';
      }).join('') + '</ul>' : '';
      return '<article class="box" data-mission="' + m.id + '" style="background:var(--bg);border:0;gap:12px">' +
        '<div class="box__head"><h3 class="box__title" style="font-size:16px">' + esc(nomDe(p)) + ' · ' + esc(m.client || '') + ' · ' + esc(m.numero_contrat || '') + '</h3>' + E.tag('mission', m.statut) + '</div>' +
        etat +
        '<div class="actions-row"><p class="form-status" role="status" aria-live="polite"></p><div class="row-actions">' +
          '<button class="btn btn--light btn--sm" type="button" data-contrat="apercu">Aperçu des contrats</button>' +
          (annexe ? '' : '<button class="btn btn--dark btn--sm" type="button" data-contrat="envoyer">Envoyer en signature</button>') +
        '</div></div></article>';
    }).join('');
  }
  function telecharger(nom, base64) {
    var bin = atob(base64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([u], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    var a = document.createElement('a'); a.href = url; a.download = nom; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
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
  E.brancherTelechargements(signEl);
  signEl.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-contrat]');
    if (!b) return;
    var art = b.closest('[data-mission]'), status = art.querySelector('.form-status');
    if (b.dataset.contrat === 'envoyer' && !confirm('Envoyer les contrats en signature ? Le consultant, puis le client, puis vous recevrez un e-mail de Yousign.')) return;
    art.querySelectorAll('[data-contrat]').forEach(function (x) { x.disabled = true; });
    E.setStatus(status, b.dataset.contrat === 'apercu' ? 'Génération des contrats…' : 'Envoi à Yousign…');
    try {
      var data = await appelContrats(art.dataset.mission, b.dataset.contrat);
      if (b.dataset.contrat === 'apercu') {
        (data.fichiers || []).forEach(function (f) { telecharger(f.nom, f.base64); });
        E.setStatus(status, (data.fichiers || []).length + ' document(s) téléchargé(s) pour relecture.', 'ok');
      } else {
        E.setStatus(status, 'Envoyé en signature : ' + (data.envoyes || []).map(function (x) { return x.type === 'cdi' ? 'CDI' : 'annexe'; }).join(' + ') + '.', 'ok');
        setTimeout(chargerSignatures, 800);
      }
    } catch (err) {
      E.setStatus(status, err.message || String(err), 'error');
    } finally {
      art.querySelectorAll('[data-contrat]').forEach(function (x) { x.disabled = false; });
    }
  });

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
    profils.forEach(function (p) { parEmail[(p.email || '').toLowerCase()] = p; if (p.vsp_id) parVsp[p.vsp_id] = p; });
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

  // =====================================================================
  // Demandes reçues
  // =====================================================================
  async function chargerDemandes() {
    var r = await Promise.all([
      db.from('candidatures').select('*').order('created_at', { ascending: false }).limit(30),
      db.from('contacts').select('*').order('created_at', { ascending: false }).limit(30),
      db.from('recommandations').select('*').order('created_at', { ascending: false }).limit(30)
    ]);
    var cands = r[0].data || [], contacts = r[1].data || [], recos = r[2].data || [];
    var STATUTS_CAND = [['nouvelle', 'Nouvelle'], ['en cours', 'En cours'], ['retenue', 'Retenue'], ['archivee', 'Archivée']];
    var STATUTS_RECO = [['nouvelle', 'Nouvelle'], ['en cours', 'En cours'], ['validee', 'Aboutie'], ['prime versee', 'Prime versée'], ['refusee', 'Refusée']];

    document.getElementById('liste-candidatures').innerHTML = cands.length ? '<div class="table-wrap"><table class="table" style="min-width:820px"><thead><tr><th scope="col">Date</th><th scope="col">Candidat</th><th scope="col">Mission</th><th scope="col">TJM</th><th scope="col">CV</th><th scope="col">Statut</th></tr></thead><tbody>' +
      cands.map(function (c) {
        return '<tr data-table="candidatures" data-id="' + c.id + '"><td style="white-space:nowrap">' + E.date(c.created_at) + '</td><td><strong>' + esc(c.nom) + '</strong><br><span class="small">' + esc(c.email) + ' · ' + esc(c.telephone) + '</span></td>' +
          '<td>' + esc(c.mission_ref || 'Spontanée') + '</td><td class="num">' + (c.tjm_souhaite ? E.eur(c.tjm_souhaite) : '—') + '</td>' +
          '<td>' + (c.cv_path ? '<button class="link-btn" type="button" data-doc="' + esc(c.cv_path) + '" data-bucket="cv">CV</button>' : '—') + '</td>' +
          '<td><label class="visually-hidden" for="c-' + c.id + '">Statut</label><select class="select" id="c-' + c.id + '" data-champ="statut">' + options(STATUTS_CAND, c.statut) + '</select></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="small" style="font-size:15px">Aucune candidature.</p>';

    document.getElementById('liste-contacts').innerHTML = contacts.length ? '<div class="table-wrap"><table class="table" style="min-width:820px"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Contact</th><th scope="col">Message</th><th scope="col">Traité</th></tr></thead><tbody>' +
      contacts.map(function (c) {
        var sim = c.type === 'simulation' ? 'TJM ' + E.eur(c.tjm) + ' · ' + c.jours + ' j · net ' + E.eur(c.net_estime) + '. ' : '';
        return '<tr data-table="contacts" data-id="' + c.id + '"><td style="white-space:nowrap">' + E.date(c.created_at) + '</td><td>' + (c.type === 'simulation' ? 'Simulation' : 'Contact') + '</td>' +
          '<td><strong>' + esc(c.nom) + '</strong><br><span class="small">' + esc(c.email) + (c.telephone ? ' · ' + esc(c.telephone) : '') + '</span></td>' +
          '<td style="max-width:360px">' + esc(sim + (c.message || c.situation || '')) + '</td>' +
          '<td><label class="check" style="font-size:14px"><input type="checkbox" data-champ="traite"' + (c.traite ? ' checked' : '') + '>Traité</label></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="small" style="font-size:15px">Aucune demande.</p>';

    document.getElementById('liste-recos').innerHTML = recos.length ? '<div class="table-wrap"><table class="table" style="min-width:820px"><thead><tr><th scope="col">Date</th><th scope="col">Ambassadeur</th><th scope="col">Recommande</th><th scope="col">Statut</th><th scope="col">Prime (€)</th></tr></thead><tbody>' +
      recos.map(function (x) {
        return '<tr data-table="recommandations" data-id="' + x.id + '"><td style="white-space:nowrap">' + E.date(x.created_at) + '</td><td><strong>' + esc(x.ambassadeur_nom) + '</strong><br><span class="small">' + esc(x.ambassadeur_email) + (x.user_id ? ' · compte espace' : '') + '</span></td>' +
          '<td><strong>' + esc(E.LIBELLES.typeReco[x.type] || x.type) + ' · ' + esc(x.contact_nom) + '</strong><br><span class="small">' + esc(x.details) + '</span></td>' +
          '<td><label class="visually-hidden" for="r-' + x.id + '">Statut</label><select class="select" id="r-' + x.id + '" data-champ="statut">' + options(STATUTS_RECO, x.statut) + '</select></td>' +
          '<td><label class="visually-hidden" for="rp-' + x.id + '">Prime</label><input class="input" id="rp-' + x.id + '" data-champ="prime_montant" type="number" min="0" step="1" value="' + (x.prime_montant == null ? '' : esc(x.prime_montant)) + '" style="width:110px"></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="small" style="font-size:15px">Aucune recommandation.</p>';
  }
  var demandes = document.getElementById('demandes');
  E.brancherTelechargements(demandes);
  demandes.addEventListener('change', async function (e) {
    var champ = e.target.dataset.champ, tr = e.target.closest('tr[data-table]');
    if (!champ || !tr) return;
    var val = e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : (e.target.type === 'number' ? Number(e.target.value) : e.target.value));
    var maj = {}; maj[champ] = val;
    var r = await db.from(tr.dataset.table).update(maj).eq('id', tr.dataset.id);
    if (r.error) { alert(E.errText(r.error)); return; }
    e.target.style.outline = '2px solid #2F6B3A';
    setTimeout(function () { e.target.style.outline = ''; }, 900);
  });

  await chargerProfils();
  chargerValider();
  chargerSignatures();
  chargerDemandes();
})();
