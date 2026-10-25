// HT Portage — script commun : menu mobile, client Supabase, envoi des formulaires.
(function () {
  'use strict';

  var cfg = window.HTP_CONFIG || {};
  var db = null;
  if (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient) {
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: false }
    });
  }
  window.HTP = { db: db, config: cfg };

  // Menu mobile
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Lien courant dans le menu
  var page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a:not(.btn)').forEach(function (a) {
    if (a.getAttribute('href') === page) a.setAttribute('aria-current', 'page');
  });

  // Année du pied de page
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  // ---- Formulaires ----
  // Chaque <form data-form="..."> est envoyé à la fonction serveur « formulaire » (contact, simulation, candidature, recommandation).
  var MESSAGES = {
    contact: 'Merci ! Nous vous recontactons très vite.',
    simulation: 'Merci ! Votre simulation détaillée vous sera envoyée sous 24 h ouvrées.',
    candidature: 'Candidature envoyée. Notre équipe revient vers vous rapidement.',
    recommandation: 'Merci pour votre recommandation ! Nous vous tenons informé de la suite.'
  };
  var CV_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  var CV_MAX = 5 * 1024 * 1024;

  function setStatus(form, text, kind) {
    var el = form.querySelector('.form-status');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-ok', 'is-error');
    if (kind) el.classList.add(kind === 'ok' ? 'is-ok' : 'is-error');
  }

  function payloadFrom(form) {
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === 'file' || el.type === 'submit' || el.name === 'site_web') return;
      if (el.type === 'checkbox') { data[el.name] = el.checked; return; }
      if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; return; }
      var v = el.value.trim();
      if (v === '') return;
      data[el.name] = (el.type === 'number' || el.dataset.number !== undefined) ? Number(v) : v;
    });
    return data;
  }

  // Envoi par la fonction serveur « formulaire » : piège à robots, captcha et limites y sont vérifiés.
  async function messageErreur(err) {
    try { var ctx = err && err.context; if (ctx && ctx.json) { var j = await ctx.json(); if (j && j.erreur) return j.erreur; } } catch (e) { /* message par défaut */ }
    return "Désolé, l'envoi a échoué. Réessayez ou écrivez-nous à " + (cfg.contactEmail || 'contact@htportage.fr') + '.';
  }

  async function submitForm(form) {
    var kind = form.dataset.form;
    var button = form.querySelector('[type=submit]');

    var hp = form.querySelector('[name=site_web]');
    if (hp && hp.value) { setStatus(form, MESSAGES[kind], 'ok'); form.reset(); return; } // robot

    if (!form.checkValidity()) {
      form.reportValidity();
      setStatus(form, 'Merci de compléter les champs obligatoires.', 'error');
      return;
    }

    var fileInput = form.querySelector('input[type=file]');
    var file = fileInput && fileInput.files[0];
    if (file) {
      if (CV_TYPES.indexOf(file.type) === -1) { setStatus(form, 'Le CV doit être un fichier PDF ou Word.', 'error'); return; }
      if (file.size > CV_MAX) { setStatus(form, 'Le CV ne doit pas dépasser 5 Mo.', 'error'); return; }
    }

    if (!db) {
      setStatus(form, "L'envoi en ligne n'est pas encore activé. Écrivez-nous à " + (cfg.contactEmail || 'contact@htportage.fr') + '.', 'error');
      return;
    }

    if (button) { button.disabled = true; }
    setStatus(form, 'Envoi en cours…');
    try {
      var envoi = new FormData();
      envoi.append('formulaire', kind);
      envoi.append('donnees', JSON.stringify(payloadFrom(form)));
      envoi.append('site_web', hp ? hp.value : '');
      envoi.append('delai', String(Date.now() - (form._htpDebut || 0)));
      if (form._htpCaptcha && form._htpCaptcha.actif) {
        setStatus(form, 'Vérification anti-robot…');
        envoi.append('cf-turnstile-response', await form._htpCaptcha.jeton());
        setStatus(form, 'Envoi en cours…');
      }
      if (file) envoi.append('cv', file, file.name);
      var res = await db.functions.invoke('formulaire', { body: envoi });
      if (res.error) { setStatus(form, await messageErreur(res.error), 'error'); return; }
      form.reset();
      form.dispatchEvent(new CustomEvent('htp:sent'));
      setStatus(form, MESSAGES[kind], 'ok');
    } catch (err) {
      console.error(err);
      setStatus(form, (err && err.message && /anti-robot/.test(err.message)) ? err.message : "Désolé, l'envoi a échoué. Réessayez ou écrivez-nous à " + (cfg.contactEmail || 'contact@htportage.fr') + '.', 'error');
    } finally {
      if (form._htpCaptcha) form._htpCaptcha.reinitialiser();
      form._htpDebut = Date.now() - 3000; // un 2e envoi par un humain ne doit pas être pris pour un robot
      if (button) { button.disabled = false; }
    }
  }

  document.querySelectorAll('form[data-form]').forEach(function (form) {
    form._htpDebut = Date.now();
    if (window.HTP_CAPTCHA) form._htpCaptcha = window.HTP_CAPTCHA.monter(form);
    form.addEventListener('submit', function (e) { e.preventDefault(); submitForm(form); });
  });
})();
