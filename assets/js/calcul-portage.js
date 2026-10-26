// HT Portage — moteur de calcul du portage salarial (partagé : simulateur, espace consultant, e-mail de simulation).
// Calé sur les bulletins de paie HT Portage (VSP) d'août et septembre 2026 : cadre, échelon senior,
// 151,67 h + 15,17 h majorées à 25 %, indemnité d'apport d'affaires 5 %, réserve financière 10 %, CP 10 %.
//
// Chaîne : CA → frais de gestion (5 %) → frais professionnels → budget salaire (coût global)
//          → salaire de base → brut → cotisations → net avant impôt → impôt (PAS) → net payé.
// Ce fichier est aussi recopié dans supabase/functions/notify-lead/index.ts (scripts/sync-calcul.mjs) : ne pas utiliser d'accent grave.
(function () {
  'use strict';

  var PARAMS = {
    gestion: 0.05,               // frais de gestion HT Portage (fixe)
    fraisMax: 0.20,              // plafond interne des frais professionnels (jamais affiché en % sur le site)
    pmss: 4005,                  // plafond mensuel de la Sécurité sociale 2026
    apport: 0.05,                // indemnité d'apport d'affaires (% du salaire de base)
    reserve: 0.10,               // réserve financière (% du salaire de base)
    cp: 0.10,                    // indemnité compensatrice de congés payés
    heuresBase: 151.67, heuresMajorees: 15.17, majoration: 0.25,
    deductionHsParHeure: 1.50,   // déduction forfaitaire patronale sur heures supplémentaires
    exoHsSalariale: 0.111,       // réduction de cotisations salariales sur heures supplémentaires
    hsNetFiscal: 0.9332,         // part nette des heures supplémentaires exonérée d'impôt
    mutuelle: 63.60,             // complémentaire santé : part salariale = part patronale (si adhésion)
    minimumBase: 0.75,           // salaire minimum conventionnel (senior) : 75 % du PMSS, salaire de base
    joursTempsPlein: 218 / 12,
    // Cotisations : [rubrique du bulletin simplifié, libellé, assiette ('brut', 't1' jusqu'au PMSS, 't2' au-delà), taux salarial, taux patronal]
    cotisations: [
      ['Santé', 'Sécurité Sociale - Mal. Mat. Inval. Décès', 'brut', 0, 0.13],
      ['Santé', 'Complémentaire - Incap. Inval. Décès', 't1', 0.0096, 0.0097],
      ['Accidents du travail - maladies professionnelles', 'Accidents du travail & mal. professionnelles', 'brut', 0, 0.007],
      ['Retraite', 'Sécurité Sociale plafonnée', 't1', 0.069, 0.0855],
      ['Retraite', 'Sécurité Sociale déplafonnée', 'brut', 0.004, 0.0211],
      ['Retraite', 'Complémentaire Tranche 1', 't1', 0.0415, 0.0622],
      ['Retraite', 'Complémentaire Tranche 2', 't2', 0.0986, 0.1478],
      ['Famille', 'Famille', 'brut', 0, 0.0525],
      ['Assurance chômage', 'Chômage', 'brut', 0, 0.0425],
      ['Assurance chômage', 'APEC', 'brut', 0.00024, 0.00036],
      ['Cotisations statutaires ou prévues par la convention collective', 'Cotisation conventionnelle', 'brut', 0, 0.0005],
      ['Autres contributions dues par l’employeur', 'Autres contributions dues par l’employeur', 'brut', 0, 0.02596],
      ['Autres contributions dues par l’employeur', 'Autres contributions dues par l’employeur', 't1', 0, 0.001]
    ],
    csgDeductible: 0.068, csgNonDeductible: 0.029, abattementCsg: 0.0175
  };

  // Bulletin complet à partir du salaire de base (lignes au format des bulletins HT Portage)
  function bulletin(base, mutuelle) {
    var P = PARAMS;
    var hs = base * (P.heuresMajorees * (1 + P.majoration)) / (P.heuresBase + P.heuresMajorees * (1 + P.majoration));
    var apport = base * P.apport, reserve = base * P.reserve, cp = (base + apport + reserve) * P.cp;
    var brut = base + apport + reserve + cp;
    var a = { brut: brut, t1: Math.min(brut, P.pmss), t2: Math.max(0, Math.min(brut, 8 * P.pmss) - P.pmss) };
    var sante = mutuelle ? P.mutuelle : 0;
    var lignes = [], sal = 0, pat = 0, prevoyancePatronale = 0;
    P.cotisations.forEach(function (c) {
      var assiette = a[c[2]], s = assiette * c[3], p = assiette * c[4];
      if (c[1].indexOf('Incap') >= 0) prevoyancePatronale = p;
      sal += s; pat += p;
      lignes.push({ rubrique: c[0], libelle: c[1], base: assiette, tauxSal: c[3], sal: s, tauxPat: c[4], pat: p });
      if (c[1].indexOf('Incap') >= 0 && sante) {
        lignes.push({ rubrique: 'Santé', libelle: 'Complémentaire - Santé', base: null, tauxSal: null, sal: sante, tauxPat: null, pat: sante });
        sal += sante; pat += sante;
      }
    });
    var baseCsg = brut * (1 - P.abattementCsg) + prevoyancePatronale + sante;
    var csgDed = baseCsg * P.csgDeductible, csgNonDed = baseCsg * P.csgNonDeductible;
    var exoSal = hs * P.exoHsSalariale, exoPat = P.deductionHsParHeure * P.heuresMajorees;
    lignes.push({ rubrique: 'CSG déductible de l’impôt sur le revenu', libelle: 'CSG déduct. de l’impôt sur le revenu', base: baseCsg, tauxSal: P.csgDeductible, sal: csgDed, tauxPat: null, pat: 0 });
    lignes.push({ rubrique: 'CSG/CRDS non déductible de l’impôt sur le revenu', libelle: 'CSG/CRDS non déduct. de l’impôt sur le revenu', base: baseCsg, tauxSal: P.csgNonDeductible, sal: csgNonDed, tauxPat: null, pat: 0 });
    lignes.push({ rubrique: 'Exonérations et allègements de cotisations', libelle: 'Exonérations de cotisations employeur', base: null, tauxSal: null, sal: 0, tauxPat: null, pat: -exoPat });
    lignes.push({ rubrique: 'Exonérations et allègements de cotisations', libelle: 'Exonération sociale sur HC/HS', base: hs, tauxSal: -P.exoHsSalariale, sal: -exoSal, tauxPat: null, pat: 0 });
    var salariales = sal + csgDed + csgNonDed - exoSal, patronales = pat - exoPat;
    var netSalaire = brut - salariales;
    var tauxHoraire = base / (P.heuresBase + P.heuresMajorees * (1 + P.majoration));
    return {
      base: base, hs: hs, tauxHoraire: tauxHoraire, apport: apport, reserve: reserve, cp: cp, brut: brut,
      patronales: patronales, salariales: salariales, coutSalaire: brut + patronales,
      netSalaire: netSalaire, hsNetFiscal: hs * P.hsNetFiscal, reintegration: sante,
      netImposable: netSalaire + csgNonDed + sante - hs * P.hsNetFiscal,
      lignes: lignes
    };
  }

  // Salaire de base dont le coût (brut + charges patronales) égale le budget disponible
  function baseDepuisBudget(budget, mutuelle) {
    var lo = 0, hi = Math.max(0, budget);
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (bulletin(mid, mutuelle).coutSalaire > budget) hi = mid; else lo = mid;
    }
    return lo;
  }

  // o : { tjm, jours, fraisPct (part du CA), frais (montant €, prioritaire), pas (0 à 0,45), mutuelle (défaut : oui) }
  function calculer(o) {
    var P = PARAMS;
    var tjm = Math.max(0, Number(o.tjm) || 0), jours = Math.max(0, Number(o.jours) || 0);
    var mutuelle = o.mutuelle !== false;
    var ca = tjm * jours, gestion = ca * P.gestion, budgetTotal = ca - gestion;

    // Frais maximum : plafond interne, sans faire passer le salaire de base sous le minimum conventionnel
    var baseMin = P.pmss * P.minimumBase * Math.min(1, jours / P.joursTempsPlein);
    var coutMin = bulletin(baseMin, mutuelle).coutSalaire;
    var fraisMax = Math.max(0, Math.min(ca * P.fraisMax, budgetTotal - coutMin));
    var demande = o.frais != null ? Number(o.frais) || 0 : ca * (Number(o.fraisPct) || 0);
    var frais = Math.min(Math.max(0, demande), fraisMax);

    var b = bulletin(baseDepuisBudget(budgetTotal - frais, mutuelle), mutuelle);
    var pas = Math.min(Math.max(0, Number(o.pas) || 0), 0.45);
    var impot = b.netImposable * pas;
    var net = b.netSalaire;                         // net avant impôt, hors frais
    return {
      tjm: tjm, jours: jours, ca: ca, gestion: gestion, frais: frais, fraisMax: fraisMax,
      fraisMaxPct: ca > 0 ? fraisMax / ca : 0, fraisPct: ca > 0 ? frais / ca : 0,
      fraisLimiteParMinimum: fraisMax < ca * P.fraisMax - 0.5,
      coutEmployeur: budgetTotal - frais, base: b.base, hs: b.hs, tauxHoraire: b.tauxHoraire,
      apport: b.apport, reserve: b.reserve, cp: b.cp,
      brut: b.brut, patronales: b.patronales, salariales: b.salariales,
      net: net, netImposable: b.netImposable, hsNetFiscal: b.hsNetFiscal, reintegration: b.reintegration,
      impot: impot, pas: pas, netApresImpot: net - impot,
      totalPercu: net - impot + frais,              // net payé (salaire + frais remboursés)
      sousMinimum: b.base + 0.5 < baseMin, baseMin: baseMin,
      ratioNet: ca > 0 ? net / ca : 0,
      lignes: b.lignes
    };
  }

  var api = { PARAMS: PARAMS, calculer: calculer, bulletin: bulletin };
  if (typeof globalThis !== 'undefined') globalThis.HTP_CALCUL = api;
  if (typeof window !== 'undefined') window.HTP_CALCUL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
