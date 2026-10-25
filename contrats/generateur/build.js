// Génère les modèles CDI et Annexe 1 aux couleurs HT Portage.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, AlignmentType, BorderStyle, Bookmark, InternalHyperlink, PageBreak,
  Table, TableRow, TableCell, WidthType, ShadingType, TabStopType, LevelFormat, PageNumber,
  VerticalAlign, TableLayoutType, Tab, PositionalTab, PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader
} = require('docx');

const C = { navy: '21324E', navy7: '304870', rose: 'C187A1', rose50: 'F3E6EC', plum: '784E61', slate: '435B7B', ink: '1B1C1C', muted: '4A5468', bg: 'F1F4F7', line: 'D7D7D7' };
const FONT = 'Open Sans';
const MODELE = process.env.MODE === 'modele'; // modele = balises [[champ]] + ancres de signature Yousign
const TUILE = fs.readFileSync(__dirname + '/logo/tuile.png');
const MONO_BLANC = fs.readFileSync(__dirname + '/logo/HT-Portage_monogramme_blanc.png');
const W = 9638; // largeur utile A4 avec marges de 2 cm (11906 - 2*1134)
const BLANC = '……………………………';
const BLANC_COURT = '………………';

// ---------- Briques ----------
function run(t, o) { return new TextRun(Object.assign({ text: t, font: FONT }, o || {})); }
// Texte avec **gras** et ‹champ› (blanc à compléter)
function runs(txt, base) {
  const out = [];
  txt.split(/(\*\*[^*]+\*\*|‹[^›]*›)/).forEach(part => {
    if (!part) return;
    if (part.startsWith('**')) out.push(run(part.slice(2, -2), Object.assign({ bold: true }, base)));
    else if (part.startsWith('‹')) out.push(MODELE ? run('[[' + part.slice(1, -1) + ']]', base) : run(BLANC, Object.assign({}, base, { color: C.slate })));
    else out.push(run(part, base));
  });
  return out;
}
function p(txt, o) {
  o = o || {};
  return new Paragraph({
    children: runs(txt, o.run), alignment: o.align || AlignmentType.JUSTIFIED,
    spacing: { after: o.after == null ? 120 : o.after, before: o.before || 0, line: 276 }, keepNext: o.keepNext, indent: o.indent
  });
}
// Registre des articles (pour le sommaire) et numéros de page calculés au passage précédent
let REG = [], DOC = '';
let PAGES = {};
try { PAGES = JSON.parse(fs.readFileSync(__dirname + '/pages.json', 'utf8')); } catch (e) { PAGES = {}; }
function article(num, titre) {
  const id = DOC + '_' + (num || 'pre');
  REG.push({ id, num, titre });
  return new Paragraph({
    keepNext: true, keepLines: true, spacing: { before: 300, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.rose, space: 4 } },
    children: [new Bookmark({ id, children: [
      run(num ? 'ARTICLE ' + num + '  ' : '', { bold: true, color: C.plum, size: 18, characterSpacing: 20 }),
      run(titre.toUpperCase(), { bold: true, color: C.navy, size: 21, characterSpacing: 10 })
    ] })]
  });
}
function sommaire(liste, o) {
  o = o || {};
  const out = [new Paragraph({ spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.rose, space: 6 } },
    children: [run('SOMMAIRE', { bold: true, size: o.grand ? 26 : 21, color: C.navy, characterSpacing: 40 })] })];
  liste.forEach(a => {
    const page = String(PAGES[a.id] || '00');
    out.push(new Paragraph({
      spacing: { after: o.grand ? 110 : 50 }, tabStops: [{ type: TabStopType.RIGHT, position: o.w || W, leader: 'dot' }],
      children: [new InternalHyperlink({ anchor: a.id, children: [
        run(a.num ? 'Article ' + a.num : '', { bold: true, color: C.plum, size: o.grand ? 19 : 17 }),
        run((a.num ? '   ' : '') + a.titre, { color: C.ink, size: o.grand ? 19 : 17 }),
        new TextRun({ font: FONT, color: 'A7B3C6', children: [new Tab()] }),
        run(page, { bold: true, color: C.navy, size: o.grand ? 19 : 17 })
      ] })]
    }));
  });
  return out;
}
function puce(txt) {
  return new Paragraph({ numbering: { reference: 'puces', level: 0 }, children: runs(txt), alignment: AlignmentType.JUSTIFIED, spacing: { after: 80, line: 276 } });
}
// Ligne de formulaire : « Libellé : ……… » jusqu'à la marge droite
function champ(label, o) {
  o = o || {};
  const larg = o.w || W;
  if (MODELE && o.tag) return new Paragraph({ spacing: { after: o.after == null ? 100 : o.after, line: 276 },
    children: [run(label ? label + ' ' : '', { color: C.ink, bold: !!o.bold }), run('[[' + o.tag + ']]', { color: C.ink })] });
  if (MODELE && !o.tag && !label) return new Paragraph({ spacing: { after: 0 }, children: [] });
  return new Paragraph({
    spacing: { after: o.after == null ? 100 : o.after, line: 276 },
    tabStops: [{ type: TabStopType.RIGHT, position: larg, leader: 'dot' }],
    children: [run(label ? label + ' ' : '', { color: C.ink, bold: !!o.bold }), new TextRun({ font: FONT, color: 'A7B3C6', children: [new Tab()] })]
  });
}
function lignesVides(n, tag) { if (MODELE) return [p('‹' + tag + '›', { after: 120 })]; const a = []; for (let i = 0; i < n; i++) a.push(champ('', { after: 120 })); return a; }
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
function cell(children, width, o) {
  o = o || {};
  return new TableCell({
    children, width: { size: width, type: WidthType.DXA }, verticalAlign: o.v || VerticalAlign.TOP,
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    margins: { top: o.pad || 140, bottom: o.pad || 140, left: 180, right: 180 },
    borders: o.borders || noBorders, columnSpan: o.span
  });
}
function etiquette(t, color) { return new Paragraph({ spacing: { after: 80 }, children: [run(t.toUpperCase(), { bold: true, size: 16, color: color || C.plum, characterSpacing: 30 })] }); }

