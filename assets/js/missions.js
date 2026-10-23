// HT Portage — liste des missions (table Supabase « missions »), filtres et lien vers la candidature.
(function () {
  'use strict';

  var list = document.getElementById('missions-list');
  if (!list) return;
  var filtersEl = document.getElementById('filters');
  var countEl = document.getElementById('mission-count');
  var noteEl = document.getElementById('missions-note');
  var select = document.getElementById('m-mission');

  var DOMAINES = ['Développement', 'Data & IA', 'Cloud & DevOps', 'Pilotage'];

  // Exemples affichés tant que Supabase n'est pas configuré.
  var EXEMPLES = [
    { ref: 'EX-01', domaine: 'Développement', titre: 'Tech Lead Java / Spring', resume: 'Pilotage technique d’une équipe produit, architecture microservices et revue de code.', lieu: 'Paris', duree: '12 mois', rythme: '2 j télétravail / sem.', tjm: null },
    { ref: 'EX-02', domaine: 'Data & IA', titre: 'Data Engineer Python', resume: 'Conception de pipelines de données et industrialisation de modèles en production.', lieu: 'Paris', duree: '6 mois renouvelables', rythme: 'Hybride', tjm: null },
    { ref: 'EX-03', domaine: 'Cloud & DevOps', titre: 'Ingénieur DevOps Kubernetes', resume: 'Automatisation CI/CD, infrastructure as code et fiabilisation des plateformes.', lieu: 'Lyon', duree: '9 mois', rythme: '3 j télétravail / sem.', tjm: null },
    { ref: 'EX-04', domaine: 'Pilotage', titre: 'Chef de projet transformation IT', resume: 'Coordination d’un programme de modernisation du système d’information.', lieu: 'La Défense', duree: '12 mois', rythme: 'Hybride', tjm: null },
    { ref: 'EX-05', domaine: 'Développement', titre: 'Développeur Full-stack React / Node', resume: 'Développement de nouvelles fonctionnalités sur une application à fort trafic.', lieu: 'Full remote', duree: '6 mois', rythme: 'Télétravail', tjm: null },
    { ref: 'EX-06', domaine: 'Data & IA', titre: 'Consultant IA générative', resume: 'Cadrage et déploiement de cas d’usage IA générative auprès des métiers.', lieu: 'Paris', duree: '6 mois', rythme: '2 j télétravail / sem.', tjm: null }
  ];

  var missions = [];
  var filtre = 'Tous';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderFilters() {
    var labels = ['Tous'].concat(DOMAINES.filter(function (d) {
      return missions.some(function (m) { return m.domaine === d; });
    }));
    filtersEl.textContent = '';
    labels.forEach(function (l) {
      var b = el('button', 'chip', l);
      b.type = 'button';
      b.setAttribute('aria-pressed', l === filtre ? 'true' : 'false');
      b.addEventListener('click', function () { filtre = l; renderFilters(); renderList(); });
      filtersEl.appendChild(b);
    });
  }

  function renderList() {
    var shown = filtre === 'Tous' ? missions : missions.filter(function (m) { return m.domaine === filtre; });
    list.textContent = '';
    countEl.textContent = shown.length + (shown.length > 1 ? ' missions ouvertes' : ' mission ouverte');
    if (!shown.length) {
      list.appendChild(el('p', 'empty', 'Aucune mission ouverte pour le moment. Envoyez-nous une candidature spontanée : nous vous alertons dès qu’un besoin correspond à votre profil.'));
      return;
    }
    shown.forEach(function (m) {
      var card = el('article', 'card mission');
      var top = el('div', 'mission__top');
      top.appendChild(el('span', 'badge', m.domaine || 'Mission'));
      top.appendChild(el('span', 'small', m.ref || ''));
      card.appendChild(top);
      card.appendChild(el('h3', null, m.titre));
      if (m.resume) card.appendChild(el('p', null, m.resume));
      var meta = el('div', 'mission__meta');
      [m.lieu, m.duree, m.rythme].forEach(function (v) { if (v) meta.appendChild(el('span', null, v)); });
      card.appendChild(meta);
      var foot = el('div', 'mission__foot');
      foot.appendChild(el('span', 'mission__tjm', m.tjm ? 'TJM ' + m.tjm : 'TJM selon profil'));
      var a = el('a', 'btn btn--dark', 'Postuler');
      a.href = '#postuler';
      a.addEventListener('click', function () { if (select) select.value = m.ref || ''; });
      foot.appendChild(a);
      card.appendChild(foot);
      list.appendChild(card);
    });
  }

  function fillSelect() {
    if (!select) return;
    missions.forEach(function (m) {
      var o = el('option', null, (m.ref ? m.ref + ' — ' : '') + m.titre);
      o.value = m.ref || m.titre;
      select.appendChild(o);
    });
  }

  async function load() {
    var db = window.HTP && window.HTP.db;
    if (!db) {
      missions = EXEMPLES;
      noteEl.textContent = 'Offres d’exemple : la liste réelle s’affichera une fois Supabase configuré.';
    } else {
      var res = await db.from('missions')
        .select('ref, titre, domaine, resume, lieu, duree, rythme, tjm')
        .eq('publiee', true)
        .order('created_at', { ascending: false });
      if (res.error) {
        console.error(res.error);
        list.textContent = '';
        list.appendChild(el('p', 'empty', 'Les missions ne peuvent pas être chargées pour le moment. Envoyez-nous une candidature spontanée.'));
        return;
      }
      missions = res.data || [];
    }
    renderFilters();
    renderList();
    fillSelect();
  }

  load();
})();
