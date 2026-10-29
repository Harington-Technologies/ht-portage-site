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
  try { var dq = new URLSearchParams(location.search).get('domaine'); if (DOMAINES.indexOf(dq) >= 0) filtre = dq; } catch (e) { /* rien */ }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Description mise en forme à partir du texte saisi (souvent collé depuis Word) :
  // « • » ou « - » = point principal, « o » / « ◦ » / « – » = sous-point, ligne en MAJUSCULES = intertitre.
  // Construite élément par élément (textContent), jamais en HTML brut.
  function description(texte) {
    var box = el('div', 'mission__desc');
    var lignes = String(texte).replace(/\r/g, '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var ul = null, li = null, sous = null, dernier = null;
    function fermer() { ul = null; li = null; sous = null; }
    lignes.forEach(function (l) {
      var m1 = /^[•●▪■*-]\s*(.+)$/.exec(l), m2 = /^(?:o|◦|–|·|○)\s+(.+)$/.exec(l);
      var lettres = l.replace(/[^A-Za-zÀ-ÿ]/g, '');
      if (m2) {
        if (!li) {
          // Sous-points sans point principal : la ligne qui les précède devient leur titre
          var avant = box.lastElementChild, titre = avant && avant.tagName === 'P' && !avant.classList.contains('mission__intertitre') ? avant.textContent : null;
          if (titre) { box.removeChild(avant); ul = null; }
          if (!ul) { ul = el('ul'); box.appendChild(ul); }
          li = el('li'); if (titre) li.appendChild(el('span', 'mission__point', titre)); else li.className = 'sans-puce';
          ul.appendChild(li);
        }
        if (!sous) { sous = el('ul'); li.appendChild(sous); }
        dernier = el('li', null, m2[1]); sous.appendChild(dernier);
      } else if (m1) {
        if (!ul) { ul = el('ul'); box.appendChild(ul); }
        li = el('li'); dernier = el('span', 'mission__point', m1[1]); li.appendChild(dernier); ul.appendChild(li); sous = null;
      } else if (lettres.length >= 4 && lettres === lettres.toUpperCase() && l.length <= 80) {
        fermer(); dernier = null; box.appendChild(el('p', 'mission__intertitre', l.charAt(0) + l.slice(1).toLowerCase()));
      } else if (dernier && /^[a-zà-ÿ(]/.test(l)) {
        dernier.textContent += ' ' + l; // suite d'une ligne coupée
      } else if (dernier && sous) {
        dernier = el('li', null, l); sous.appendChild(dernier);
      } else {
        fermer(); dernier = el('p', null, l); box.appendChild(dernier);
      }
    });
    if (lignes.length <= 4 && String(texte).length <= 360) return box;
    // Description longue : repliée, avec un bouton pour la déplier
    var wrap = el('div', 'mission__repli');
    box.classList.add('is-repliee'); wrap.appendChild(box);
    var b = el('button', 'link-btn mission__plus', 'Voir le détail');
    b.type = 'button'; b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function () {
      var ouvert = box.classList.toggle('is-repliee') === false;
      b.textContent = ouvert ? 'Réduire' : 'Voir le détail'; b.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    });
    wrap.appendChild(b);
    return wrap;
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
      if (m.resume) card.appendChild(description(m.resume));
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

  // Offres lisibles par Google for Jobs (données structurées JobPosting)
  function donneesStructurees(liste) {
    if (!liste.length) return;
    var data = liste.map(function (m) {
      var remote = /remote|t[ée]l[ée]travail/i.test((m.lieu || '') + ' ' + (m.rythme || ''));
      var o = {
        '@context': 'https://schema.org', '@type': 'JobPosting',
        title: m.titre, identifier: { '@type': 'PropertyValue', name: 'HT Portage', value: m.ref },
        description: '<p>' + [m.resume, m.duree ? 'Durée : ' + m.duree + '.' : '', m.rythme ? 'Rythme : ' + m.rythme + '.' : '', 'Mission en portage salarial (CDI de portage) avec HT Portage, filiale de Harington Technologies.'].filter(Boolean).join(' ') + '</p>',
        datePosted: String(m.created_at || new Date().toISOString()).slice(0, 10),
        employmentType: 'CONTRACTOR',
        hiringOrganization: { '@type': 'Organization', name: 'HT Portage', sameAs: 'https://www.htportage.fr', logo: 'https://www.htportage.fr/assets/img/favicon.svg' },
        jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: /remote/i.test(m.lieu || '') ? 'Paris' : (m.lieu || 'Paris'), addressCountry: 'FR' } },
        directApply: true, url: 'https://www.htportage.fr/missions.html'
      };
      if (remote) { o.jobLocationType = 'TELECOMMUTE'; o.applicantLocationRequirements = { '@type': 'Country', name: 'France' }; }
      return o;
    });
    var sc = document.createElement('script');
    sc.type = 'application/ld+json'; sc.textContent = JSON.stringify(data);
    document.head.appendChild(sc);
  }

  async function load() {
    var db = window.HTP && window.HTP.db;
    if (!db) {
      missions = EXEMPLES;
      noteEl.textContent = 'Offres d’exemple : la liste réelle s’affichera une fois Supabase configuré.';
    } else {
      var res = await db.from('missions')
        .select('ref, titre, domaine, resume, lieu, duree, rythme, tjm, created_at')
        .eq('publiee', true)
        .order('created_at', { ascending: false });
      if (res.error) {
        console.error(res.error);
        list.textContent = '';
        list.appendChild(el('p', 'empty', 'Les missions ne peuvent pas être chargées pour le moment. Envoyez-nous une candidature spontanée.'));
        return;
      }
      missions = res.data || [];
      donneesStructurees(missions);
    }
    if (filtre !== 'Tous' && !missions.some(function (m) { return m.domaine === filtre; })) filtre = 'Tous';
    renderFilters();
    renderList();
    fillSelect();
  }

  load();
})();