// Bloc titre marine
function titre(sur, l1, l2) {
  const ch = [
    new Paragraph({ spacing: { after: 60 }, children: [run(sur.toUpperCase(), { bold: true, size: 16, color: C.rose, characterSpacing: 40 })] }),
    new Paragraph({ spacing: { after: l2 ? 0 : 40 }, children: [run(l1, { bold: true, size: 34, color: 'FFFFFF' })] })
  ];
  if (l2) ch.push(new Paragraph({ spacing: { after: 40 }, children: [run(l2, { bold: true, size: 34, color: C.rose })] }));
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [W], layout: TableLayoutType.FIXED,
    rows: [new TableRow({ children: [cell(ch, W, { fill: C.navy, pad: 320 })] })]
  });
}

// Encadré de signature
function signatures(blocs) {
  const w = Math.floor(W / blocs.length);
  const widths = blocs.map((_, i) => i === blocs.length - 1 ? W - w * (blocs.length - 1) : w);
  const bord = { top: { style: BorderStyle.SINGLE, size: 6, color: C.line }, bottom: { style: BorderStyle.SINGLE, size: 6, color: C.line }, left: { style: BorderStyle.SINGLE, size: 6, color: C.line }, right: { style: BorderStyle.SINGLE, size: 6, color: C.line } };
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    rows: [new TableRow({
      cantSplit: true,
      children: blocs.map((b, i) => cell([
        etiquette(b.titre),
        ...b.lignes.map(l => new Paragraph({ spacing: { after: 40 }, children: runs(l, { size: 18, color: C.muted }) })),
        ...Array.from({ length: 3 - b.lignes.length }, () => new Paragraph({ spacing: { after: 40 }, children: [run(' ', { size: 18 })] })),
        MODELE && b.ancre
          ? new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: b.ancre, font: 'Arial', size: 20, color: 'FFFFFF' })] })
          : new Paragraph({ spacing: { before: 1100 }, children: [run('Signature', { size: 16, color: 'A7B3C6' })] })
      ], widths[i], { borders: bord, pad: 200 }))
    })]
  });
}

function entete(docTitre) {
  return new Header({
    children: [new Paragraph({
      spacing: { after: 0 }, tabStops: [{ type: TabStopType.RIGHT, position: W }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.line, space: 8 } },
      children: [
        run('HT PORTAGE', { bold: true, size: 17, color: C.navy, characterSpacing: 60 }),
        run('   ·   ' + docTitre, { size: 15, color: C.muted }),
        new TextRun({ font: FONT, children: [new Tab()] }),
        new ImageRun({ type: 'png', data: TUILE, transformation: { width: 34, height: 34 }, altText: { title: 'HT Portage', description: 'Monogramme HT Portage', name: 'monogramme' } })
      ]
    })]
  });
}
function piedDePage(avecGarde) {
  return new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.line, space: 6 } }, spacing: { after: 0 }, tabStops: [{ type: TabStopType.RIGHT, position: W }],
        children: [
          run('HT Portage · capital de 100 000 € · RCS Nanterre 993 218 007 · 34 rue Pasteur, 92270 Bois-Colombes · htportage.fr', { size: 13, color: C.muted }),
          new TextRun({ font: FONT, children: [new Tab()] }),
          new TextRun({ font: FONT, size: 14, color: C.navy, bold: true, children: ['Page ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES] })
        ]
      }),
      new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 40 }, children: [run('Paraphes :  ……………  ……………', { size: 14, color: C.muted })] })
    ]
  });
}

const PAGE = { size: { width: 11906, height: 16838 }, margin: { top: 1500, bottom: 1300, left: 1134, right: 1134, header: 560, footer: 480 } };
function document(docTitre, enfants, garde) {
  const sections = [];
  if (garde) sections.push({
    properties: { page: { size: PAGE.size, margin: { top: 1134, bottom: 1000, left: 1134, right: 1134, header: 400, footer: 400 } } },
    headers: { default: new Header({ children: [new Paragraph({ children: [] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ children: [] })] }) },
    children: garde
  });
  sections.push({
    properties: { page: PAGE },
    headers: { default: entete(docTitre) }, footers: { default: piedDePage(!!garde) },
    children: enfants
  });
  return new Document({
    creator: 'HT Portage', title: docTitre,
    styles: { default: { document: { run: { font: FONT, size: 19, color: C.ink } } } },
    numbering: { config: [{ reference: 'puces', levels: [{ level: 0, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 280 } }, run: { color: C.plum } } }] }] },
    sections
  });
}

