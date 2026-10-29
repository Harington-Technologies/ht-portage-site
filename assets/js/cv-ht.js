// HT Portage — Doc-converter : dépôt d'un CV (PDF ou Word), options, aperçu au format HT Portage,
// téléchargement Word (.docx) et PDF (impression). Utilisé dans l'espace consultant et l'administration.
// window.HTP_CV.monter(conteneur, { admin }) ; .depuisCandidature({ id, nom, cv_path, mission_ref })
(function () {
  'use strict';
  var E = window.ESPACE;
  if (!E) return;
  var db = E.db, esc = E.esc;
  var LIBS = {
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
    docx: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js'
  };
  var charges = {};
  function charger(url) {
    if (!charges[url]) charges[url] = new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = function () { ko(new Error('Bibliothèque indisponible')); }; document.head.appendChild(s); });
    return charges[url];
  }
  var MONO = '<path d="M3.5 69 V10.5 A8 8 0 0 1 19.5 10.5 V24 A8 8 0 0 0 27.5 32 H34 A8 8 0 0 0 42 24 V11.5 A8 8 0 0 1 50 3.5 H97 A7.25 7.25 0 0 1 97 18 H95.5 A8 8 0 0 0 87.5 26 V69 A8.25 8.25 0 0 1 71 69 V24.5 A6 6 0 0 0 59 24.5 V41 A8 8 0 0 1 51 49 H27.5 A8 8 0 0 0 19.5 57 V69 A8 8 0 0 1 3.5 69 Z"/><path d="M42.5 62.5 A8.5 8.5 0 0 1 59.5 62.5 V68.25 A8.5 8.5 0 0 1 42.5 68.25 Z"/><path d="M114 69 V11.5 A8 8 0 0 1 122 3.5 H136 A20.5 20.5 0 0 1 136 44.5 A6 6 0 0 0 130 50.5 V69 A8 8 0 0 1 114 69 Z"/><path d="M130 19.5 A4 4 0 0 1 134 15.5 H136 A8.5 8.5 0 0 1 136 32.5 H134 A4 4 0 0 1 130 28.5 Z"/>';
  var C = { navy: '21324E', rose: 'C187A1', plum: '784E61', muted: '5B6475', tint: 'EEF1F5' };
  var L = {
    fr: { doc: 'Dossier de compétences', ans: function (n) { return n + ' an' + (n > 1 ? 's' : '') + ' d\'expérience'; }, profil: 'Profil', cles: 'Compétences clés', comp: 'Compétences', exp: 'Expériences professionnelles', form: 'Formation', certif: 'Certifications', lang: 'Langues', env: 'Environnement', contexte: 'Contexte', contact: 'Contact HT Portage', pied: 'HT Portage · Portage salarial · Groupe Harington Technologies · www.htportage.fr' },
    en: { doc: 'Skills profile', ans: function (n) { return n + ' year' + (n > 1 ? 's' : '') + ' of experience'; }, profil: 'Profile', cles: 'Key skills', comp: 'Skills', exp: 'Professional experience', form: 'Education', certif: 'Certifications', lang: 'Languages', env: 'Environment', contexte: 'Context', contact: 'HT Portage contact', pied: 'HT Portage · Umbrella company · Harington Technologies group · www.htportage.fr' }
  };
  function arr(x) { return Array.isArray(x) ? x.filter(function (v) { return v != null && v !== ''; }) : []; }

  // ---------------------------------------------------------------------
  // Rendu HTML du CV (aperçu et impression PDF)
  // ---------------------------------------------------------------------
  var STYLE = '.cvp{font-family:"Open Sans",Arial,sans-serif;color:#1B1C1C;background:#fff;width:100%;max-width:794px;margin:0 auto;font-size:13px;line-height:1.5;box-shadow:0 2px 18px rgba(33,50,78,.12)}' +
    '.cvp__tete{background:#21324E;color:#fff;padding:22px 32px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}' +
    '.cvp__marque{display:flex;align-items:center;gap:14px}.cvp__tuile{width:46px;height:46px;border-radius:10px;background:#C187A1;display:flex;align-items:center;justify-content:center}' +
    '.cvp__marque b{font-size:15px;letter-spacing:.24em}.cvp__marque i{display:block;width:28px;height:3px;background:#C187A1;border-radius:2px;margin-top:5px}' +
    '.cvp__doc{text-align:right;font-size:12px;color:#C9D1DD}.cvp__doc strong{display:block;color:#fff;font-size:13px;letter-spacing:.08em;text-transform:uppercase}' +
    '.cvp__corps{padding:26px 32px 18px}.cvp__nom{font-size:26px;font-weight:800;color:#21324E;margin:0;line-height:1.2}.cvp__titre{font-size:16px;font-weight:600;color:#784E61;margin:4px 0 0}' +
    '.cvp__meta{color:#5B6475;font-size:12.5px;margin-top:6px}.cvp h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#21324E;margin:22px 0 10px;padding-bottom:5px;border-bottom:2px solid #C187A1}' +
    '.cvp__resume{background:#EEF1F5;border-radius:8px;padding:12px 16px;margin-top:16px}.cvp__chips{display:flex;flex-wrap:wrap;gap:6px}.cvp__chips span{background:#F5EAF0;color:#784E61;border-radius:999px;padding:3px 11px;font-weight:600;font-size:12px}' +
    '.cvp__comp{width:100%;border-collapse:collapse}.cvp__comp th{text-align:left;vertical-align:top;width:30%;padding:4px 10px 4px 0;color:#21324E;font-weight:700}.cvp__comp td{padding:4px 0}' +
    '.cvp__exp{margin-bottom:16px;page-break-inside:avoid;break-inside:avoid}.cvp__exp-tete{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.cvp__exp-tete strong{color:#21324E;font-size:14px}' +
    '.cvp__dates{color:#784E61;font-weight:600;white-space:nowrap;font-size:12.5px}.cvp__ent{color:#5B6475;font-weight:600}.cvp__ctx{font-style:italic;color:#5B6475;margin:4px 0}' +
    '.cvp ul{margin:4px 0;padding-left:18px}.cvp li{margin:2px 0}.cvp__env{font-size:12px;color:#5B6475;margin-top:4px}.cvp__env b{color:#21324E}' +
    '.cvp__2col{display:grid;grid-template-columns:1fr 1fr;gap:0 28px}.cvp__pied{border-top:1px solid #E3E7EE;margin:12px 32px 0;padding:10px 0 16px;font-size:11px;color:#8A93A3;text-align:center}' +
    '@media (max-width:640px){.cvp__corps{padding:20px}.cvp__tete{padding:18px 20px}.cvp__2col{grid-template-columns:1fr}.cvp__comp th{width:40%}}' +
    '@media print{.cvp{box-shadow:none;max-width:none}@page{size:A4;margin:12mm}.cvp__tete{-webkit-print-color-adjust:exact;print-color-adjust:exact}.cvp__resume,.cvp__chips span,.cvp__tuile{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
  function rendre(cv, langue) {
    var l = L[langue] || L.fr;
    var exp = arr(cv.experiences), comp = arr(cv.competences), form = arr(cv.formations), cert = arr(cv.certifications), lang = arr(cv.langues);
    var meta = [cv.annees_experience ? l.ans(Math.round(cv.annees_experience)) : '', lang.map(function (x) { return x.langue + (x.niveau ? ' (' + x.niveau + ')' : ''); }).join(' · ')].filter(Boolean).join('  ·  ');
    return '<article class="cvp">' +
      '<header class="cvp__tete"><div class="cvp__marque"><span class="cvp__tuile"><svg width="34" viewBox="0 0 160 81" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round">' + MONO + '</svg></span><div><b>HT PORTAGE</b><i></i></div></div>' +
      '<div class="cvp__doc"><strong>' + esc(l.doc) + '</strong>' + esc(l.contact) + ' : contact@htportage.fr</div></header>' +
      '<div class="cvp__corps">' +
        '<h1 class="cvp__nom">' + esc(cv.nom_affiche || '') + '</h1><p class="cvp__titre">' + esc(cv.titre || '') + '</p>' + (meta ? '<p class="cvp__meta">' + esc(meta) + '</p>' : '') +
        (cv.resume ? '<div class="cvp__resume">' + esc(cv.resume) + '</div>' : '') +
        (arr(cv.competences_cles).length ? '<h2>' + esc(l.cles) + '</h2><div class="cvp__chips">' + arr(cv.competences_cles).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
        (comp.length ? '<h2>' + esc(l.comp) + '</h2><table class="cvp__comp"><tbody>' + comp.map(function (c) { return '<tr><th scope="row">' + esc(c.categorie) + '</th><td>' + esc(arr(c.elements).join(', ')) + '</td></tr>'; }).join('') + '</tbody></table>' : '') +
        (exp.length ? '<h2>' + esc(l.exp) + '</h2>' + exp.map(function (x) {
          return '<section class="cvp__exp"><div class="cvp__exp-tete"><div><strong>' + esc(x.poste || '') + '</strong><br><span class="cvp__ent">' + esc([x.entreprise, x.secteur, x.lieu].filter(Boolean).join(' · ')) + '</span></div>' +
            '<span class="cvp__dates">' + esc([x.debut, x.fin].filter(Boolean).join(' – ')) + '</span></div>' +
            (x.contexte ? '<p class="cvp__ctx">' + esc(x.contexte) + '</p>' : '') +
            (arr(x.realisations).length ? '<ul>' + arr(x.realisations).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '') +
            (arr(x.environnement).length ? '<p class="cvp__env"><b>' + esc(l.env) + ' :</b> ' + esc(arr(x.environnement).join(', ')) + '</p>' : '') + '</section>';
        }).join('') : '') +
        '<div class="cvp__2col">' +
          (form.length ? '<div><h2>' + esc(l.form) + '</h2><ul>' + form.map(function (f) { return '<li><b>' + esc(f.diplome) + '</b>' + (f.etablissement ? ' — ' + esc(f.etablissement) : '') + (f.annee ? ' (' + esc(f.annee) + ')' : '') + '</li>'; }).join('') + '</ul></div>' : '') +
          (cert.length ? '<div><h2>' + esc(l.certif) + '</h2><ul>' + cert.map(function (c) { return '<li>' + esc(c.nom) + (c.annee ? ' (' + esc(c.annee) + ')' : '') + '</li>'; }).join('') + '</ul></div>' : '') +
          (lang.length ? '<div><h2>' + esc(l.lang) + '</h2><ul>' + lang.map(function (x) { return '<li>' + esc(x.langue) + (x.niveau ? ' — ' + esc(x.niveau) : '') + '</li>'; }).join('') + '</ul></div>' : '') +
        '</div>' +
      '</div><footer class="cvp__pied">' + esc(l.pied) + '</footer></article>';
  }
  function nomFichier(cv, ext) { return 'CV_HT-Portage_' + String(cv.nom_affiche || 'consultant').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.' + ext; }

  function imprimer(cv, langue) {
    var w = window.open('', '_blank');
    if (!w) { alert('Autorisez les fenêtres pour ce site afin d\'enregistrer le PDF.'); return; }
    w.document.write('<!doctype html><html lang="' + (langue === 'en' ? 'en' : 'fr') + '"><head><meta charset="utf-8"><title>' + esc(nomFichier(cv, 'pdf').replace(/\.pdf$/, '')) + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&display=swap" rel="stylesheet"><style>body{margin:0;background:#fff}' + STYLE + '</style></head><body>' + rendre(cv, langue) +
      '<script>document.fonts&&document.fonts.ready.then(function(){setTimeout(function(){window.print()},250)});<\/script></body></html>');
    w.document.close();
  }

  // ---------------------------------------------------------------------
  // Export Word (.docx)
  // ---------------------------------------------------------------------
  async function monogrammePng() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" rx="48" fill="#C187A1"/><g transform="translate(40 87) scale(1)" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round">' + MONO + '</g></svg>';
    var img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    var c = document.createElement('canvas'); c.width = 240; c.height = 240; c.getContext('2d').drawImage(img, 0, 0);
    return await new Promise(function (ok) { c.toBlob(function (b) { b.arrayBuffer().then(ok); }, 'image/png'); });
  }
  async function exporterWord(cv, langue) {
    await charger(LIBS.docx);
    var D = window.docx, l = L[langue] || L.fr;
    var T = function (t, o) { return new D.TextRun(Object.assign({ text: String(t == null ? '' : t), font: 'Calibri' }, o || {})); };
    var P = function (enfants, o) { return new D.Paragraph(Object.assign({ children: enfants, spacing: { after: 80 } }, o || {})); };
    var H = function (t) { return new D.Paragraph({ children: [T(t.toUpperCase(), { bold: true, size: 20, color: C.navy, characterSpacing: 30 })], spacing: { before: 280, after: 120 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 12, color: C.rose, space: 4 } } }); };
    var puce = function (t) { return new D.Paragraph({ children: [T(t, { size: 20 })], bullet: { level: 0 }, spacing: { after: 40 } }); };
    var logo = await monogrammePng();
    var enfants = [];
    var meta = [cv.annees_experience ? l.ans(Math.round(cv.annees_experience)) : '', arr(cv.langues).map(function (x) { return x.langue + (x.niveau ? ' (' + x.niveau + ')' : ''); }).join(' · ')].filter(Boolean).join('  ·  ');
    enfants.push(P([T(cv.nom_affiche || '', { bold: true, size: 44, color: C.navy })], { spacing: { after: 40 } }));
    enfants.push(P([T(cv.titre || '', { bold: true, size: 26, color: C.plum })], { spacing: { after: 40 } }));
    if (meta) enfants.push(P([T(meta, { size: 18, color: C.muted })]));
    if (cv.resume) enfants.push(new D.Paragraph({ children: [T(cv.resume, { size: 20 })], shading: { type: D.ShadingType.CLEAR, fill: C.tint, color: 'auto' }, spacing: { before: 160, after: 120 }, border: { left: { style: D.BorderStyle.SINGLE, size: 18, color: C.rose, space: 8 } } }));
    if (arr(cv.competences_cles).length) { enfants.push(H(l.cles)); enfants.push(P([T(arr(cv.competences_cles).join('  •  '), { bold: true, size: 20, color: C.plum })])); }
    if (arr(cv.competences).length) {
      enfants.push(H(l.comp));
      enfants.push(new D.Table({
        width: { size: 9600, type: D.WidthType.DXA }, columnWidths: [2900, 6700], layout: D.TableLayoutType.FIXED,
        borders: { top: { style: D.BorderStyle.NONE }, bottom: { style: D.BorderStyle.NONE }, left: { style: D.BorderStyle.NONE }, right: { style: D.BorderStyle.NONE }, insideHorizontal: { style: D.BorderStyle.SINGLE, size: 4, color: 'E3E7EE' }, insideVertical: { style: D.BorderStyle.NONE } },
        rows: arr(cv.competences).map(function (c) {
          return new D.TableRow({ children: [
            new D.TableCell({ width: { size: 2900, type: D.WidthType.DXA }, children: [P([T(c.categorie, { bold: true, size: 20, color: C.navy })], { spacing: { before: 40, after: 40 } })] }),
            new D.TableCell({ width: { size: 6700, type: D.WidthType.DXA }, children: [P([T(arr(c.elements).join(', '), { size: 20 })], { spacing: { before: 40, after: 40 } })] })
          ] });
        })
      }));
    }
    if (arr(cv.experiences).length) {
      enfants.push(H(l.exp));
      arr(cv.experiences).forEach(function (x) {
        enfants.push(new D.Paragraph({ children: [T(x.poste || '', { bold: true, size: 22, color: C.navy }), T('\t' + [x.debut, x.fin].filter(Boolean).join(' – '), { bold: true, size: 19, color: C.plum })], tabStops: [{ type: D.TabStopType.RIGHT, position: 9600 }], spacing: { before: 160, after: 20 }, keepNext: true }));
        var ent = [x.entreprise, x.secteur, x.lieu].filter(Boolean).join(' · ');
        if (ent) enfants.push(P([T(ent, { bold: true, size: 19, color: C.muted })], { keepNext: true, spacing: { after: 40 } }));
        if (x.contexte) enfants.push(P([T(x.contexte, { italics: true, size: 19, color: C.muted })]));
        arr(x.realisations).forEach(function (r) { enfants.push(puce(r)); });
        if (arr(x.environnement).length) enfants.push(P([T(l.env + ' : ', { bold: true, size: 18, color: C.navy }), T(arr(x.environnement).join(', '), { size: 18, color: C.muted })], { spacing: { before: 40, after: 80 } }));
      });
    }
    if (arr(cv.formations).length) { enfants.push(H(l.form)); arr(cv.formations).forEach(function (f) { enfants.push(new D.Paragraph({ children: [T(f.diplome, { bold: true, size: 20 }), T((f.etablissement ? ' — ' + f.etablissement : '') + (f.annee ? ' (' + f.annee + ')' : ''), { size: 20 })], bullet: { level: 0 }, spacing: { after: 40 } })); }); }
    if (arr(cv.certifications).length) { enfants.push(H(l.certif)); arr(cv.certifications).forEach(function (c) { enfants.push(puce(c.nom + (c.annee ? ' (' + c.annee + ')' : ''))); }); }
    if (arr(cv.langues).length) { enfants.push(H(l.lang)); arr(cv.langues).forEach(function (x) { enfants.push(puce(x.langue + (x.niveau ? ' — ' + x.niveau : ''))); }); }

    var entete = new D.Header({ children: [new D.Paragraph({
      children: [new D.ImageRun({ data: logo, transformation: { width: 30, height: 30 } }), T('   HT PORTAGE', { bold: true, size: 22, color: C.navy, characterSpacing: 60 }), T('\t' + l.doc.toUpperCase() + '  ·  contact@htportage.fr', { size: 16, color: C.muted })],
      tabStops: [{ type: D.TabStopType.RIGHT, position: 9600 }],
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: C.rose, space: 6 } }
    })] });
    var pied = new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [T(l.pied, { size: 15, color: '8A93A3' })] })] });
    var doc = new D.Document({
      creator: 'HT Portage', title: 'CV ' + (cv.nom_affiche || ''),
      styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
      numbering: undefined,
      sections: [{ properties: { page: { margin: { top: 1000, bottom: 900, left: 1000, right: 1000 } } }, headers: { default: entete }, footers: { default: pied }, children: enfants }]
    });
    var blob = await D.Packer.toBlob(doc);
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nomFichier(cv, 'docx');
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------------------------------------------------------------------
  // Interface
  // ---------------------------------------------------------------------
  var api = {};
  api.monter = function (racine, opts) {
    opts = opts || {};
    if (!document.getElementById('cvp-style')) { var st = document.createElement('style'); st.id = 'cvp-style'; st.textContent = STYLE; document.head.appendChild(st); }
    racine.innerHTML =
      '<form class="box cvf" novalidate>' +
        '<div class="grid-form">' +
          '<div class="field full"><label for="cvf-fichier">CV à convertir <span class="hint">(PDF ou Word, 6 Mo max.)</span></label><input class="input" id="cvf-fichier" name="fichier" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="padding:9px 12px">' +
            '<p class="small cvf-source" hidden style="font-size:14px;margin:6px 0 0"></p></div>' +
          '<div class="field"><label for="cvf-langue">Langue du CV</label><select class="select" id="cvf-langue" name="langue"><option value="fr">Français</option><option value="en">Anglais</option></select></div>' +
          '<div class="field"><label for="cvf-offre">Adapter à une mission <span class="hint">(facultatif)</span></label><select class="select" id="cvf-offre" name="offre"><option value="">Non : CV général</option><option value="__autre">Coller un descriptif de mission…</option></select></div>' +
          '<div class="field full" data-cvf-desc hidden><label for="cvf-desc">Descriptif de la mission</label><textarea class="textarea" id="cvf-desc" name="desc" maxlength="8000" placeholder="Collez la fiche de poste ou le besoin du client"></textarea></div>' +
          '<div class="field full"><label class="check"><input type="checkbox" name="anonyme">Anonymiser (initiales à la place du nom)</label>' +
            '<label class="check"><input type="checkbox" name="masquer_clients">Masquer le nom des entreprises et des clients</label></div>' +
          '<div class="field full"><details><summary class="small" style="cursor:pointer;font-weight:600">Consignes supplémentaires (facultatif)</summary><textarea class="textarea" name="consignes" maxlength="1500" style="margin-top:8px;min-height:70px" placeholder="Ex. : mettre en avant l\'expérience bancaire, 2 pages maximum"></textarea></details></div>' +
        '</div>' +
        '<div class="actions-row"><p class="form-status" role="status" aria-live="polite"></p><button class="btn btn--dark" type="submit">Convertir au format HT Portage</button></div>' +
        '<p class="small" style="font-size:13px;margin:4px 0 0">Le CV est analysé par une intelligence artificielle (Claude, Anthropic) qui reprend uniquement les informations qu\'il contient. Relisez toujours le résultat avant de l\'envoyer.</p>' +
      '</form>' +
      '<div class="cv-resultat" hidden>' +
        '<div class="toolbar cv-actions" style="justify-content:space-between;margin:20px 0 12px"><div class="toolbar"><button class="btn btn--dark btn--sm" type="button" data-cv="word">Télécharger en Word</button><button class="btn btn--light btn--sm" type="button" data-cv="pdf">Enregistrer en PDF</button></div><button class="btn btn--light btn--sm" type="button" data-cv="nouveau">Nouvelle conversion</button></div>' +
        '<div class="cv-adequation"></div>' +
        '<div class="cv-apercu"></div>' +
      '</div>' +
      '<div class="box cv-historique" hidden style="margin-top:24px"><h2 class="box__title" style="font-size:16px">' + (opts.admin ? 'Dernières conversions' : 'Mes CV convertis') + '</h2><div class="cv-liste"></div></div>';

    var f = racine.querySelector('form'), st = f.querySelector('.form-status'), res = racine.querySelector('.cv-resultat');
    var selOffre = f.offre, desc = racine.querySelector('[data-cvf-desc]');
    var offres = [], courant = null, candidature = null;

    db.from('missions').select('ref, titre, domaine, resume, lieu, duree, rythme, tjm').eq('publiee', true).order('created_at', { ascending: false }).then(function (r) {
      offres = r.data || [];
      offres.forEach(function (o) { var op = document.createElement('option'); op.value = o.ref; op.textContent = o.ref + ' — ' + o.titre; selOffre.insertBefore(op, selOffre.lastElementChild); });
    });
    selOffre.addEventListener('change', function () { desc.hidden = selOffre.value !== '__autre'; });
    f.fichier.addEventListener('change', function () { candidature = null; racine.querySelector('.cvf-source').hidden = true; });

    function afficher(cv, langue, adequationVisible) {
      courant = { cv: cv, langue: langue };
      res.hidden = false;
      racine.querySelector('.cv-apercu').innerHTML = rendre(cv, langue);
      var a = cv.adequation, ad = racine.querySelector('.cv-adequation');
      ad.innerHTML = a && adequationVisible !== false && (a.synthese || arr(a.points_forts).length) ?
        '<div class="alerte alerte--info" style="margin-bottom:16px"><strong>Adéquation avec la mission' + (a.score != null ? ' : ' + Math.round(a.score) + ' / 100' : '') + '</strong>' +
          (a.synthese ? '<span>' + esc(a.synthese) + '</span>' : '') +
          (arr(a.points_forts).length ? '<span><b>Points forts :</b> ' + esc(arr(a.points_forts).join(' · ')) + '</span>' : '') +
          (arr(a.points_a_verifier).length ? '<span><b>À vérifier :</b> ' + esc(arr(a.points_a_verifier).join(' · ')) + '</span>' : '') +
          '<span class="small">Analyse interne : elle ne figure pas dans le CV téléchargé.</span></div>' : '';
      res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    racine.querySelector('.cv-actions').addEventListener('click', async function (e) {
      var b = e.target.closest('[data-cv]'); if (!b || !courant) return;
      if (b.dataset.cv === 'pdf') return imprimer(courant.cv, courant.langue);
      if (b.dataset.cv === 'nouveau') { res.hidden = true; f.reset(); desc.hidden = true; candidature = null; racine.querySelector('.cvf-source').hidden = true; f.scrollIntoView({ behavior: 'smooth' }); return; }
      if (b.dataset.cv === 'word') {
        b.disabled = true; var t = b.textContent; b.textContent = 'Préparation…';
        try { await exporterWord(courant.cv, courant.langue); } catch (err) { console.error(err); alert('Le fichier Word n\'a pas pu être créé : ' + err.message); }
        b.disabled = false; b.textContent = t;
      }
    });

    async function base64(buf) {
      var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return btoa(s);
    }
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var file = f.fichier.files[0], corps = {};
      var langue = f.langue.value;
      var offreTexte = '', offreRef = null;
      if (selOffre.value === '__autre') { offreTexte = f.desc.value.trim(); if (offreTexte.length < 40) { E.setStatus(st, 'Collez le descriptif de la mission (quelques lignes au moins).', 'error'); return; } }
      else if (selOffre.value) { var o = offres.find(function (x) { return x.ref === selOffre.value; }); if (o) { offreRef = o.ref; offreTexte = [o.titre, o.domaine, [o.lieu, o.duree, o.rythme].filter(Boolean).join(' · '), o.resume].filter(Boolean).join('\n'); } }
      corps.options = { langue: langue, anonyme: f.anonyme.checked, masquer_clients: f.masquer_clients.checked, offre_ref: offreRef, offre_texte: offreTexte || undefined, consignes: f.consignes.value.trim() || undefined };
      var bouton = f.querySelector('[type=submit]');
      try {
        if (file) {
          if (file.size > 6 * 1024 * 1024) { E.setStatus(st, 'Le CV dépasse 6 Mo.', 'error'); return; }
          if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') corps.fichier = { nom: file.name, type: 'application/pdf', base64: await base64(await file.arrayBuffer()) };
          else if (/\.docx$/i.test(file.name)) { await charger(LIBS.mammoth); corps.texte = (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; corps.nom = file.name; }
          else { E.setStatus(st, 'Format accepté : PDF ou Word (.docx). Un ancien .doc doit d\'abord être enregistré en .docx.', 'error'); return; }
        } else if (candidature) {
          if (/\.pdf$/i.test(candidature.cv_path)) corps.candidature_id = candidature.id;
          else {
            var u = await db.storage.from('cv').createSignedUrl(candidature.cv_path, 120);
            if (u.error) throw new Error('CV de la candidature introuvable.');
            await charger(LIBS.mammoth);
            corps.texte = (await window.mammoth.extractRawText({ arrayBuffer: await (await fetch(u.data.signedUrl)).arrayBuffer() })).value; corps.nom = candidature.cv_path.split('/').pop();
          }
        } else { E.setStatus(st, 'Choisissez un CV (PDF ou Word).', 'error'); f.fichier.focus(); return; }
      } catch (err) { E.setStatus(st, 'Lecture du fichier impossible : ' + err.message, 'error'); return; }

      bouton.disabled = true;
      var etapes = ['Lecture du CV…', 'Analyse des expériences et des compétences…', corps.options.offre_texte ? 'Adaptation à la mission…' : 'Mise au format HT Portage…', 'Finalisation…'], k = 0;
      E.setStatus(st, etapes[0]);
      var minuteur = setInterval(function () { k = Math.min(k + 1, etapes.length - 1); E.setStatus(st, etapes[k]); }, 9000);
      var r = await db.functions.invoke('cv', { body: corps });
      clearInterval(minuteur); bouton.disabled = false;
      var d = r.data; if (r.error) { try { d = await r.error.context.json(); } catch (x) { d = null; } }
      if (!d || !d.cv) { E.setStatus(st, (d && d.erreur) || 'La conversion a échoué. Réessayez dans un instant.', 'error'); return; }
      E.setStatus(st, 'CV converti. Relisez-le, puis téléchargez-le en Word ou en PDF.', 'ok');
      afficher(d.cv, langue);
      historique();
    });

    async function historique() {
      var q = db.from('cvs').select('id, cree_le, candidat_nom, source_nom, offre_ref, options, donnees').order('cree_le', { ascending: false }).limit(opts.admin ? 50 : 10);
      if (!opts.admin && E.state) q = q.eq('user_id', E.state.user.id);
      var h = await q;
      var box = racine.querySelector('.cv-historique');
      if (h.error || !(h.data || []).length) { box.hidden = true; return; }
      box.hidden = false;
      box.querySelector('.cv-liste').innerHTML = '<ul class="list">' + h.data.map(function (x) {
        var o = x.options || {};
        return '<li data-id="' + x.id + '"><span class="list__main"><strong>' + esc((opts.admin ? (x.candidat_nom || x.source_nom || 'CV') : (x.donnees && x.donnees.titre) || x.source_nom || 'CV')) + '</strong><span>' +
          esc([E.date(x.cree_le), o.langue === 'en' ? 'anglais' : 'français', o.anonyme ? 'anonymisé' : '', x.offre_ref ? 'adapté à ' + x.offre_ref : (o.offre ? 'adapté à une mission' : '')].filter(Boolean).join(' · ')) + '</span></span>' +
          '<span class="row-actions"><button class="link-btn" type="button" data-ouvrir>Ouvrir</button><button class="icon-suppr" type="button" data-suppr>Supprimer</button></span></li>';
      }).join('') + '</ul>';
      box.querySelectorAll('[data-ouvrir]').forEach(function (b) {
        b.addEventListener('click', function () { var x = h.data.find(function (y) { return y.id === b.closest('li').dataset.id; }); afficher(x.donnees, (x.options || {}).langue || 'fr'); });
      });
      box.querySelectorAll('[data-suppr]').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('Supprimer ce CV converti ?')) return;
          var rs = await db.from('cvs').delete().eq('id', b.closest('li').dataset.id);
          if (rs.error) { alert(E.errText(rs.error)); return; }
          historique();
        });
      });
    }
    historique();

    // Conversion du CV d'une candidature (administration)
    racine.depuisCandidature = function (c) {
      candidature = c; f.reset(); desc.hidden = true; res.hidden = true;
      var src = racine.querySelector('.cvf-source');
      src.hidden = false; src.innerHTML = 'CV de la candidature de <strong>' + esc(c.nom || '') + '</strong> sélectionné (' + esc(String(c.cv_path || '').split('/').pop()) + '). Choisissez vos options puis lancez la conversion.';
      if (c.mission_ref && offres.some(function (o) { return o.ref === c.mission_ref; })) selOffre.value = c.mission_ref;
      E.setStatus(st, '');
      f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    return racine;
  };
  api.rendre = rendre;
  window.HTP_CV = api;
})();
