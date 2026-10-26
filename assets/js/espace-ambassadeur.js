// Espace consultant — programme ambassadeur.
(async function () {
  'use strict';
  var E = window.ESPACE, db = E.db, esc = E.esc;
  var st = await E.guard();
  if (!st) return;
  var p = st.profil;

  var lien = 'https://www.htportage.fr/espace/connexion.html?inscription=1&ref=' + encodeURIComponent(p.code_parrainage || '');
  document.getElementById('lien').textContent = lien.replace('https://', '');
  var copier = document.getElementById('copier');
  copier.addEventListener('click', async function () {
    try { await navigator.clipboard.writeText(lien); copier.textContent = 'Copié'; }
    catch (e) { copier.textContent = 'Sélectionnez le lien'; }
    setTimeout(function () { copier.textContent = 'Copier'; }, 2000);
  });

  var ETAPES = ['Reçue', 'Contactée', 'Signée', 'Prime versée'];
  var NIVEAU = { nouvelle: 1, 'en cours': 2, validee: 3, 'prime versee': 4, refusee: 0 };

  // Les règles de la base ne renvoient que les recommandations de l'ambassadeur (son compte ou son adresse e-mail)
  async function charger() {
    var r = await db.from('recommandations').select('id, created_at, type, contact_nom, statut, prime_montant').order('created_at', { ascending: false });
    var recos = r.data || [];
    var abouties = recos.filter(function (x) { return NIVEAU[x.statut] >= 3; });
    var aVenir = recos.filter(function (x) { return x.statut === 'validee'; }).reduce(function (s, x) { return s + (Number(x.prime_montant) || 0); }, 0);
    var versees = recos.filter(function (x) { return x.statut === 'prime versee'; }).reduce(function (s, x) { return s + (Number(x.prime_montant) || 0); }, 0);
    document.getElementById('compteurs').innerHTML =
      '<div class="kpi"><span class="kpi__value">' + recos.length + '</span><span class="kpi__note">recommandation' + (recos.length > 1 ? 's' : '') + '</span></div>' +
      '<div class="kpi"><span class="kpi__value">' + abouties.length + '</span><span class="kpi__note">abouti' + (abouties.length > 1 ? 'es' : 'e') + '</span></div>' +
      '<div class="kpi"><span class="kpi__value">' + E.eur(aVenir) + '</span><span class="kpi__note">primes à recevoir</span></div>' +
      '<div class="kpi"><span class="kpi__value">' + E.eur(versees) + '</span><span class="kpi__note">primes versées</span></div>';

    var el = document.getElementById('recos');
    if (!recos.length) {
      el.innerHTML = '<div class="empty-state">Vous n\'avez pas encore recommandé quelqu\'un. Utilisez le formulaire ou partagez votre lien de parrainage.</div>';
      return;
    }
    el.innerHTML = recos.map(function (x) {
      var n = NIVEAU[x.statut] || 0;
      var frise = x.statut === 'refusee' ? '' : '<ol class="timeline" aria-label="Suivi : étape ' + n + ' sur 4">' +
        ETAPES.map(function (e, i) { return '<li' + (i < n ? ' class="is-done"' : '') + '>' + e + '</li>'; }).join('') + '</ol>';
      return '<article class="box"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px">' +
        '<div style="display:flex;flex-direction:column;gap:2px"><span class="small" style="font-size:13px;font-weight:600">' + esc(E.LIBELLES.typeReco[x.type] || x.type) + ' · ' + E.date(x.created_at) + '</span>' +
        '<h3 style="margin:0;font-size:18px">' + esc(x.contact_nom) + '</h3></div>' +
        '<span style="align-self:flex-start">' + E.tag('reco', x.statut) + '</span></div>' + frise +
        (x.prime_montant && n >= 3 ? '<p style="font-size:14px">Prime : <strong>' + E.eur(x.prime_montant) + '</strong></p>' : '') + '</article>';
    }).join('');
  }

  var f = document.getElementById('form-reco');
  f.addEventListener('submit', async function (e) {
    e.preventDefault();
    var s = f.querySelector('.form-status');
    if (!f.checkValidity()) { f.reportValidity(); E.setStatus(s, 'Merci de compléter les champs obligatoires.', 'error'); return; }
    var nomAmb = [p.prenom, p.nom].filter(Boolean).join(' ') || st.user.email;
    var data = {
      type: f.querySelector('[name=type]:checked').value,
      ambassadeur_nom: nomAmb.length >= 2 ? nomAmb : st.user.email,
      ambassadeur_email: st.user.email,
      contact_nom: f.contact_nom.value.trim(),
      contact_telephone: f.contact_telephone.value.trim(),
      contact_email: f.contact_email.value.trim() || null,
      details: f.details.value.trim(),
      consentement: true,
      user_id: st.user.id
    };
    f.querySelector('[type=submit]').disabled = true;
    var r = await db.from('recommandations').insert(data);
    // Tant que la colonne contact_telephone n'existe pas encore en base (script v10), on l'ajoute aux détails
    if (r.error && /contact_telephone/.test(r.error.message || '')) {
      data.details = data.details + ' — Tél. : ' + data.contact_telephone;
      delete data.contact_telephone;
      r = await db.from('recommandations').insert(data);
    }
    f.querySelector('[type=submit]').disabled = false;
    if (r.error) { E.setStatus(s, E.errText(r.error), 'error'); return; }
    f.reset();
    E.setStatus(s, 'Merci ! Nous vous tenons informé de la suite.', 'ok');
    charger();
  });

  charger();
})();