// Page de garde
function pageDeGarde(o) {
  const bloc = new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [W], layout: TableLayoutType.FIXED,
    rows: [new TableRow({ height: { value: 9200, rule: 'atLeast' }, children: [new TableCell({
      width: { size: W, type: WidthType.DXA }, verticalAlign: VerticalAlign.BOTTOM, borders: noBorders,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.navy }, margins: { top: 700, bottom: 700, left: 700, right: 700 },
      children: [
        new Paragraph({ spacing: { after: 2200 }, children: [new ImageRun({ type: 'png', data: MONO_BLANC, transformation: { width: 150, height: 76 }, altText: { title: 'HT Portage', description: 'Monogramme HT Portage', name: 'monogramme-garde' } })] }),
        new Paragraph({ spacing: { after: 160 }, children: [run(o.sur.toUpperCase(), { bold: true, size: 18, color: C.rose, characterSpacing: 60 })] }),
        ...o.l1.map(t => new Paragraph({ spacing: { after: 0 }, children: [run(t, { bold: true, size: 52, color: 'FFFFFF' })] })),
        new Paragraph({ spacing: { after: 360 }, children: [run(o.l2, { bold: true, size: 52, color: C.rose })] }),
        new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 6, color: C.rose, space: 12 } }, spacing: { after: 0 }, children: [run(o.note, { size: 18, color: 'D9E0EA' })] })
      ]
    })] })]
  });
  // Encadrés des parties (2 ou 3 colonnes)
  const n = o.parties.length, gap = 100;
  const cw = Math.floor((W - gap * (n - 1)) / n);
  const widths = [], cells = [];
  o.parties.forEach((pa, i) => {
    if (i) { widths.push(gap); cells.push(cell([new Paragraph({ children: [] })], gap)); }
    const w = i === n - 1 ? W - (cw + gap) * (n - 1) : cw;
    widths.push(w);
    const kids = [etiquette(pa.label)];
    if (pa.nom) kids.push(p('**' + pa.nom + '**', { align: AlignmentType.LEFT, after: 40, run: { size: 22, color: C.navy } }));
    if (pa.champ) kids.push(champ(pa.champ, { w: w - 360, after: 40, tag: pa.tag }));
    if (pa.note) kids.push(p(pa.note, { align: AlignmentType.LEFT, after: 0, run: { color: C.muted } }));
    cells.push(cell(kids, w, { fill: C.bg, pad: 220 }));
  });
  const parties = new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: [new TableRow({ children: cells })] });
  return [
    new Paragraph({ spacing: { after: 400 }, tabStops: [{ type: TabStopType.RIGHT, position: W }], children: [
      run('HT PORTAGE', { bold: true, size: 20, color: C.navy, characterSpacing: 80 }),
      new TextRun({ font: FONT, children: [new Tab()] }),
      run('Document confidentiel', { size: 16, color: C.muted })
    ] }),
    bloc,
    new Paragraph({ spacing: { after: 320 }, children: [] }),
    parties,
    new Paragraph({ spacing: { after: 200 }, children: [] }),
    ...o.champs.map(c => champ(c[0], { bold: true, after: 160, tag: c[1] })),
    new Paragraph({ spacing: { before: 500 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.line, space: 8 } }, children: [
      run('HT Portage · capital de 100 000 € · RCS Nanterre 993 218 007 · 34 rue Pasteur, 92270 Bois-Colombes · htportage.fr · contact@htportage.fr', { size: 14, color: C.muted })
    ] })
  ];
}

// =====================================================================
// CDI
// =====================================================================
const partiesCDI = new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [4769, 100, 4769], layout: TableLayoutType.FIXED,
  rows: [new TableRow({ children: [
    cell([
      etiquette("L'entreprise de portage salarial"),
      p('La société **HT Portage**, au capital de 100 000,00 euros, immatriculée au Registre du Commerce et des Sociétés de Nanterre sous le numéro 993 218 007, dont le siège social est situé 34 rue Pasteur, 92270 Bois-Colombes,', { align: AlignmentType.LEFT }),
      p('représentée par SARL Wadi ESSAFI, en sa qualité de Président,', { align: AlignmentType.LEFT }),
      p('ci-après dénommée « l’Entreprise de Portage Salarial » ou « l’EPS »,', { align: AlignmentType.LEFT, after: 0 })
    ], 4769, { fill: C.bg }),
    cell([new Paragraph({ children: [] })], 100),
    cell([
      etiquette('Le salarié porté'),
      p(MODELE ? '[[case_m]] Monsieur    [[case_mme]] Madame' : '☐ Monsieur    ☐ Madame', { align: AlignmentType.LEFT, after: 100 }),
      champ('Nom et prénom :', { w: 4409, tag: 'salarie_nom' }), champ('Né(e) le :', { w: 4409, tag: 'date_naissance' }), champ('à :', { w: 4409, tag: 'lieu_naissance' }), champ('Nationalité :', { w: 4409, tag: 'nationalite' }),
      champ('Demeurant :', { w: 4409, tag: 'adresse' }), champ('', { w: 4409, tag: MODELE ? 'adresse_ville' : undefined }), champ('N° de sécurité sociale :', { w: 4409, tag: 'num_secu' }),
      p('ci-après dénommé(e) « le Salarié porté ».', { align: AlignmentType.LEFT, after: 0 })
    ], 4769, { fill: C.bg })
  ] })]
});

