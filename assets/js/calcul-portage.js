// HT Portage — moteur de calcul du portage salarial (partagé : simulateur, espace consultant).
// Calé sur les bulletins de paie HT Portage (VSP) d'août et septembre 2026 : cadre, échelon senior,
// 151,67 h + 15,17 h majorées à 25 %, indemnité d'apport d'affaires 5 %, réserve financière 10 %, CP 10 %.
//
// Chaîne : CA → frais de gestion (5 %) → frais professionnels → budget salaire (coût global)
//          → salaire de base → brut → cotisations → net avant impôt → impôt (PAS) → net payé.
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
    // Cotisations patronales : [taux, assiette] — assiette 'brut', 't1' (jusqu'au PMSS), 't2' (au-delà)
    patronales: [
      [0.13, 'brut'],      // maladie, maternité, invalidité, décès
      [0.0097, 't1'],      // prévoyance (incapacité, invalidité, décès)
      [0.007, 'brut'],     // accidents du travail
      [0.0855, 't1'],      // vieillesse plafonnée
      [0.0211, 'brut'],    // vieillesse déplafonnée
      [0.0622, 't1'],      // retraite complémentaire tranche 1
      [0.1478, 't2'],      // retraite complémentaire tranche 2
      [0.0525, 'brut'],    // famille
      [0.0425, 'brut'],    // chômage
      [0.00036, 'brut'],   // APEC
      [0.0005, 'brut'],    // cotisation conventionnelle
      [0.02596, 'brut'],   // autres contributions employeur
      [0.001, 't1']        // autres contributions employeur (plafonnées)
    ],
    salariales: [
      [0.0096, 't1'],      // prévoyance
      [0.069, 't1'],       // vieillesse plafonnée
      [0.004, 'brut'],     // vieillesse déplafonnée
      [0.0415, 't1'],      // retraite complémentaire tranche 1
      [0.0986, 't2'],      // retraite complémentaire tranche 2
      [0.00024, 'brut']    // APEC
    ],
    csgDeductible: 0.068, csgNonDeductible: 0.029, abattementCsg: 0.0175
  };

  function assiettes(brut) {
    var P = PARAMS;
    return { brut: brut, t1: Math.min(brut, P.pmss), t2: Math.max(0, Math.min(brut, 8 * P.pmss) - P.pmss) };
  }
  function somme(liste, a) { return liste.reduce(function (s, x) { return s + x[0] * a[x[1]]; }, 0); }

  // Bulletin complet à partir du salaire de base
  function bulletin(base, mutuelle) {
    var P = PARAMS;
    var hs = base * (P.heuresMajorees * (1 + P.majoration)) / (P.heuresBase + P.heuresMajorees * (1 + P.majoration));
    var apport = base * P.apport, reserve = base * P.reserve, cp = (base + apport + reserve) * P.cp;
    var brut = base + apport + reserve + cp;
    var a = assiettes(brut), sante = mutuelle ? P.mutuelle : 0;
    var prevoyancePatronale = 0.0097 * a.t1;
    var patronales = somme(P.patronales, a) + sante - P.deductionHsParHeure * P.heuresMajorees;
    var baseCsg = brut * (1 - P.abattementCsg) + prevoyancePatronale + sante;
    var csgNonDed = baseCsg * P.csgNonDeductible;
    var salariales = somme(P.salariales, a) + sante + baseCsg * P.csgDeductible + csgNonDed - hs * P.exoHsSalariale;
    var netSalaire = brut - salariales;
    return {
      base: base, hs: hs, apport: apport, reserve: reserve, cp: cp, brut: brut,
      patronales: patronales, salariales: salariales, coutSalaire: brut + patronales,
      netSalaire: netSalaire,
      netImposable: netSalaire + csgNonDed + sante - hs * P.hsNetFiscal
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
      ca: ca, gestion: gestion, frais: frais, fraisMax: fraisMax,
      fraisMaxPct: ca > 0 ? fraisMax / ca : 0, fraisPct: ca > 0 ? frais / ca : 0,
      fraisLimiteParMinimum: fraisMax < ca * P.fraisMax - 0.5,
      coutEmployeur: budgetTotal - frais, base: b.base, hs: b.hs, apport: b.apport, reserve: b.reserve, cp: b.cp,
      brut: b.brut, patronales: b.patronales, salariales: b.salariales,
      net: net, netImposable: b.netImposable, impot: impot, pas: pas,
      netApresImpot: net - impot,
      totalPercu: net - impot + frais,              // net payé (salaire + frais remboursés)
      sousMinimum: b.base + 0.5 < baseMin, baseMin: baseMin,
      ratioNet: ca > 0 ? net / ca : 0
    };
  }

  var api = { PARAMS: PARAMS, calculer: calculer, bulletin: bulletin };
  if (typeof window !== 'undefined') window.HTP_CALCUL = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
