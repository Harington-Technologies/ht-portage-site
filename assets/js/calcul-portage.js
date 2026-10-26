// HT Portage — moteur de calcul du portage salarial (partagé : simulateur, espace consultant).
// Chaîne : chiffre d'affaires → frais de gestion → frais professionnels remboursés → coût employeur
//          → cotisations patronales → salaire brut → cotisations salariales → net avant impôt → impôt (PAS) → net après impôt.
//
// ⚠ TAUX PROVISOIRES : à caler sur un bulletin de paie VSP réel avant mise en ligne
//   (cotisations patronales et salariales, réserve financière, indemnité d'apport d'affaires, congés payés).
(function () {
  'use strict';

  var PARAMS = {
    gestion: 0.05,              // frais de gestion HT Portage (fixe)
    fraisMax: 0.20,             // plafond interne des frais (jamais affiché en % sur le site)
    patronal: 0.45,             // cotisations patronales, en % du brut — PROVISOIRE
    salarial: 0.22,             // cotisations salariales, en % du brut — PROVISOIRE
    pmss: 4005,                 // plafond mensuel de la Sécurité sociale 2026
    minimumForfaitJours: 0.85,  // salaire minimum conventionnel (cadre au forfait jours) : 85 % du PMSS
    joursTempsPlein: 218 / 12   // forfait annuel de 218 jours
  };

  // o : { tjm, jours, fraisPct (0 à 0,20), pas (taux de prélèvement à la source, 0 à 0,45) }
  function calculer(o) {
    var P = PARAMS;
    var tjm = Math.max(0, Number(o.tjm) || 0), jours = Math.max(0, Number(o.jours) || 0);
    var ca = tjm * jours;
    var gestion = ca * P.gestion;

    // Salaire brut minimum conventionnel, au prorata des jours travaillés
    var brutMin = P.pmss * P.minimumForfaitJours * Math.min(1, jours / P.joursTempsPlein);
    // Frais maximum : 20 % du CA, sans faire passer le brut sous le minimum
    var fraisMaxMinimum = Math.max(0, (ca - gestion) - brutMin * (1 + P.patronal));
    var fraisMaxPct = ca > 0 ? Math.min(P.fraisMax, fraisMaxMinimum / ca) : 0;
    var fraisPct = Math.min(Math.max(0, Number(o.fraisPct) || 0), fraisMaxPct);
    var frais = ca * fraisPct;

    var coutEmployeur = ca - gestion - frais;
    var brut = coutEmployeur / (1 + P.patronal);
    var patronales = coutEmployeur - brut;
    var salariales = brut * P.salarial;
    var net = brut - salariales;
    var pas = Math.min(Math.max(0, Number(o.pas) || 0), 0.45);
    var impot = net * pas;
    var netApresImpot = net - impot;

    return {
      ca: ca, gestion: gestion, frais: frais, fraisPct: fraisPct, fraisMaxPct: fraisMaxPct,
      fraisLimiteParMinimum: fraisMaxPct < P.fraisMax - 1e-9,
      coutEmployeur: coutEmployeur, patronales: patronales, brut: brut, salariales: salariales,
      net: net, impot: impot, pas: pas, netApresImpot: netApresImpot,
      totalPercu: netApresImpot + frais,
      sousMinimum: brut + 0.5 < brutMin, brutMin: brutMin,
      ratioNet: ca > 0 ? net / ca : 0
    };
  }

  window.HTP_CALCUL = { PARAMS: PARAMS, calculer: calculer };
})();
