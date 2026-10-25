// HT Portage — vérification anti-robot Cloudflare Turnstile (invisible la plupart du temps).
// Inactive tant que HTP_CONFIG.turnstileSiteKey n'est pas renseignée : les formulaires fonctionnent alors sans captcha.
// Usage : var c = HTP_CAPTCHA.monter(form); … var jeton = await c.jeton(); … c.reinitialiser();
(function () {
  'use strict';
  var cle = (window.HTP_CONFIG || {}).turnstileSiteKey || '';
  var pret = null;

  function charger() {
    if (pret) return pret;
    pret = new Promise(function (ok, ko) {
      window.htpTurnstilePret = function () { ok(window.turnstile); };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=htpTurnstilePret';
      s.async = true; s.defer = true;
      s.onerror = function () { ko(new Error('Le service anti-robot ne répond pas. Vérifiez votre connexion ou désactivez un éventuel bloqueur, puis réessayez.')); };
      document.head.appendChild(s);
    });
    return pret;
  }

  function monter(form) {
    if (!cle) return { actif: false, jeton: function () { return Promise.resolve(''); }, reinitialiser: function () {} };
    var zone = document.createElement('div');
    zone.className = 'captcha';
    var bouton = form.querySelector('[type=submit]');
    if (bouton) bouton.parentNode.insertBefore(zone, bouton); else form.appendChild(zone);
    var id = null, courant = '', attente = [];
    function livrer(t) { courant = t || ''; attente.splice(0).forEach(function (f) { f(courant); }); }
    var monte = charger().then(function (ts) {
      id = ts.render(zone, {
        sitekey: cle, language: 'fr', appearance: 'interaction-only',
        callback: livrer, 'expired-callback': function () { courant = ''; ts.reset(id); },
        'error-callback': function () { livrer(''); }
      });
    });
    return {
      actif: true,
      jeton: function () {
        return monte.then(function () {
          if (courant) return courant;
          return new Promise(function (ok) {
            attente.push(ok);
            setTimeout(function () { ok(courant); }, 15000);
          });
        });
      },
      reinitialiser: function () { courant = ''; if (id !== null && window.turnstile) window.turnstile.reset(id); }
    };
  }

  window.HTP_CAPTCHA = { actif: !!cle, monter: monter };
})();
