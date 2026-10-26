// Espace consultant — mes informations.
(async function () {
  'use strict';
  var E = window.ESPACE, db = E.db;
  var st = await E.guard();
  if (!st) return;
  var p = st.profil, f = document.getElementById('form-profil'), status = document.getElementById('profil-status');
  var CHAMPS = ['civilite', 'prenom', 'nom', 'date_naissance', 'lieu_naissance', 'nationalite', 'num_secu',
    'telephone', 'adresse', 'code_postal', 'ville', 'pays', 'iban', 'bic', 'competences'];

  CHAMPS.forEach(function (k) { if (f[k]) f[k].value = p[k] || ''; });
  f.email.value = p.email || st.user.email;
  if (p.iban) f.iban.value = p.iban.replace(/(.{4})/g, '$1 ').trim();
  document.getElementById('statut').textContent = { candidat: 'Candidat', consultant: 'Consultant porté', sorti: 'Ancien consultant' }[p.statut] || '—';
  document.getElementById('code').textContent = p.code_parrainage || '—';
  document.getElementById('depuis').textContent = E.date(p.created_at);

  // Ce qui manque pour le contrat : encadré en haut de page et champs signalés
  function afficherManques() {
    var mq = E.manquants(st.profil), tout = mq.identite.concat(mq.coordonnees);
    E.EXIGENCES.identite.concat(E.EXIGENCES.coordonnees).forEach(function (x) {
      var el = f[x[0]]; if (!el) return;
      if (!st.profil[x[0]]) el.classList.add('is-manquant'); else el.classList.remove('is-manquant');
    });
    var box = document.getElementById('etat-dossier');
    box.innerHTML = tout.length
      ? '<div class="alerte alerte--manque"><strong>Il manque ' + tout.length + ' information' + (tout.length > 1 ? 's' : '') + ' pour établir votre contrat</strong>' +
        '<ul>' + (mq.identite.length ? '<li>Identité : ' + E.esc(E.listeFr(mq.identite)) + '</li>' : '') + (mq.coordonnees.length ? '<li>Coordonnées : ' + E.esc(E.listeFr(mq.coordonnees)) + '</li>' : '') + '</ul>' +
        '<span>Les champs concernés sont signalés en orange ci-dessous.</span></div>'
      : '<div class="alerte alerte--ok"><strong>Vos informations sont complètes</strong><span>Vous pouvez passer à l’étape suivante : <a href="contractualisation.html">déclarer votre mission</a>.</span></div>';
  }
  afficherManques();

  function ibanValide(iban) {
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
    var r = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, function (c) { return String(c.charCodeAt(0) - 55); });
    var reste = 0;
    for (var i = 0; i < r.length; i += 7) reste = Number(String(reste) + r.slice(i, i + 7)) % 97;
    return reste === 1;
  }
  function erreur(champ, msg) {
    f[champ].setAttribute('aria-invalid', 'true');
    f[champ].focus();
    E.setStatus(status, msg, 'error');
  }

  f.addEventListener('input', function (e) { e.target.removeAttribute('aria-invalid'); });

  f.addEventListener('submit', async function (e) {
    e.preventDefault();
    var data = {};
    CHAMPS.forEach(function (k) { var v = (f[k].value || '').trim(); data[k] = v === '' ? null : v; });
    if (!data.prenom || !data.nom) return erreur(data.prenom ? 'nom' : 'prenom', 'Le prénom et le nom sont obligatoires.');
    if (data.num_secu) {
      data.num_secu = data.num_secu.replace(/[\s.-]/g, '').toUpperCase();
      if (!/^[12][0-9]{4}(2A|2B|[0-9]{2})[0-9]{6}([0-9]{2})?$/.test(data.num_secu)) return erreur('num_secu', 'Le n° de sécurité sociale ne semble pas valide (13 ou 15 caractères, commençant par 1 ou 2).');
    }
    if (data.iban) {
      data.iban = data.iban.replace(/\s/g, '').toUpperCase();
      if (!ibanValide(data.iban)) return erreur('iban', "L'IBAN n'est pas valide : vérifiez-le sur votre RIB.");
    }
    if (data.bic) {
      data.bic = data.bic.replace(/\s/g, '').toUpperCase();
      if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(data.bic)) return erreur('bic', 'Le BIC doit faire 8 ou 11 caractères.');
    }
    if (data.date_naissance && (data.date_naissance < '1930-01-01' || new Date(data.date_naissance) > new Date())) return erreur('date_naissance', 'La date de naissance ne semble pas valide.');
    if (!data.pays) data.pays = 'France';

    var btn = f.querySelector('[type=submit]');
    btn.disabled = true; E.setStatus(status, 'Enregistrement…');
    var r = await db.from('profils').update(data).eq('id', st.user.id);
    btn.disabled = false;
    if (r.error) { E.setStatus(status, E.errText(r.error), 'error'); return; }
    E.setStatus(status, 'Informations enregistrées.', 'ok');
    Object.assign(st.profil, data);
    afficherManques();
    document.querySelectorAll('[data-avatar]').forEach(function (a) { a.textContent = E.initiales(st.profil, st.user.email); });
    if (data.iban) f.iban.value = data.iban.replace(/(.{4})/g, '$1 ').trim();
  });

  var fm = document.getElementById('form-mdp');
  fm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var s = fm.querySelector('.form-status');
    if (!fm.checkValidity()) { fm.reportValidity(); E.setStatus(s, '10 caractères minimum.', 'error'); return; }
    var r = await db.auth.updateUser({ password: fm.password.value });
    if (r.error) { E.setStatus(s, E.errText(r.error), 'error'); return; }
    fm.reset();
    E.setStatus(s, 'Mot de passe mis à jour.', 'ok');
  });
})();
