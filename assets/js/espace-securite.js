// Administration — double authentification (TOTP) : activation la première fois, puis code à chaque connexion.
(async function () {
  'use strict';
  var E = window.ESPACE, db = E.db;
  var params = new URLSearchParams(location.search);
  var suite = params.get('suite') || 'admin.html';
  if (!/^admin\.html([?#][\w=&%#.-]*)?$/.test(suite)) suite = 'admin.html';

  document.getElementById('deconnexion').addEventListener('click', async function () {
    await db.auth.signOut(); location.replace('connexion.html');
  });

  var s = await db.auth.getSession();
  if (!s.data || !s.data.session) { location.replace('connexion.html?suite=' + encodeURIComponent('admin.html')); return; }
  var ca = await db.rpc('compte_admin');
  var estAdmin = ca.error ? (await db.rpc('is_admin')).data === true : ca.data === true;
  if (!estAdmin) { location.replace('index.html'); return; }

  var niv = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (niv.data && niv.data.currentLevel === 'aal2') { location.replace(suite); return; }

  var lf = await db.auth.mfa.listFactors();
  var tous = (lf.data && lf.data.all) || [];
  var verifie = tous.find(function (f) { return f.factor_type === 'totp' && f.status === 'verified'; });
  document.getElementById('chargement').hidden = true;

  async function verifier(factorId, code, form) {
    var st = form.querySelector('.form-status'), b = form.querySelector('[type=submit]');
    code = (code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) { E.setStatus(st, 'Le code comporte 6 chiffres.', 'error'); form.code.focus(); return; }
    b.disabled = true; E.setStatus(st, 'Vérification…');
    var r = await db.auth.mfa.challengeAndVerify({ factorId: factorId, code: code });
    b.disabled = false;
    if (r.error) {
      E.setStatus(st, /invalid|expired/i.test(r.error.message || '') ? 'Code incorrect ou expiré : saisissez le code actuellement affiché.' : E.errText(r.error), 'error');
      form.code.value = ''; form.code.focus();
      return;
    }
    E.setStatus(st, 'Validé.', 'ok');
    location.replace(suite);
  }

  if (verifie) {
    var fc = document.getElementById('form-code');
    fc.hidden = false; fc.code.focus();
    fc.addEventListener('submit', function (e) { e.preventDefault(); verifier(verifie.id, fc.code.value, fc); });
    return;
  }

  // Première activation : on supprime un éventuel enregistrement inachevé, puis on en crée un
  for (var i = 0; i < tous.length; i++) {
    if (tous[i].status !== 'verified') await db.auth.mfa.unenroll({ factorId: tous[i].id });
  }
  var fe = document.getElementById('form-enrolement');
  var en = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HT Portage ' + new Date().toISOString().slice(0, 10), issuer: 'HT Portage' });
  if (en.error) {
    fe.hidden = false;
    E.setStatus(fe.querySelector('.form-status'), 'Activation impossible : ' + E.errText(en.error), 'error');
    fe.querySelector('[type=submit]').disabled = true;
    return;
  }
  document.getElementById('qr').src = en.data.totp.qr_code;
  document.getElementById('cle-secrete').textContent = en.data.totp.secret;
  fe.hidden = false; fe.code.focus();
  fe.addEventListener('submit', function (e) { e.preventDefault(); verifier(en.data.id, fe.code.value, fe); });
})();