DOC = 'cdi'; REG = [];
const cdi = [
  titre('Contrat de travail · portage salarial', 'Contrat de travail en portage salarial', 'à durée indéterminée'),
  p('', { after: 120 }),
  new Paragraph({ spacing: { after: 160 }, children: [run('ENTRE LES SOUSSIGNÉS', { bold: true, color: C.navy, size: 20, characterSpacing: 20 })] }),
  partiesCDI,
  p('L’EPS et le Salarié porté sont ci-après dénommés ensemble les « Parties ».', { before: 160 }),

  article('', 'Préambule'),
  p('L’EPS est une entreprise exerçant l’activité de portage salarial au sens des articles L.1254-1 et suivants du Code du travail. Elle relève de la Convention collective de branche des salariés en portage salarial (IDCC 3219).'),
  p('Le Salarié porté est un professionnel autonome exerçant son activité dans le cadre du portage salarial. Il justifie d’une expertise lui permettant de rechercher ses clients et de négocier ses prestations.'),

  article(1, 'Engagement'),
  p('Le Salarié porté est engagé en qualité de **Consultant**, statut cadre, à compter du ‹date_effet›.'),

  article(2, 'Droits et obligations'),
  p('Conformément à l’article L.1254-2, III du Code du travail, l’EPS n’est pas tenue de fournir du travail au Salarié porté. En conséquence, le Salarié porté s’engage à rechercher activement de nouvelles prestations, sans attendre la fin de la mission en cours.'),
  p('En cas d’absence de prestation, le contrat de travail est maintenu dans les conditions prévues par la législation et la convention collective applicable, sans garantie de rémunération en l’absence d’activité.'),
  p('Si, à l’issue d’une période continue de trois (3) mois sans prestation, aucune nouvelle mission n’a été conclue, cette situation caractérise une absence durable d’activité. L’EPS pourra alors engager une procédure de rupture du contrat de travail conformément aux dispositions légales et conventionnelles en vigueur, cette absence prolongée d’activité constituant un motif réel et sérieux. Le Salarié porté conserve la faculté de solliciter toute autre modalité de rupture du contrat de travail.'),
  p('Le Salarié porté est informé que chaque prestation :', { keepNext: true }),
  puce('ne peut avoir pour objet que l’exécution d’une tâche occasionnelle ne relevant pas de l’activité normale et permanente de l’entreprise cliente, ou une prestation ponctuelle nécessitant une expertise dont elle ne dispose pas ;'),
  puce('ne peut avoir pour objet ni de remplacer un salarié dont le contrat de travail est suspendu à la suite d’un conflit collectif de travail, ni d’effectuer certains travaux particulièrement dangereux figurant sur la liste prévue à l’article L.4154-1 du Code du travail, sauf dérogation prévue au même article ;'),
  puce('ne peut excéder une durée de trente-six (36) mois ;'),
  puce('ne peut avoir pour objet les activités de services à la personne mentionnées à l’article L.7231-1 du Code du travail.'),
  p('Le Salarié porté convient avec chaque entreprise cliente des conditions d’exécution de la prestation, de son prix et de ses modalités de paiement. Le prix doit lui permettre de percevoir la rémunération minimale définie à l’article 21.3 de la convention collective applicable, pour le nombre d’heures de travail nécessaires à l’accomplissement de la prestation. Cette rémunération minimale intègre le salaire de base, l’indemnité mensuelle de congés payés et la prime d’apport d’affaires ; s’y ajoute la réserve financière définie au même article.', { before: 80 }),
  p('Le Salarié porté s’engage à fournir à l’EPS tous les éléments permettant d’établir chaque contrat commercial de prestation de portage salarial. L’EPS peut refuser un contrat commercial si un ou plusieurs éléments transmis ou omis ne permettent pas sa mise en place conformément aux dispositions légales ou conventionnelles, ou si les conditions négociées lui font prendre un risque qu’elle ne peut assumer.'),
  p('Le Salarié porté s’engage à fournir un compte-rendu d’activité écrit au moins une fois par mois, comme indiqué à l’article 4, et à mener à son terme chaque prestation selon les termes et conditions du contrat commercial qu’il a négocié.'),
  p('Il s’engage à informer l’EPS de toute difficulté rencontrée dans la réalisation d’une prestation, notamment de tout événement susceptible d’en compromettre l’exécution ou la facturation. En cas de renégociation du prix avec l’entreprise cliente, il en informe l’EPS dans les 48 heures afin de lui permettre d’établir, le cas échéant, un avenant au contrat commercial.'),
  p('L’EPS est assurée pour les dommages provoqués par le Salarié porté dans l’entreprise cliente pendant l’exécution de la prestation.'),

  article(3, 'Compétences'),
  p('Le Salarié porté dispose des compétences et domaines d’expertise suivants, tels que définis par la convention collective, en adéquation avec les prestations :', { keepNext: true }),
  ...lignesVides(2, 'competences'),
  p('Ces compétences s’accompagnent nécessairement d’une autonomie dans la négociation des prestations avec la ou les entreprises clientes et dans leur exécution.', { before: 80 }),

  article(4, 'Compte-rendu d’activité'),
  p('Le Salarié porté rend compte fidèlement de son activité par un compte-rendu d’activité (CRA) écrit, établi au moins une fois par mois pour chaque prestation réalisée. Ce compte-rendu, qui doit être approuvé par l’EPS, comporte notamment les dates et la durée d’exécution de chaque prestation. Il permet à l’EPS d’établir le bulletin de paie et d’exercer un suivi et un contrôle précis de l’activité.'),

  article(5, 'Durée du travail'),
  p('Le Salarié porté organise son activité en fonction des exigences des missions et s’adapte aux contraintes et horaires du client final, dans le respect des dispositions légales relatives à la durée du travail et aux temps de repos.'),
  p('La durée de travail de référence est fixée à 35 heures hebdomadaires. Le volume d’activité est apprécié en nombre de jours travaillés, dans la limite de 218 jours par an, hors périodes d’astreinte. Des périodes d’astreinte peuvent être mises en place selon les besoins des missions.'),
  p('Le CRA mensuel constitue un élément déclaratif servant de base à la facturation et à la paie ; il ne modifie pas le contrat de travail. Il indique la répartition de la durée du travail sur les jours de la semaine, laquelle peut évoluer selon les semaines ou les mois à l’initiative du Salarié porté, sans délai de prévenance.'),
  p('À son initiative, le Salarié porté peut modifier la durée du travail et la répartition de l’horaire pour les besoins d’une prestation, compte tenu de l’autonomie dont il bénéficie, dans le respect des durées maximales de travail journalières et hebdomadaires définies par le Code du travail.'),
  p('Le Salarié porté bénéficie chaque année d’un entretien annuel avec l’EPS, conformément à l’article 26 de la convention collective.'),

  article(6, 'Rémunération'),
  p('En contrepartie de chaque prestation, le Salarié porté perçoit une rémunération calculée comme suit :', { keepNext: true }),
  new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [W], layout: TableLayoutType.FIXED,
    rows: [new TableRow({ children: [cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [
      run('Prix de la prestation HT encaissé par l’EPS', { bold: true, color: C.navy }), run('  −  ', { bold: true, color: C.plum }),
      run('Frais de gestion', { bold: true, color: C.navy }), run('  =  ', { bold: true, color: C.plum }), run('Montant disponible', { bold: true, color: C.navy })
    ] })], W, { fill: C.rose50, pad: 160 })] })]
  }),
  p('HT Portage prélève des frais de gestion sur la facturation mensuelle HT adressée aux clients du Salarié porté, selon le barème suivant :', { before: 160, keepNext: true }),
  champ('Frais de gestion (% du chiffre d’affaires HT encaissé) :', { bold: true, tag: 'frais_gestion' }),
  p('Le montant disponible au titre de chaque prestation est ensuite affecté au paiement des éléments suivants :', { before: 80, keepNext: true }),
  puce('les cotisations patronales et salariales, ainsi que les autres charges, provisions ou prélèvements éventuels (épargne salariale, prélèvements fiscaux) ;'),
  puce('le salaire brut de base mensuel, calculé sur la base d’un taux horaire minimal de 13,50 € brut en fonction du nombre d’heures déclarées dans le compte-rendu d’activité mensuel ;'),
  puce('la rémunération complémentaire éventuelle ;'),
  puce('l’indemnité d’apport d’affaires de 5 % de la rémunération brute mensuelle ;'),
  puce('l’indemnité de congés payés ;'),
  puce('la réserve financière définie par la convention collective ;'),
  puce('les frais professionnels éventuels ;'),
  puce('l’indemnité de rupture conventionnelle.'),
  p('L’EPS n’est redevable au Salarié porté que de la rémunération due en contrepartie de chaque prestation, selon les modalités de calcul ci-dessus. Une partie du montant disponible peut être laissée en compte dans l’EPS pour une utilisation future par le Salarié porté.', { before: 80 }),
  p('Pendant la durée du présent contrat, les périodes sans prestation fournie à une entreprise cliente ne sont pas rémunérées, conformément à l’article L.1254-21, II du Code du travail et à l’article 21.3 de la convention collective applicable.'),
  p('Conformément à la convention collective, une réserve financière est constituée sur le compte du Salarié porté. Elle est versée en concertation avec lui, notamment pour pallier une baisse ou une absence de rémunération pendant les périodes sans activité ou de prospection.'),

  article(7, 'Sécurisation financière'),
  p('La rémunération du Salarié porté dépend directement des sommes encaissées par l’EPS au titre des prestations réalisées. En cas de retard de paiement du client, l’EPS pourra verser une rémunération minimale conforme aux obligations légales et conventionnelles ; le solde sera versé après encaissement effectif.'),

  article(8, 'Compte d’activité'),
  p('Un compte d’activité est établi au moins une fois par mois (sur papier ou en ligne). Il reprend l’ensemble des éléments qui y sont imputés, notamment les versements effectués par l’entreprise cliente au titre de chaque prestation, le détail des frais de gestion, des frais professionnels et des prélèvements sociaux et fiscaux, la rémunération nette, le montant de l’indemnité d’apport d’affaires et la provision constituée.'),

  article(9, 'Suspension'),
  p('Le contrat peut être suspendu en cas d’absence de mission.'),

  article(10, 'Lieu de travail'),
  p('Le Salarié porté exerce ses fonctions sur les lieux d’exécution de la mission en portage salarial, ainsi qu’au siège social de l’EPS, à son domicile et dans tous autres locaux qu’il serait amené à utiliser. Il peut également travailler en tout lieu que la réalisation des prestations nécessite, sans que la modification du lieu de travail constitue une modification du contrat de travail.'),
  p('Les déplacements font l’objet d’un accord préalable du responsable de l’EPS avant le début de la mission. En cas d’accord, le Salarié porté souscrit une assurance « déplacements professionnels » couvrant le véhicule, le conducteur et ses passagers lorsqu’un véhicule est utilisé. S’il est amené à travailler à l’étranger, il se munit des attestations de vaccination obligatoires et d’une assurance rapatriement.'),

  article(11, 'Frais'),
  p('Les frais que le Salarié porté engage dans l’exercice de ses fonctions sont soit facturés et payés par le client, soit provisionnés d’un commun accord sur les honoraires payés par le client.'),
  p('Le Salarié porté est remboursé de ses frais professionnels sur justificatifs, au réel ou selon les règles appliquées par l’URSSAF et dans la limite des barèmes sociaux ou fiscaux applicables, sous réserve de leur validation par l’EPS et pour autant que le solde disponible sur le compte d’activité le permette.'),

  article(12, 'Exécution'),
  p('Le Salarié porté exerce ses fonctions sous l’autorité du dirigeant de l’EPS. Les prestations réalisées au profit du client sont définies par la convention de portage. Le Salarié porté fournit chaque mois, selon les modalités prévues dans la convention de portage, sa déclaration d’activité au moyen du compte-rendu d’activité (CRA).'),
  p('Le Salarié porté n’a aucun lien hiérarchique avec ses clients et tient l’EPS informée des conditions d’exécution de sa mission. Il met ses connaissances et son savoir-faire au service du client, sollicite auprès de lui toutes les informations techniques nécessaires et prend toutes les dispositions pour que sa mission soit réalisée dans les meilleures conditions. Il s’engage enfin à respecter les normes de qualité des salariés portés de l’EPS ainsi que les règles déontologiques de la profession.'),

  article(13, 'Confidentialité'),
  p('Le Salarié porté s’engage à ne divulguer aucune information concernant les activités de l’EPS dont il pourrait avoir connaissance dans l’accomplissement de ses fonctions et qui serait de nature à lui porter préjudice. Cette obligation s’applique tant à l’égard des tiers que des salariés de l’EPS. Elle produit ses effets pendant toute la durée du contrat de travail et se prolonge après sa rupture, quel qu’en soit le motif.'),

  article(14, 'Congés payés'),
  p('Les congés payés sont provisionnés et payés chaque mois à hauteur de 10 % du salaire mensuel et de l’indemnité d’apport d’affaires.'),

  article(15, 'Ancienneté'),
  p('L’ancienneté du Salarié porté s’apprécie en totalisant les périodes pendant lesquelles il a effectué des prestations de portage salarial dans le cadre du présent contrat. Elle détermine sa classification conformément à la convention collective applicable.'),

  article(16, 'Protection sociale'),
  p('La déclaration préalable à l’embauche du Salarié porté est effectuée auprès de l’URSSAF de Nanterre. Le Salarié porté bénéficie de tous les droits et avantages reconnus aux salariés de l’entreprise, résultant du Code du travail, du présent contrat et de la Convention collective de branche des salariés en portage salarial (IDCC 3219).'),
  new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [3600, 3000, 3038], layout: TableLayoutType.FIXED,
    rows: [
      ['Garantie', 'Organisme', 'N° de contrat'],
      ['Retraite complémentaire', 'Malakoff Humanis', '26193578'],
      ['Prévoyance', 'Benefiz', 'A 7181 - 07/2022'],
      ['Mutuelle santé', 'Benefiz', 'CTMC520R800']
    ].map((r, i) => new TableRow({ children: r.map((t, j) => cell([new Paragraph({ children: [run(t, { bold: i === 0, color: i === 0 ? 'FFFFFF' : C.ink, size: i === 0 ? 17 : 19 })] })], [3600, 3000, 3038][j], {
      fill: i === 0 ? C.navy : (i % 2 ? 'FFFFFF' : C.bg), pad: 90,
      borders: { top: noBorder, left: noBorder, right: noBorder, bottom: { style: BorderStyle.SINGLE, size: 4, color: C.line } }
    })) }))
  }),

  article(17, 'Garantie financière'),
  p('Le garant financier de l’EPS est **AXA France IARD**, sis 313 Terrasses de l’Arche, 92727 Nanterre Cedex, immatriculé au Registre du Commerce et des Sociétés de Nanterre sous le numéro 722 057 460.'),

  article(18, 'Assurance'),
  p('L’EPS est assurée pour les dommages provoqués par le Salarié porté dans la ou les entreprises clientes pendant l’exécution des prestations : responsabilité civile professionnelle souscrite auprès d’AXA France IARD SA, contrat n° 0000022531127904.'),

  article(19, 'Rupture'),
  p('La rupture du présent contrat de travail ne peut intervenir que pour les causes et selon les formes prévues par le Code du travail et la convention collective applicable.'),

  article(20, 'Restitution du matériel'),
  p('Le matériel, les équipements, badges, cartes d’accès, identifiants, documents et données mis à disposition du Salarié porté par l’entreprise cliente ou le client final pour les besoins d’une prestation (ci-après « le Matériel ») restent leur propriété exclusive. Le Salarié porté en assure la garde et s’interdit tout usage étranger à la mission.'),
  p('Le Salarié porté restitue l’intégralité du Matériel, en bon état d’usage, **au plus tard le dernier jour de la prestation**, quelle que soit la cause de la fin de la mission ou du contrat. La restitution est constatée par un procès-verbal de restitution signé par l’entreprise cliente, ou par un courrier électronique de celle-ci confirmant la restitution complète, que le Salarié porté transmet sans délai à l’EPS. À défaut de ce justificatif, le Matériel est réputé non restitué. Le Salarié porté efface en outre toute donnée du client conservée sur ses propres outils et en atteste par écrit.'),
  p('À défaut de restitution complète à cette date :', { keepNext: true }),
  puce('l’EPS met en demeure le Salarié porté, par tout moyen écrit, de restituer le Matériel dans un délai de quarante-huit (48) heures ;'),
  puce('la non-restitution constitue un manquement grave du Salarié porté à ses obligations, susceptible de justifier une sanction disciplinaire pouvant aller jusqu’au licenciement ;'),
  puce('tant que la restitution n’est pas justifiée, l’EPS ne donne pas son accord à une rupture conventionnelle et ne signe aucune convention de rupture ;'),
  puce('le Salarié porté répond seul, à l’égard de l’EPS, des conséquences de la non-restitution. L’EPS se réserve le droit d’engager toute action pour obtenir la restitution du Matériel et la réparation du préjudice subi, notamment le remboursement de la valeur du Matériel non restitué qui lui aurait été facturée par le client.'),
  p('Lors de l’établissement du solde de tout compte, l’EPS peut opérer une compensation au titre du Matériel non restitué dont le Salarié porté avait la charge et l’usage, dans les conditions et limites prévues par les articles L.3251-1 et suivants du Code du travail.', { before: 80 }),

  article(21, 'Litiges'),
  p('Les litiges relatifs à l’exécution du présent contrat de droit privé relèvent de la compétence du Conseil de prud’hommes de Nanterre.'),

  p('Fait à Bois-Colombes, en deux exemplaires originaux, le ‹date_signature›.', { before: 300, after: 240, keepNext: true }),
  signatures([
    { titre: 'Pour l’EPS · HT Portage', lignes: ['SARL Wadi ESSAFI, Président'], ancre: '{{s2|signature|180|70}}' },
    { titre: 'Le Salarié porté', lignes: ['Nom : ‹salarie_nom›', MODELE ? 'Signature électronique' : 'Précédée de la mention « Lu et approuvé »'], ancre: '{{s1|signature|180|70}}' }
  ])
];

