// Espace consultant — connexion, inscription, mot de passe oublié.
(function () {
  'use strict';
  var E = window.ESPACE, db = E.db;
  var params = new URLSearchParams(location.search);
  var base = location.href.split('?')[0].replace(/[^/]*$/, '');

  // Page de retour après connexion : uniquement une page de l'espace.
  var suite = params.get('suite') || '';
  if (!/^[a-z-]+\.html(\?[\w=&%.-]*)?$/.test(suite) || /^connexion\.html/.test(suite)) suite = 'index.html';

  // Code de parrainage (lien ?ref=) conservé pour l'inscription
  var ref = (params.get('ref') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  try {
    if (ref) localStorage.setItem('htp-ref', ref); else ref = localStorage.getItem('htp-ref') || '';
  } catch (e) { /* stockage indisponible */ }

  // Simulation transmise par le simulateur
  var tjm = parseInt(params.get('tjm'), 10), jours = parseInt(params.get('jours'), 10), net = parseInt(params.get('net'), 10);
  if (tjm >= 100 && tjm <= 5000 && jours >= 1 && jours <= 31 && net >= 0) {
    try { localStorage.setItem('htp-simulation', JSON.stringify({ tjm: tjm, jours: jours, net: net })); } catch (e) { /* rien */ }
    var recap = document.getElementById('sim-recap');
    recap.textContent = 'Votre simulation : TJM ' + E.eur(tjm) + ' · ' + jours + ' jours/mois · net estimé ' + E.eur(net) + '/mois. Elle sera enregistrée dans votre espace.';
    recap.hidden = false;
  }

  // ---------- Onglets ----------
  var vues = { connexion: 'panel-connexion', inscription: 'panel-inscription', oubli: 'panel-oubli' };
  var tabs = document.getElementById('tabs');
  function montrer(vue) {
    Object.keys(vues).forEach(function (k) { document.getElementById(vues[k]).hidden = k !== vue; });
    tabs.hidden = vue === 'oubli';
    document.getElementById('tab-connexion').setAttribute('aria-selected', vue === 'connexion' ? 'true' : 'false');
    document.getElementById('tab-inscription').setAttribute('aria-selected', vue === 'inscription' ? 'true' : 'false');
    var first = document.querySelector('#' + vues[vue] + ' input');
    if (first && document.activeElement && document.activeElement !== document.body) first.focus();
  }
  document.getElementById('tab-connexion').addEventListener('click', function () { montrer('connexion'); });
  document.getElementById('tab-inscription').addEventListener('click', function () { montrer('inscription'); });
  tabs.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var autre = document.activeElement.id === 'tab-connexion' ? 'inscription' : 'connexion';
    montrer(autre);
    document.getElementById('tab-' + autre).focus();
  });
  document.querySelectorAll('[data-vue]').forEach(function (b) {
    b.addEventListener('click', function () { montrer(b.dataset.vue); });
  });
  if (params.get('inscription') === '1' || tjm) montrer('inscription');

  // Déjà connecté : direction l'espace
  db.auth.getSession().then(function (r) {
    if (r.data && r.data.session) location.replace(suite);
  });

  // Anti-robot (Cloudflare Turnstile) : actif dès que la clé est renseignée dans config.js
  var C = window.HTP_CAPTCHA || { monter: function () { return { actif: false, jeton: function () { return Promise.resolve(''); }, reinitialiser: function () {} }; } };
  async function avecCaptcha(form, st, opts) {
    var c = form._captcha || (form._captcha = C.monter(form));
    if (!c.actif) return opts;
    E.setStatus(st, 'Vérification anti-robot…');
    var j = await c.jeton();
    if (!j) throw new Error('La vérification anti-robot n’a pas abouti. Réessayez dans un instant.');
    opts.captchaToken = j;
    return opts;
  }
  function apres(form) { if (form._captcha) form._captcha.reinitialiser(); }

  function occuper(form, oui) {
    var b = form.querySelector('[type=submit]');
    if (b) b.disabled = oui;
  }

  ['form-connexion', 'form-inscription', 'form-oubli'].forEach(function (id) { var f = document.getElementById(id); f._captcha = C.monter(f); });

  // ---------- Connexion ----------
  var fc = document.getElementById('form-connexion');
  fc.addEventListener('submit', async function (e) {
    e.preventDefault();
    var st = fc.querySelector('.form-status');
    if (!fc.checkValidity()) { fc.reportValidity(); E.setStatus(st, 'Indiquez votre e-mail et votre mot de passe.', 'error'); return; }
    occuper(fc, true);
    var r;
    try {
      var o = await avecCaptcha(fc, st, {});
      E.setStatus(st, 'Connexion…');
      r = await db.auth.signInWithPassword({ email: fc.email.value.trim(), password: fc.password.value, options: o });
    } catch (err) { r = { error: err }; }
    occuper(fc, false); apres(fc);
    if (r.error) { E.setStatus(st, E.errText(r.error), 'error'); return; }
    location.replace(suite);
  });

  // ---------- Inscription ----------
  var fi = document.getElementById('form-inscription');
  fi.addEventListener('submit', async function (e) {
    e.preventDefault();
    var st = fi.querySelector('.form-status');
    if (!fi.checkValidity()) {
      fi.reportValidity();
      E.setStatus(st, fi.password.value && fi.password.value.length < 10 ? 'Le mot de passe doit faire au moins 10 caractères.' : 'Merci de compléter tous les champs.', 'error');
      return;
    }
    occuper(fi, true);
    var email = fi.email.value.trim();
    var r;
    try {
      var oi = await avecCaptcha(fi, st, {
        data: { prenom: fi.prenom.value.trim(), nom: fi.nom.value.trim(), parrain: ref || undefined },
        emailRedirectTo: base + 'index.html'
      });
      E.setStatus(st, 'Création de votre espace…');
      r = await db.auth.signUp({ email: email, password: fi.password.value, options: oi });
    } catch (err) { r = { error: err }; }
    occuper(fi, false); apres(fi);
    if (r.error) { E.setStatus(st, E.errText(r.error), 'error'); return; }
    if (r.data && r.data.user && Array.isArray(r.data.user.identities) && r.data.user.identities.length === 0) {
      E.setStatus(st, 'Un compte existe déjà avec cette adresse : connectez-vous.', 'error');
      return;
    }
    try { localStorage.removeItem('htp-ref'); } catch (err) { /* rien */ }
    if (r.data && r.data.session) { location.replace('index.html'); return; }
    fi.reset();
    E.setStatus(st, 'Presque fini : cliquez sur le lien envoyé à ' + email + ' pour activer votre espace.', 'ok');
  });

  // ---------- Mot de passe oublié ----------
  var fo = document.getElementById('form-oubli');
  fo.addEventListener('submit', async function (e) {
    e.preventDefault();
    var st = fo.querySelector('.form-status');
    if (!fo.checkValidity()) { fo.reportValidity(); E.setStatus(st, 'Indiquez votre e-mail.', 'error'); return; }
    occuper(fo, true);
    var r;
    try {
      r = await db.auth.resetPasswordForEmail(fo.email.value.trim(), await avecCaptcha(fo, st, { redirectTo: base + 'reset.html' }));
    } catch (err) { r = { error: err }; }
    occuper(fo, false); apres(fo);
    if (r.error && /rate limit|too many|captcha|anti-robot/i.test(r.error.message || '')) { E.setStatus(st, E.errText(r.error), 'error'); return; }
    E.setStatus(st, 'Si un compte existe pour cette adresse, un lien vient de vous être envoyé.', 'ok');
  });
})();
