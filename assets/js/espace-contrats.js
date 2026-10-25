// Espace consultant — contrats, documents et missions.
(async function () {
  'use strict';
  var E = window.ESPACE, db = E.db, esc = E.esc;
  var st = await E.guard();
  if (!st) return;
  var uid = st.user.id;

  var r = await Promise.all([
    db.from('documents').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    db.from('consultant_missions').select('*').eq('user_id', uid).order('date_debut', { ascending: false, nullsFirst: true })
  ]);
  var docs = r[0].data || [], missions = r[1].data || [];
  var missionNom = {};
  missions.forEach(function (m) { missionNom[m.id] = m.intitule + (m.client ? ' · ' + m.client : ''); });

  var GROUPES = { contrats: ['cdi', 'annexe', 'avenant'], paie: ['bulletin', 'compte_activite'], autre: ['attestation', 'autre'] };
  var docsEl = document.getElementById('docs');
  function afficherDocs(filtre) {
    var liste = filtre ? docs.filter(function (d) { return GROUPES[filtre].indexOf(d.type) >= 0; }) : docs;
    if (!liste.length) {
      docsEl.innerHTML = '<div class="empty-state">' + (docs.length ? 'Aucun document dans cette catégorie.' :
        'Aucun document pour le moment. Votre CDI et vos annexes de mission apparaîtront ici dès leur préparation.') + '</div>';
      return;
    }
    docsEl.innerHTML = '<div class="table-wrap"><table class="table" style="min-width:640px"><thead><tr>' +
      '<th scope="col">Document</th><th scope="col">Concerne</th><th scope="col">Date</th><th scope="col">Statut</th><th scope="col"><span class="visually-hidden">Action</span></th>' +
      '</tr></thead><tbody>' + liste.map(function (d) {
        return '<tr><td><strong>' + esc(d.titre) + '</strong><br><span class="small">' + esc(E.LIBELLES.typeDoc[d.type] || '') + '</span></td>' +
          '<td>' + esc(d.mission_id ? (missionNom[d.mission_id] || 'Mission') : (d.type === 'cdi' ? 'Contrat de travail HT Portage' : '—')) + '</td>' +
          '<td style="white-space:nowrap">' + E.date(d.date_document || d.created_at) + '</td>' +
          '<td>' + E.tag('document', d.statut) + '</td>' +
          '<td class="num">' + (d.storage_path ? '<button class="link-btn" type="button" data-doc="' + esc(d.storage_path) + '">Télécharger<span class="visually-hidden"> ' + esc(d.titre) + '</span></button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  afficherDocs('');
  document.getElementById('filtre').addEventListener('change', function (e) { afficherDocs(e.target.value); });
  E.brancherTelechargements(docsEl);

  var mEl = document.getElementById('missions');
  if (!missions.length) {
    mEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Aucune mission déclarée.<a class="btn btn--light btn--sm" href="contractualisation.html">Déclarer ma mission</a></div>';
    return;
  }
  mEl.innerHTML = missions.map(function (m) {
    var d0 = E.parseDate(m.date_debut), d1 = E.parseDate(m.date_fin), prog = '';
    if (m.statut === 'active' && d0 && d1 && d1 > d0) {
      var pct = Math.max(0, Math.min(100, Math.round((Date.now() - d0) / (d1 - d0) * 100)));
      prog = '<div style="display:flex;flex-direction:column;gap:6px"><div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted)"><span>Avancement</span><span>' + pct + ' %</span></div>' +
        '<div class="progress" role="img" aria-label="Avancement : ' + pct + ' %"><span style="width:' + pct + '%"></span></div></div>';
    }
    var interloc = [m.interlocuteur_nom, m.interlocuteur_email, m.interlocuteur_tel].filter(Boolean).join(' · ');
    var suite = m.statut === 'brouillon' ? '<a class="btn btn--ghost-dark btn--sm" href="contractualisation.html" style="align-self:flex-start">Reprendre</a>' :
      m.statut === 'a_valider' ? '<p class="small" style="font-size:14px">HT Portage vérifie votre dossier avant l\'envoi du contrat en signature.</p>' : '';
    return '<article class="box' + (m.statut === 'brouillon' || m.statut === 'a_valider' ? '" style="border-style:dashed;border-color:#A7B3C6' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">' +
        '<div style="display:flex;flex-direction:column;gap:4px;min-width:0"><h3 style="margin:0;font-size:18px">' + esc(m.intitule) + '</h3>' +
        '<span style="font-size:14px;color:var(--muted)">' + esc([m.client, m.client_final ? 'client final ' + m.client_final : ''].filter(Boolean).join(' · ') || 'Client à préciser') + '</span></div>' +
        E.tag('mission', m.statut) +
      '</div>' +
      '<dl class="dl"><div><dt>Début</dt><dd>' + E.date(m.date_debut) + '</dd></div><div><dt>Fin</dt><dd>' + E.date(m.date_fin) + '</dd></div>' +
      '<div><dt>TJ</dt><dd>' + (m.tjm ? E.eur(m.tjm) + ' HT' : '—') + '</dd></div>' + (m.lieu ? '<div><dt>Lieu</dt><dd>' + esc(m.lieu) + '</dd></div>' : '') + '</dl>' +
      prog + (interloc ? '<p style="font-size:14px"><span style="color:var(--muted)">Interlocuteur client :</span> <strong>' + esc(interloc) + '</strong></p>' : '') + suite +
      '</article>';
  }).join('');
})();