// =====================================================================
// ANNEXE 1
// =====================================================================
const partiesAnnexe = new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [3146, 100, 3146, 100, 3146], layout: TableLayoutType.FIXED,
  rows: [new TableRow({ children: [
    cell([etiquette('Le Prestataire'), p('**HT Portage**, entreprise de portage salarial, 34 rue Pasteur, 92270 Bois-Colombes, RCS Nanterre 993 218 007.', { align: AlignmentType.LEFT, after: 0 })], 3146, { fill: C.bg }),
    cell([new Paragraph({ children: [] })], 100),
    cell([etiquette('Le Client'), champ('Société :', { w: 2786, tag: 'client' }), champ('SIRET :', { w: 2786, tag: 'client_siret' }), champ('Adresse :', { w: 2786, tag: 'client_adresse' }), champ('', { w: 2786 }), champ('Représentée par :', { w: 2786, after: 0, tag: 'client_representant' })], 3146, { fill: C.bg }),
    cell([new Paragraph({ children: [] })], 100),
    cell([etiquette('Le Salarié porté'), champ('Nom et prénom :', { w: 2786, tag: 'salarie_nom' }), champ('', { w: 2786 }), p('Consultant salarié porté de HT Portage, qui réalise la prestation.', { align: AlignmentType.LEFT, after: 0, run: { size: 17, color: C.muted } })], 3146, { fill: C.bg })
  ] })]
});
function tableInterlocuteurs() {
  const w = [2300, 2700, 2000, 2638];
  const bord = { top: noBorder, left: noBorder, right: noBorder, bottom: { style: BorderStyle.SINGLE, size: 4, color: C.line } };
  const ligne = (t, i) => new TableRow({ cantSplit: true, children: t.map((x, j) => cell([new Paragraph({ children: [run(x, { bold: i === 0 || j === 0, color: i === 0 ? 'FFFFFF' : (j === 0 ? C.navy : C.slate), size: i === 0 ? 17 : 19 })] })], w[j], { fill: i === 0 ? C.navy : (j === 0 ? C.bg : 'FFFFFF'), pad: 150, borders: bord })) });
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, rows: [
    ligne(['', 'Nom et prénom', 'Téléphone', 'E-mail'], 0),
    ligne(MODELE ? ['Interlocuteur du Client', '[[ic_nom]]', '[[ic_tel]]', '[[ic_email]]'] : ['Interlocuteur du Client', BLANC_COURT, BLANC_COURT, BLANC_COURT], 1),
    ligne(MODELE ? ['Interlocuteur du Prestataire', '[[ip_nom]]', '[[ip_tel]]', '[[ip_email]]'] : ['Interlocuteur du Prestataire', BLANC_COURT, BLANC_COURT, BLANC_COURT], 2)
  ] });
}

const cdiArts = REG;
DOC = 'annexe'; REG = [];
const annexe = [
  titre('Annexe 1 · contrat commercial de prestation', 'Conditions de la prestation', null),
  p('', { after: 120 }),
  p('Annexe au contrat commercial de prestation de portage salarial n° ‹numero_contrat› conclu entre :', { after: 160 }),
  partiesAnnexe,

  article(1, 'Objet de la prestation'),
  ...lignesVides(3, 'objet'),

  article(2, 'Durée'),
  p('Le contrat prend effet le ‹date_debut› et prend fin le ‹date_fin›.'),
  p('La prestation pourra être renouvelée à la demande du Client ; tout renouvellement fera l’objet d’un avenant écrit signé par les parties.'),

  article(3, 'Lieu d’exécution'),
  p('La prestation est exécutée chez le client final du Client :'),
  champ('Client final :', { tag: 'client_final' }), champ('Adresse d’exécution :', { tag: 'adresse_execution' }),

  article(4, 'Interlocuteurs'),
  tableInterlocuteurs(),

  article(5, 'Conditions financières'),
  p('En contrepartie de la réalisation des prestations, le Prestataire facture le Client sur la base du taux journalier suivant :', { keepNext: true }),
  champ('Taux journalier (€ HT) :', { bold: true, tag: 'tjm' }),
  champ('Frais de gestion (%) :', { bold: true, tag: 'frais_gestion' }),

  article(6, 'Résiliation'),
  p('En cas de manquement contractuel de l’une des parties, le contrat pourra être résilié de plein droit par la partie lésée si la partie défaillante n’a pas remédié à son manquement dans un délai de sept (7) jours calendaires à compter de la réception de la notification qui lui a été adressée par écrit.'),
  p('Chaque partie pourra également résilier le contrat à sa convenance moyennant un préavis de trente (30) jours calendaires, notifié par écrit à l’autre partie.'),
  p('En cas de résiliation anticipée du contrat conclu entre le Client et le client final, le présent contrat sera résilié de plein droit avec effet immédiat, sans indemnité. Le Client reste tenu de régler les sommes dues au Prestataire au titre des prestations déjà réalisées par le salarié porté, dans un délai maximum de trente (30) jours.'),

  article(7, 'Données personnelles'),
  p('Le salarié porté déclare être informé de la loi n° 78-17 du 6 janvier 1978 relative à l’informatique, aux fichiers et aux libertés, modifiée, ainsi que du Règlement (UE) 2016/679 (RGPD). Dans le cadre de l’exécution des prestations, il peut être amené à traiter des données à caractère personnel du Client ou du client final. À ce titre, il s’engage notamment à :', { keepNext: true }),
  puce('traiter les données uniquement selon les instructions du Client ou du client final ;'),
  puce('garantir la sécurité et la confidentialité des données ;'),
  puce('ne pas communiquer les données à des tiers ;'),
  puce('notifier toute violation de données dans un délai de 24 heures.'),

  article(8, 'Confidentialité'),
  p('Le salarié porté s’engage, pendant toute la durée de la mission et après sa cessation, à ne pas divulguer d’informations confidentielles relatives au client, à son organisation, à ses activités ou à ses clients.'),

  article(9, 'Propriété intellectuelle'),
  p('Tous les documents, études, rapports, livrables ou développements réalisés dans le cadre de la mission deviennent la propriété exclusive du client. À la fin de la mission, l’ensemble des documents et livrables est remis au client.'),

  article(10, 'Anti-contournement (non-concurrence)'),
  p('Le salarié porté s’engage à ne pas traiter directement ou indirectement avec le client final pendant toute la durée du contrat et pendant douze (12) mois après la fin de la relation contractuelle. En cas de non-respect, une indemnité équivalente à douze mois de salaire brut pourra être due.'),

  article(11, 'Matériel mis à disposition'),
  p('Le Client, ou le client final, peut mettre à la disposition du salarié porté le matériel et les accès nécessaires à la prestation (ordinateur, badge, identifiants, documents). Il en tient l’inventaire, qu’il communique au Prestataire à sa demande.'),
  p('Le salarié porté restitue l’intégralité de ce matériel au plus tard le dernier jour de la prestation. Le Client constate la restitution par un procès-verbal signé ou par un courrier électronique adressé le jour même au Prestataire. À défaut, il en informe le Prestataire par écrit au plus tard le premier jour ouvré suivant, en précisant le matériel manquant, afin de permettre au Prestataire d’en obtenir sans délai la restitution.'),

  p('Fait à ‹lieu_signature›, le ‹date_signature›.', { before: 300, after: 240, keepNext: true }),
  signatures([
    { titre: 'Pour le Prestataire', lignes: ['HT Portage', 'Nom et qualité : ‹htp_signataire›'], ancre: '{{s3|signature|150|70}}' },
    { titre: 'Pour le Client', lignes: ['Société : ‹client›', 'Nom et qualité : ‹client_signataire›'], ancre: '{{s2|signature|150|70}}' },
    { titre: 'Le Salarié porté', lignes: ['Nom : ‹salarie_nom›', 'Pour acceptation des articles 7 à 11'], ancre: '{{s1|signature|150|70}}' }
  ])
];

const annexeArts = REG;
// CDI : sommaire sur une page dédiée, après la page de garde
cdi.unshift(...sommaire(cdiArts, { grand: true }), new Paragraph({ children: [new PageBreak()] }));
// Annexe : sommaire en encadré sous le titre
annexe.unshift(...sommaire(annexeArts, { grand: true }), new Paragraph({ children: [new PageBreak()] }));
if (!MODELE) fs.writeFileSync(__dirname + '/titres.json', JSON.stringify({ cdi: cdiArts, annexe: annexeArts }));

(async () => {
  const OUT = MODELE ? __dirname + '/modeles' : __dirname + '/out';
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + (MODELE ? '/cdi.docx' : '/HT-Portage_CDI-portage-salarial_modele.docx'), await Packer.toBuffer(document('Contrat de travail en portage salarial · CDI', cdi, pageDeGarde({ sur: 'Contrat de travail', l1: ['Contrat de travail', 'en portage salarial'], l2: 'à durée indéterminée', note: 'Convention collective de branche des salariés en portage salarial · IDCC 3219',
    parties: [{ label: 'Entre', nom: 'HT Portage', note: 'Entreprise de portage salarial · Bois-Colombes' }, { label: 'Et le salarié porté', champ: 'Nom et prénom :', tag: 'salarie_nom', note: 'Consultant · statut cadre' }],
    champs: [['Date d’effet du contrat :', 'date_effet'], ['Référence du contrat :', 'reference_cdi'], ['Signé à Bois-Colombes, le :', 'date_signature']] }))));
  fs.writeFileSync(OUT + (MODELE ? '/annexe.docx' : '/HT-Portage_Annexe-1_conditions-prestation_modele.docx'), await Packer.toBuffer(document('Annexe 1 · Conditions de la prestation', annexe, pageDeGarde({ sur: 'Annexe 1 · contrat commercial de prestation', l1: ['Conditions', 'de la prestation'], l2: 'portage salarial', note: 'Annexe au contrat commercial de prestation de portage salarial conclu entre HT Portage et le Client',
    parties: [{ label: 'Le Prestataire', nom: 'HT Portage', note: 'Entreprise de portage salarial' }, { label: 'Le Client', champ: 'Société :', tag: 'client', note: 'Entreprise cliente' }, { label: 'Le salarié porté', champ: 'Nom :', tag: 'salarie_nom', note: 'Consultant HT Portage' }],
    champs: [['Contrat commercial n° :', 'numero_contrat'], ['Période de la prestation :', 'periode'], ['Signé le :', 'date_signature']] }))));
  console.log('ok');
})();
