// @ts-nocheck — le moteur de calcul partagé (JavaScript) est recopié plus bas
// HT Portage — e-mails automatiques déclenchés par la base (Database Webhooks / déclencheurs).
//   • INSERT sur contacts, candidatures, recommandations  → e-mail à l'équipe (NOTIFY_TO)
//   • consultant_missions passe à « a_valider »            → e-mail à l'équipe : dossier à valider
//   • consultant_missions a_valider → brouillon (renvoyé)   → e-mail au consultant avec le message de l'administrateur
//   • consultant_missions a_valider → validee               → e-mail au consultant : dossier validé
// Envoi via Resend.
//
// Secrets (Supabase › Edge Functions › Secrets) :
//   RESEND_API_KEY   clé Resend
//   NOTIFY_TO        destinataire(s) internes, séparés par des virgules (ex. contact@htportage.fr)
//   NOTIFY_FROM      expéditeur vérifié dans Resend (ex. "HT Portage <site@htportage.fr>")
//   WEBHOOK_SECRET   chaîne aléatoire, recopiée dans l'en-tête x-webhook-secret des déclencheurs
// SUPABASE_URL et la clé serveur (SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEYS) sont fournis par Supabase.
// Déploiement : « Verify JWT » désactivé (l'authentification se fait par l'en-tête x-webhook-secret).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_TO = (Deno.env.get("NOTIFY_TO") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const SITE = "https://www.htportage.fr";
const CONTACT = "contact@htportage.fr";

// Clé serveur : ancienne clé service_role si présente, sinon nouvelle clé secrète (SUPABASE_SECRET_KEYS, JSON).
function serverKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const vals = Array.isArray(keys) ? keys : Object.values(keys);
    const first = vals.map((v: unknown) => typeof v === "string" ? v : (v as { key?: string })?.key).find(Boolean);
    return first ?? "";
  } catch { return ""; }
}
const SERVER_KEY = serverKey();
const admin = SERVER_KEY ? createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVER_KEY) : null;

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
const nl2br = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

// ---------------------------------------------------------------------------
// Gabarit e-mail HT Portage (tables + styles en ligne : compatible Outlook / Gmail)
// ---------------------------------------------------------------------------
type Gabarit = { titre: string; corps: string; bouton?: { texte: string; url: string }; apercu?: string; interne?: boolean; pied?: string };
export function gabarit(o: Gabarit): string {
  const bouton = o.bouton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px"><tr><td style="background:#21324E;border-radius:999px">
        <a href="${esc(o.bouton.url)}" style="display:inline-block;padding:13px 26px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">${esc(o.bouton.texte)}</a>
      </td></tr></table>`
    : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(o.titre)}</title></head>
<body style="margin:0;padding:0;background:#F3F1F4">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.apercu ?? o.titre)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1F4"><tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
    <tr><td style="background:#21324E;padding:22px 32px">
      <span style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;letter-spacing:3px;color:#ffffff">HT PORTAGE</span>
      <div style="width:36px;height:3px;background:#C187A1;margin-top:8px;border-radius:2px"></div>
    </td></tr>
    <tr><td style="padding:32px 32px 8px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1B1C1C">
      <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:#21324E">${esc(o.titre)}</h1>
      ${o.corps}
      ${bouton}
    </td></tr>
    <tr><td style="padding:20px 32px 30px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1B1C1C">
      <p style="margin:0">${o.interne ? "" : "Bien cordialement,<br>"}<strong style="color:#21324E">Service Administratif HT PORTAGE</strong><br>
      <a href="mailto:${CONTACT}" style="color:#784E61">${CONTACT}</a> · <a href="${SITE}" style="color:#784E61">www.htportage.fr</a></p>
    </td></tr>
    <tr><td style="background:#F7F5F8;padding:16px 32px;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#6B7385">
      ${o.pied ?? (o.interne ? "Notification interne envoyée automatiquement par le site HT Portage." : "HT Portage — portage salarial. Cet e-mail vous est adressé dans le cadre de votre espace consultant ; pour toute question, répondez simplement à ce message.")}
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}
export function tableau(lignes: [string, unknown][]): string {
  const l = lignes.filter(([, v]) => v !== null && v !== undefined && v !== "");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 8px">${
    l.map(([k, v]) => `<tr><td style="padding:8px 14px 8px 0;border-bottom:1px solid #ECE8EE;color:#6B7385;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #ECE8EE;color:#1B1C1C">${nl2br(String(v))}</td></tr>`).join("")
  }</table>`;
}

const adresseFrom = () => (NOTIFY_FROM.match(/<([^>]+)>/)?.[1] ?? NOTIFY_FROM).trim();
// externe : e-mail à un candidat / consultant / ambassadeur (réponses vers contact@)
// repondreA : pour les notifications internes, « Répondre » écrit directement à la personne concernée
async function envoyer(to: string[], sujet: string, html: string, externe = false, repondreA = "", pieces: { filename: string; content: string }[] = []) {
  const reponse = externe ? (NOTIFY_TO[0] ?? CONTACT) : (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(repondreA) ? repondreA : (NOTIFY_TO[0] ?? CONTACT));
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: externe ? `HT PORTAGE <${adresseFrom()}>` : NOTIFY_FROM,
      to, subject: sujet, html,
      reply_to: reponse,
      ...(pieces.length ? { attachments: pieces } : {}),
    }),
  });
  if (!r.ok) { console.error("Resend error", r.status, await r.text()); return false; }
  const j = await r.json().catch(() => ({}));
  console.log("E-mail envoyé", j?.id ?? "", "→", to.length, "destinataire(s)", "·", sujet, pieces.length ? "· PJ" : "");
  return true;
}

const dateFr = (v: unknown) => {
  const s = String(v ?? ""); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};
const euros = (v: unknown) => v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("fr-FR") + " € HT / jour";

// ---------------------------------------------------------------------------
// Demandes reçues sur le site
// ---------------------------------------------------------------------------
const LABELS: Record<string, string> = {
  contacts: "Nouvelle demande de contact",
  candidatures: "Nouvelle candidature",
  recommandations: "Nouvelle recommandation Ambassadeur",
};
const HIDDEN = new Set(["id", "consentement", "traite", "statut", "cv_path", "user_id", "prime_montant"]);
const CHAMPS: Record<string, string> = {
  type: "Type", nom: "Nom", prenom: "Prénom", email: "E-mail", telephone: "Téléphone", societe: "Société",
  entreprise: "Entreprise", poste: "Poste", metier: "Métier", message: "Message", tjm: "TJ souhaité (€ HT)",
  jours: "Jours / mois", net: "Net estimé (€)", disponibilite: "Disponibilité", ville: "Ville", offre: "Offre",
  ambassadeur_nom: "Ambassadeur", ambassadeur_email: "E-mail ambassadeur", contact_nom: "Personne recommandée",
  contact_email: "E-mail de la personne", contact_telephone: "Téléphone de la personne", created_at: "Reçu le",
  frais_pro: "Frais professionnels simulés (€/mois)", taux_pas: "Taux de prélèvement à la source (%)", net_estime: "Net estimé avant impôt (€/mois)", situation: "Situation",
};
const libelle = (k: string) => CHAMPS[k] ?? (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " "));

// ---------------------------------------------------------------------------
// Dossiers de contractualisation
// ---------------------------------------------------------------------------
async function profil(id: unknown) {
  if (!admin || typeof id !== "string") return null;
  const { data } = await admin.from("profils").select("prenom, nom, email, civilite").eq("id", id).maybeSingle();
  return data as { prenom?: string; nom?: string; email?: string; civilite?: string } | null;
}

async function mission(payload: { type?: string; record?: Record<string, unknown>; old_record?: Record<string, unknown> }) {
  const r = payload.record ?? {}, ancien = payload.old_record ?? {};
  const avant = payload.type === "UPDATE" ? ancien.statut : null;
  if (r.statut === avant) return new Response("Ignored", { status: 200 });
  const p = await profil(r.user_id);
  const nom = [p?.prenom, p?.nom].filter(Boolean).join(" ") || p?.email || "un consultant";
  const bonjour = `<p style="margin:0 0 14px">Bonjour ${esc(p?.prenom || "")},</p>`.replace(" ,", ",");
  const resume = tableau([
    ["Mission", r.intitule], ["Client", r.client], ["Client final", r.client_final],
    ["Début", dateFr(r.date_debut)], ["Fin", dateFr(r.date_fin)], ["Taux journalier", euros(r.tjm)],
  ]);

  // 1. Dossier envoyé par le consultant → équipe HT Portage
  if (r.statut === "a_valider") {
    const sujet = `Dossier à valider — ${nom}${r.client ? " · " + r.client : ""}`;
    const html = gabarit({
      interne: true, titre: "Un dossier de contractualisation est à valider",
      apercu: `${nom} vient d'envoyer son dossier.`,
      corps: `<p style="margin:0 0 14px"><strong>${esc(nom)}</strong> vient d'envoyer son dossier de contractualisation. Vérifiez les informations, puis validez-le ou renvoyez-le au consultant avec un message.</p>` +
        tableau([
          ["Consultant", nom], ["E-mail", p?.email], ["Mission", r.intitule], ["Client", r.client], ["Client final", r.client_final],
          ["Début", dateFr(r.date_debut)], ["Fin", dateFr(r.date_fin)], ["Taux journalier", euros(r.tjm)],
          ["Signataire client", [r.client_representant, r.client_signataire_email].filter(Boolean).join(" · ")],
        ]),
      bouton: { texte: "Ouvrir le dossier", url: `${SITE}/espace/admin.html#a-valider` },
    });
    return (await envoyer(NOTIFY_TO, sujet, html, false, String(p?.email ?? ""))) ? new Response("OK") : new Response("Email failed", { status: 502 });
  }
  if (!p?.email || avant !== "a_valider") return new Response("Ignored", { status: 200 });

  // 2. Dossier renvoyé au consultant pour correction
  if (r.statut === "brouillon") {
    const html = gabarit({
      titre: "Votre dossier est à compléter",
      apercu: "Nous avons besoin de quelques précisions avant d'établir vos contrats.",
      corps: bonjour +
        `<p style="margin:0 0 14px">Nous avons bien reçu votre dossier de contractualisation${r.client ? ` pour votre mission chez <strong>${esc(r.client)}</strong>` : ""} et nous vous en remercions.</p>` +
        `<p style="margin:0 0 10px">Avant de pouvoir établir vos contrats, nous avons besoin des précisions suivantes :</p>` +
        `<div style="background:#FFF4E5;border-left:4px solid #B45309;border-radius:6px;padding:14px 18px;margin:0 0 16px;color:#5C3B0B">${nl2br(String(r.commentaire_admin ?? ""))}</div>` +
        `<p style="margin:0">Il vous suffit de modifier votre dossier depuis votre espace consultant, puis de l'envoyer à nouveau.</p>`,
      bouton: { texte: "Compléter mon dossier", url: `${SITE}/espace/contractualisation.html` },
    });
    return (await envoyer([p.email], "Votre dossier HT Portage est à compléter", html, true)) ? new Response("OK") : new Response("Email failed", { status: 502 });
  }

  // 3. Dossier validé
  if (r.statut === "validee") {
    const html = gabarit({
      titre: "Votre dossier est validé",
      apercu: "Vos contrats vont vous être envoyés pour signature électronique.",
      corps: bonjour +
        `<p style="margin:0 0 14px">Bonne nouvelle : votre dossier de contractualisation a été validé par nos équipes${r.numero_contrat ? ` sous la référence <strong>${esc(r.numero_contrat)}</strong>` : ""}.</p>` +
        resume +
        `<p style="margin:14px 0 0">Vous allez recevoir très prochainement, de la part de notre partenaire de signature électronique Yousign, un e-mail vous invitant à signer vos documents en ligne. Votre client recevra en parallèle l'annexe relative à la mission.</p>`,
      bouton: { texte: "Suivre mon dossier", url: `${SITE}/espace/contractualisation.html` },
    });
    return (await envoyer([p.email], "Votre dossier HT Portage est validé", html, true)) ? new Response("OK") : new Response("Email failed", { status: 502 });
  }
  return new Response("Ignored", { status: 200 });
}

// ---------------------------------------------------------------------------
// Simulation : exemple de bulletin de salaire envoyé au candidat
// ---------------------------------------------------------------------------
// <calcul-portage> — généré par scripts/sync-calcul.mjs, ne pas modifier ici
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
// </calcul-portage>
const CALCUL = (globalThis as { HTP_CALCUL?: any }).HTP_CALCUL;

const n2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const t4 = (v: number | null) => v == null ? "" : (Math.round(v * 1e6) / 1e4).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const e0 = (v: number) => Math.round(v).toLocaleString("fr-FR") + " €";

export function simulationDepuis(record: Record<string, unknown>) {
  if (!CALCUL) return null;
  const tjm = Number(record.tjm), jours = Number(record.jours);
  if (!(tjm > 0 && jours > 0)) return null;
  return CALCUL.calculer({ tjm, jours, frais: Number(record.frais_pro) || 0, pas: (Number(record.taux_pas) || 0) / 100 });
}

// Bulletin de salaire simplifié (format officiel : cotisations regroupées par rubrique), en PDF A4
const txt = (v: unknown) => String(v ?? "").replace(/[  ]/g, " ").replace(/−/g, "-").replace(/[^\x20-\x7E -ÿ’€–—«»]/g, "");
export async function bulletinPdf(r: any, nom: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Bulletin de salaire simplifié — simulation HT Portage");
  doc.setAuthor("HT Portage");
  const page = doc.addPage([595.28, 841.89]);
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const NAVY = rgb(0.129, 0.196, 0.306), ROSE = rgb(0.757, 0.529, 0.631), PLUM = rgb(0.471, 0.306, 0.380), GRIS = rgb(0.42, 0.45, 0.52), FOND = rgb(0.957, 0.945, 0.957), LIGNE = rgb(0.85, 0.83, 0.87);
  const W = 595.28, M = 40;
  const ecrire = (t: unknown, x: number, y: number, o: { size?: number; bold?: boolean; color?: any; right?: boolean } = {}) => {
    const s = txt(t), font = o.bold ? fb : f, size = o.size ?? 9;
    page.drawText(s, { x: o.right ? x - font.widthOfTextAtSize(s, size) : x, y, size, font, color: o.color ?? rgb(0.106, 0.11, 0.11) });
  };
  const eur2 = (v: number) => txt((Math.round(v * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const pct = (v: number) => txt((Math.round(v * 1e6) / 1e4).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }));

  // En-tête
  page.drawRectangle({ x: 0, y: 841.89 - 92, width: W, height: 92, color: NAVY });
  ecrire("HT PORTAGE", M, 841.89 - 42, { size: 18, bold: true, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: M, y: 841.89 - 52, width: 34, height: 3, color: ROSE });
  ecrire("BULLETIN DE SALAIRE SIMPLIFIÉ", W - M, 841.89 - 40, { size: 12, bold: true, color: rgb(1, 1, 1), right: true });
  ecrire("Exemple établi à partir de votre simulation — non contractuel", W - M, 841.89 - 56, { size: 8.5, color: rgb(0.85, 0.87, 0.91), right: true });
  ecrire(new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }), W - M, 841.89 - 70, { size: 8.5, color: rgb(0.85, 0.87, 0.91), right: true });

  // Employeur / salarié
  let y = 841.89 - 120;
  ecrire("EMPLOYEUR", M, y, { size: 7.5, bold: true, color: PLUM }); ecrire("SALARIÉ", 320, y, { size: 7.5, bold: true, color: PLUM });
  y -= 14;
  ecrire("HT PORTAGE", M, y, { bold: true }); ecrire(nom || "Votre nom", 320, y, { bold: true });
  y -= 12; ecrire("34 rue Pasteur, 92270 Bois-Colombes", M, y, { color: GRIS }); ecrire("Salarié porté · Cadre · Échelon senior", 320, y, { color: GRIS });
  y -= 12; ecrire("Convention collective : salariés en portage salarial", M, y, { color: GRIS }); ecrire(`Mission : TJM ${eur2(r.tjm)} € × ${r.jours} jours`, 320, y, { color: GRIS });

  // Tableau
  y -= 26;
  const col = { lib: M + 6, base: 300, taux: 350, sal: 440, pat: W - M - 6 };
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: FOND });
  ecrire("Éléments de paie", col.lib, y, { size: 8, bold: true, color: GRIS });
  ecrire("Base", col.base, y, { size: 8, bold: true, color: GRIS, right: true });
  ecrire("Taux", col.taux, y, { size: 8, bold: true, color: GRIS, right: true });
  ecrire("Part salarié", col.sal, y, { size: 8, bold: true, color: GRIS, right: true });
  ecrire("Part employeur", col.pat, y, { size: 8, bold: true, color: GRIS, right: true });
  y -= 20;
  const ligne = (lib: string, o: { base?: string; taux?: string; sal?: string; pat?: string; fort?: boolean; fond?: boolean; indent?: boolean } = {}) => {
    if (o.fond) page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 17, color: FOND });
    ecrire(lib, col.lib + (o.indent ? 10 : 0), y, { bold: o.fort, size: o.indent ? 8.5 : 9 });
    if (o.base) ecrire(o.base, col.base, y, { right: true, color: GRIS });
    if (o.taux) ecrire(o.taux, col.taux, y, { right: true, color: GRIS });
    if (o.sal) ecrire(o.sal, col.sal, y, { right: true, bold: o.fort });
    if (o.pat) ecrire(o.pat, col.pat, y, { right: true, bold: o.fort, color: o.fort ? undefined : GRIS });
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.4, color: LIGNE });
    y -= 17;
  };
  const sousTitre = (t: string) => { y -= 4; ecrire(t, col.lib, y, { size: 7.5, bold: true, color: PLUM }); y -= 14; };

  sousTitre("RÉMUNÉRATION");
  ligne("Salaire de base (dont heures majorées à 25 %)", { base: eur2(166.84), sal: eur2(r.base) });
  ligne("Indemnité d'apport d'affaires", { base: eur2(r.base), taux: "5,00", sal: eur2(r.apport) });
  ligne("Réserve financière", { base: eur2(r.base), taux: "10,00", sal: eur2(r.reserve) });
  ligne("Indemnité compensatrice de congés payés", { base: eur2(r.base + r.apport + r.reserve), taux: "10,00", sal: eur2(r.cp) });
  ligne("SALAIRE BRUT", { sal: eur2(r.brut), fort: true, fond: true });

  sousTitre("COTISATIONS ET CONTRIBUTIONS SOCIALES");
  const groupes: Record<string, { sal: number; pat: number }> = {}, ordre: string[] = [];
  r.lignes.forEach((l: any) => { if (!groupes[l.rubrique]) { groupes[l.rubrique] = { sal: 0, pat: 0 }; ordre.push(l.rubrique); } groupes[l.rubrique].sal += l.sal; groupes[l.rubrique].pat += l.pat; });
  ordre.forEach((g) => ligne(g, { sal: groupes[g].sal ? eur2(groupes[g].sal) : "", pat: groupes[g].pat ? eur2(groupes[g].pat) : "" }));
  ligne("TOTAL DES COTISATIONS ET CONTRIBUTIONS", { sal: eur2(r.salariales), pat: eur2(r.patronales), fort: true, fond: true });

  sousTitre("NET");
  ligne("Net social", { sal: eur2(r.brut - r.salariales) });
  if (r.frais > 0) ligne("Remboursement de frais professionnels", { sal: eur2(r.frais) });
  ligne("NET À PAYER AVANT IMPÔT SUR LE REVENU", { sal: eur2(r.net + r.frais), fort: true, fond: true });
  ligne("Impôt sur le revenu prélevé à la source", { base: eur2(r.netImposable), taux: r.pas > 0 ? pct(r.pas) : "0,00", sal: r.impot ? "- " + eur2(r.impot) : "0,00" });

  // Net payé
  y -= 6;
  page.drawRectangle({ x: M, y: y - 10, width: W - 2 * M, height: 30, color: NAVY });
  ecrire("NET PAYÉ", col.lib, y, { size: 11, bold: true, color: rgb(1, 1, 1) });
  ecrire(eur2(r.totalPercu) + " €", W - M - 10, y, { size: 13, bold: true, color: rgb(1, 1, 1), right: true });
  y -= 40;

  // Récapitulatif employeur
  ecrire("RÉCAPITULATIF", M, y, { size: 7.5, bold: true, color: PLUM }); y -= 14;
  const recap: [string, string][] = [
    ["Chiffre d'affaires facturé", eur2(r.ca) + " €"], ["Frais de gestion HT Portage (5 %)", eur2(r.gestion) + " €"],
    ["Coût global (salaire, cotisations et frais)", eur2(r.coutEmployeur + r.frais) + " €"], ["Net imposable", eur2(r.netImposable) + " €"],
  ];
  recap.forEach(([k, v]) => { ecrire(k, M, y, { color: GRIS }); ecrire(v, 300, y, { right: true }); y -= 13; });

  // Mentions
  y -= 10;
  [
    "Exemple indicatif et non contractuel, calculé avec les taux de cotisations 2026 (mutuelle d'entreprise",
    "comprise). Le montant de vos frais professionnels et votre situation sont à affiner avec votre conseiller HT Portage.",
    "Un vrai bulletin de paie est établi chaque mois à partir du compte rendu d'activité validé par votre client.",
  ].forEach((l) => { ecrire(l, M, y, { size: 7.5, color: GRIS }); y -= 10; });
  ecrire("HT Portage · contact@htportage.fr · www.htportage.fr", W / 2 + 90, 28, { size: 7.5, color: GRIS, right: true });
  return await doc.save();
}

const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export async function pieceBulletin(r: any, nom: string) {
  return { filename: "Simulation-bulletin-de-salaire-HT-Portage.pdf", content: b64(await bulletinPdf(r, nom)) };
}

export function mailSimulation(record: Record<string, unknown>, r: any) {
  const prenom = prenomDe(record.nom);
  const lien = `${SITE}/espace/connexion.html?inscription=1&tjm=${r.tjm}&jours=${r.jours}&net=${Math.round(r.net)}`;
  return {
    sujet: "Votre simulation de salaire HT Portage",
    html: gabarit({
      titre: "Votre simulation de salaire",
      apercu: `Salaire net estimé : ${e0(r.pas > 0 ? r.netApresImpot : r.net)} par mois.`,
      corps: `<p style="margin:0 0 14px">Bonjour${prenom ? " " + esc(prenom) : ""},</p>` +
        `<p style="margin:0 0 14px">Merci pour votre demande. Voici votre simulation, calculée avec les taux de cotisations 2026.</p>` +
        tableau([
          ["Taux journalier", e0(r.tjm)], ["Jours travaillés par mois", String(r.jours)],
          ["Frais professionnels remboursés", e0(r.frais)],
          ["Salaire net avant impôt", e0(r.net)],
          ...(r.pas > 0 ? [["Salaire net après impôt", e0(r.netApresImpot)] as [string, unknown]] : []),
          ["Total perçu chaque mois", e0(r.totalPercu)],
        ]) +
        `<p style="margin:18px 0 0">Vous trouverez en <strong>pièce jointe</strong> un exemple de bulletin de salaire simplifié établi à partir de votre simulation.</p>` +
        `<p style="margin:16px 0 0">Un conseiller HT Portage vous contacte sous 24 h ouvrées pour affiner cette simulation avec vous : vos frais professionnels réels, votre mutuelle et votre situation.</p>`,
      bouton: { texte: "Créer mon espace consultant", url: lien },
      pied: "Simulation indicative et non contractuelle, établie à partir des informations saisies sur le simulateur. Pour toute question, répondez simplement à cet e-mail.",
    }),
  };
}

// ---------------------------------------------------------------------------
// Programme ambassadeur : e-mails au coopteur (merci + suivi) et à la personne cooptée (prise de rendez-vous)
// ---------------------------------------------------------------------------
const prenomDe = (nom: unknown) => String(nom ?? "").trim().split(/\s+/)[0] ?? "";
const bonjourDe = (nom: unknown) => { const p = prenomDe(nom); return `<p style="margin:0 0 14px">Bonjour${p ? " " + esc(p) : ""},</p>`; };
const P = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
const RDV = `mailto:${CONTACT}?subject=${encodeURIComponent("Rendez-vous HT Portage")}`;

async function autorise(cle: string, max: number, fenetre: number) {
  if (!admin) return true;
  const { data, error } = await admin.rpc("limiter", { p_cle: cle, p_max: max, p_fenetre: fenetre });
  return error ? true : data === true;
}

export function mailCoopteur(r: Record<string, unknown>, aUnCompte: boolean) {
  const contact = esc(r.contact_nom);
  const suivi = aUnCompte
    ? P("Vous pouvez suivre l'état d'avancement de votre recommandation à tout moment depuis votre espace ambassadeur.")
    : P(`Pour suivre l'état d'avancement de votre recommandation, créez votre espace HT Portage avec cette adresse e-mail (<strong>${esc(r.ambassadeur_email)}</strong>) : vous l'y retrouverez, ainsi que vos prochaines recommandations et vos primes.`);
  return {
    sujet: `Merci pour votre recommandation${prenomDe(r.ambassadeur_nom) ? ", " + prenomDe(r.ambassadeur_nom) : ""} !`,
    html: gabarit({
      titre: "Merci pour votre recommandation !",
      apercu: `Nous avons bien reçu votre recommandation de ${String(r.contact_nom ?? "")} et nous nous en occupons.`,
      corps: bonjourDe(r.ambassadeur_nom) +
        P(`Merci d'avoir pensé à HT Portage et de nous avoir recommandé <strong>${contact}</strong>. Votre confiance compte beaucoup pour nous.`) +
        P(`Nous avons bien reçu votre recommandation et notre équipe s'en occupe : nous allons prendre contact avec ${contact} très prochainement. Nous vous tiendrons au courant de chaque étape, jusqu'au versement de votre prime ambassadeur si la recommandation aboutit.`) +
        tableau([["Personne recommandée", r.contact_nom], ["Type", ({ consultant: "Consultant", mission: "Mission", client: "Client", formation: "Formation" } as Record<string, string>)[String(r.type)] ?? r.type], ["Reçue le", dateFr(String(r.created_at ?? new Date().toISOString()).slice(0, 10))]]) +
        suivi,
      bouton: aUnCompte ? { texte: "Suivre ma recommandation", url: `${SITE}/espace/ambassadeur.html` } : { texte: "Créer mon espace ambassadeur", url: `${SITE}/espace/connexion.html?inscription=1` },
      pied: "HT Portage — programme ambassadeur. Pour toute question, répondez simplement à cet e-mail.",
    }),
  };
}

export function mailCoopte(r: Record<string, unknown>) {
  const amb = esc(r.ambassadeur_nom);
  const type = String(r.type);
  let intro: string, titre: string, sujet: string;
  if (type === "consultant") {
    sujet = `${String(r.ambassadeur_nom ?? "Un de nos ambassadeurs")} vous a recommandé à HT Portage`;
    titre = "Nous avons bien reçu votre candidature";
    intro = P(`<strong>${amb}</strong>, qui fait partie du réseau d'ambassadeurs HT Portage, nous a transmis votre candidature en nous indiquant que le portage salarial pourrait vous intéresser.`) +
      P("Nous serions ravis d'échanger avec vous : votre projet, vos missions, le fonctionnement du portage avec HT Portage (statut salarié, frais de gestion fixes de 5 %, accompagnement) et, si vous le souhaitez, les missions du groupe Harington Technologies.");
  } else if (type === "mission" || type === "client") {
    sujet = `${String(r.ambassadeur_nom ?? "Un de nos ambassadeurs")} nous a parlé de vous`;
    titre = "Échangeons sur vos besoins";
    intro = P(`<strong>${amb}</strong>, qui fait partie du réseau d'ambassadeurs HT Portage, nous a indiqué que vous pourriez avoir besoin de consultants IT.`) +
      P("Nous serions ravis d'échanger avec vous pour comprendre votre besoin et vous présenter les profils de consultants que nous accompagnons.");
  } else {
    sujet = `${String(r.ambassadeur_nom ?? "Un de nos ambassadeurs")} vous a recommandé à HT Portage`;
    titre = "Prenons rendez-vous";
    intro = P(`<strong>${amb}</strong>, qui fait partie du réseau d'ambassadeurs HT Portage, nous a transmis vos coordonnées.`) +
      P("Nous serions ravis d'échanger avec vous pour mieux comprendre votre projet.");
  }
  return {
    sujet,
    html: gabarit({
      titre, apercu: "Prenons rendez-vous pour en parler.",
      corps: bonjourDe(r.contact_nom) + intro +
        P("Pour convenir d'un rendez-vous (20 minutes, par téléphone ou en visio), il vous suffit de <strong>répondre à cet e-mail en nous indiquant vos disponibilités</strong>. Un membre de notre équipe vous recontactera rapidement.") +
        (type === "consultant" ? P(`En attendant, vous pouvez estimer votre revenu net en portage avec notre <a href="${SITE}/simulateur.html" style="color:#784E61;font-weight:bold">simulateur</a>.`) : ""),
      bouton: { texte: "Proposer un rendez-vous", url: RDV },
      pied: `Vous recevez cet e-mail car ${amb} nous a transmis vos coordonnées avec votre accord. Si vous ne souhaitez pas être recontacté, répondez simplement « STOP » à cet e-mail : vos coordonnées seront supprimées.`,
    }),
  };
}

const SUIVI_RECO: Record<string, (r: Record<string, unknown>) => { sujet: string; titre: string; corps: string }> = {
  "en cours": (r) => ({ sujet: `Votre recommandation de ${r.contact_nom} avance`, titre: "Votre recommandation avance",
    corps: P(`Nous sommes en contact avec <strong>${esc(r.contact_nom)}</strong>. Nous vous tiendrons informé de la suite.`) }),
  validee: (r) => ({ sujet: `Bonne nouvelle : votre recommandation de ${r.contact_nom} a abouti`, titre: "Votre recommandation a abouti !",
    corps: P(`Bonne nouvelle : votre recommandation de <strong>${esc(r.contact_nom)}</strong> a abouti. Merci encore pour votre confiance !`) +
      P(r.prime_montant ? `Votre prime ambassadeur de <strong>${Number(r.prime_montant).toLocaleString("fr-FR")} €</strong> vous sera versée prochainement.` : "Votre prime ambassadeur vous sera versée prochainement : nous vous confirmerons son montant.") }),
  "prime versee": (r) => ({ sujet: "Votre prime ambassadeur a été versée", titre: "Votre prime a été versée",
    corps: P(`Votre prime ambassadeur${r.prime_montant ? ` de <strong>${Number(r.prime_montant).toLocaleString("fr-FR")} €</strong>` : ""} pour la recommandation de <strong>${esc(r.contact_nom)}</strong> a été versée. Merci de faire grandir la communauté HT Portage !`) }),
  refusee: (r) => ({ sujet: `Votre recommandation de ${r.contact_nom}`, titre: "Votre recommandation n'a pas abouti",
    corps: P(`Malgré nos échanges, la recommandation de <strong>${esc(r.contact_nom)}</strong> n'a pas pu aboutir cette fois-ci. Merci sincèrement d'avoir pensé à nous : n'hésitez pas à nous recommander d'autres personnes de votre entourage.`) }),
};

async function recommandation(payload: { type?: string; record?: Record<string, unknown>; old_record?: Record<string, unknown> }) {
  const r = payload.record ?? {};
  const ambEmail = String(r.ambassadeur_email ?? "").trim().toLowerCase();
  // Changement de statut → on tient l'ambassadeur au courant
  if (payload.type === "UPDATE") {
    const avant = payload.old_record?.statut;
    const suivi = SUIVI_RECO[String(r.statut)];
    if (!suivi || r.statut === avant || !ambEmail) return;
    if (!(await autorise("mail-suivi-reco:" + String(r.id) + ":" + String(r.statut), 1, 86400 * 30))) return;
    const m = suivi(r);
    await envoyer([ambEmail], m.sujet, gabarit({
      titre: m.titre, corps: bonjourDe(r.ambassadeur_nom) + m.corps + P("Vous pouvez suivre toutes vos recommandations depuis votre espace ambassadeur."),
      bouton: { texte: "Voir mes recommandations", url: `${SITE}/espace/ambassadeur.html` },
      pied: "HT Portage — programme ambassadeur. Pour toute question, répondez simplement à cet e-mail.",
    }), true);
    return;
  }
  if (payload.type !== "INSERT") return;
  // 1. Merci au coopteur
  if (ambEmail && await autorise("mail-amb:" + ambEmail, 10, 86400)) {
    let aUnCompte = !!r.user_id;
    if (!aUnCompte && admin) {
      const { data } = await admin.from("profils").select("id").ilike("email", ambEmail).maybeSingle();
      aUnCompte = !!data;
    }
    const m = mailCoopteur(r, aUnCompte);
    await envoyer([ambEmail], m.sujet, m.html, true);
  }
  // 2. Prise de contact avec la personne cooptée (si son e-mail est connu ; une fois par semaine au plus)
  const contactEmail = String(r.contact_email ?? "").trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail) && contactEmail !== ambEmail && await autorise("mail-coopte:" + contactEmail, 1, 86400 * 7)) {
    const m = mailCoopte(r);
    await envoyer([contactEmail], m.sujet, m.html, true);
  }
}

// ---------------------------------------------------------------------------
// Modification des informations d'un consultant → e-mail à l'équipe (avant / après)
// Les données sensibles (n° de sécurité sociale, IBAN, BIC) ne sont jamais écrites en clair dans l'e-mail.
// ---------------------------------------------------------------------------
const CHAMPS_PROFIL: [string, string][] = [
  ["civilite", "Civilité"], ["prenom", "Prénom"], ["nom", "Nom"], ["date_naissance", "Date de naissance"], ["lieu_naissance", "Lieu de naissance"],
  ["nationalite", "Nationalité"], ["num_secu", "N° de sécurité sociale"], ["telephone", "Téléphone"], ["adresse", "Adresse"],
  ["code_postal", "Code postal"], ["ville", "Ville"], ["pays", "Pays"], ["iban", "IBAN"], ["bic", "BIC"], ["competences", "Compétences"],
];
const SENSIBLES = new Set(["num_secu", "iban", "bic"]);
export function masquer(k: string, v: unknown): string {
  const t = String(v ?? "").replace(/\s/g, "");
  if (!t) return "—";
  if (!SENSIBLES.has(k)) return k === "date_naissance" ? dateFr(t) : String(v);
  return (k === "iban" ? t.slice(0, 4) : "") + "•••• " + t.slice(-4);
}
export function differences(avant: Record<string, unknown>, apres: Record<string, unknown>) {
  const norm = (v: unknown) => String(v ?? "").trim();
  return CHAMPS_PROFIL.filter(([k]) => norm(avant[k]) !== norm(apres[k])).map(([k, l]) => ({ champ: l, avant: masquer(k, avant[k]), apres: masquer(k, apres[k]) }));
}

async function profilModifie(payload: { type?: string; record?: Record<string, unknown>; old_record?: Record<string, unknown> }) {
  if (payload.type !== "UPDATE" || !payload.old_record || !payload.record) return new Response("Ignored", { status: 200 });
  const r = payload.record, diff = differences(payload.old_record, r);
  if (!diff.length) return new Response("Ignored", { status: 200 });
  if (admin) {
    const { data: ok, error } = await admin.rpc("limiter", { p_cle: "mail-profil:" + String(r.id), p_max: 20, p_fenetre: 3600 });
    if (!error && ok === false) return new Response("Throttled", { status: 200 });
  }
  const nom = [r.prenom, r.nom].filter(Boolean).join(" ") || String(r.email ?? "");
  const lignes = diff.map((d) => `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #ECE8EE;color:#6B7385;vertical-align:top;white-space:nowrap">${esc(d.champ)}</td><td style="padding:8px 12px 8px 0;border-bottom:1px solid #ECE8EE;color:#8A8F9C;text-decoration:line-through">${esc(d.avant)}</td><td style="padding:8px 0;border-bottom:1px solid #ECE8EE;color:#1B1C1C;font-weight:bold">${esc(d.apres)}</td></tr>`).join("");
  const html = gabarit({
    interne: true, titre: "Informations consultant modifiées",
    apercu: `${nom} a modifié ${diff.length} information${diff.length > 1 ? "s" : ""}.`,
    corps: `<p style="margin:0 0 14px"><strong>${esc(nom)}</strong> (${esc(r.email)}${r.statut ? " · " + esc(r.statut) : ""}) a modifié ${diff.length > 1 ? diff.length + " informations" : "une information"} de son espace le ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" })}.</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 8px"><tr><th align="left" style="padding:0 12px 6px 0;color:#6B7385;font-size:12px;text-transform:uppercase">Information</th><th align="left" style="padding:0 12px 6px 0;color:#6B7385;font-size:12px;text-transform:uppercase">Avant</th><th align="left" style="padding:0 0 6px;color:#6B7385;font-size:12px;text-transform:uppercase">Après</th></tr>${lignes}</table>` +
      (diff.some((d) => /sécurité|IBAN|BIC/.test(d.champ)) ? `<p style="margin:12px 0 0;font-size:13px;color:#6B7385">Par sécurité, le n° de sécurité sociale, l'IBAN et le BIC sont masqués : consultez-les dans l'administration.</p>` : ""),
    bouton: { texte: "Ouvrir l'administration", url: `${SITE}/espace/admin.html#consultants` },
  });
  return (await envoyer(NOTIFY_TO, `Informations modifiées — ${nom}`, html, false, String(r.email ?? ""))) ? new Response("OK") : new Response("Email failed", { status: 502 });
}

if (Deno.env.get("HTP_TEST") !== "1") Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const table: string = payload?.table ?? "";
  const record: Record<string, unknown> = payload?.record ?? {};

  if (table === "consultant_missions") return await mission(payload);
  if (table === "profils") return await profilModifie(payload);
  // Recommandations : e-mails au coopteur et au coopté (création), suivi au coopteur (changement de statut)
  if (table === "recommandations") {
    try { await recommandation(payload); } catch (e) { console.error("E-mails ambassadeur", e); }
    if (payload?.type === "UPDATE") return new Response("OK", { status: 200 });
  }
  if (payload?.type !== "INSERT" || !LABELS[table]) return new Response("Ignored", { status: 200 });

  // Plafond : 15 e-mails de demandes par heure. Au-delà, une seule alerte par heure (protège la boîte et le quota Resend).
  if (admin) {
    const { data: ok, error: el } = await admin.rpc("limiter", { p_cle: "mail-demandes", p_max: 15, p_fenetre: 3600 });
    if (!el && ok === false) {
      const { data: alerte } = await admin.rpc("limiter", { p_cle: "mail-alerte-volume", p_max: 1, p_fenetre: 3600 });
      if (alerte === true) {
        await envoyer(NOTIFY_TO, "Alerte : afflux inhabituel de demandes sur le site", gabarit({
          interne: true, titre: "Afflux inhabituel de demandes",
          corps: `<p style="margin:0 0 14px">Plus de 15 demandes sont arrivées par le site au cours de la dernière heure. Pour ne pas saturer votre boîte, les e-mails individuels sont suspendus pendant une heure.</p>` +
            `<p style="margin:0">Toutes les demandes restent enregistrées et consultables dans l'administration. S'il s'agit d'envois automatiques, prévenez-nous : la protection anti-robot peut être renforcée.</p>`,
          bouton: { texte: "Voir les demandes reçues", url: `${SITE}/espace/admin.html#demandes` },
        }));
      }
      return new Response("Throttled", { status: 200 });
    }
  }

  // Demande de simulation : le candidat reçoit sa simulation et un exemple de bulletin de salaire
  let pieceInterne: { filename: string; content: string }[] = [];
  if (table === "contacts" && record.type === "simulation") {
    try {
      const r = simulationDepuis(record);
      const email = String(record.email ?? "").trim().toLowerCase();
      if (r) {
        const piece = await pieceBulletin(r, String(record.nom ?? ""));
        pieceInterne = [piece];
        if (email && await autorise("mail-simulation:" + email, 3, 86400)) {
          const m = mailSimulation(record, r);
          await envoyer([email], m.sujet, m.html, true, "", [piece]);
        }
      }
    } catch (e) { console.error("E-mail de simulation", e); }
  }

  let titre = LABELS[table];
  if (table === "contacts" && record.type === "simulation") titre = "Nouvelle demande de simulation";
  const qui = String(record.nom ?? record.ambassadeur_nom ?? "").trim();
  const sujet = titre + (qui ? ` — ${qui}` : "");

  const lignes = Object.entries(record)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "")
    .map(([k, v]) => [libelle(k), k === "created_at" ? new Date(String(v)).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : v] as [string, unknown]);

  let cv = "";
  if (admin && table === "candidatures" && typeof record.cv_path === "string" && record.cv_path) {
    const { data } = await admin.storage.from("cv").createSignedUrl(record.cv_path, 60 * 60 * 24 * 7);
    if (data?.signedUrl) cv = `<p style="margin:16px 0 0"><a href="${esc(data.signedUrl)}" style="color:#784E61;font-weight:bold">Télécharger le CV</a> <span style="color:#6B7385">(lien valable 7 jours)</span></p>`;
  }

  const html = gabarit({
    interne: true, titre, apercu: sujet,
    corps: `<p style="margin:0 0 14px">Une nouvelle demande vient d'arriver par le site.${record.email ? ` Vous pouvez répondre directement à <a href="mailto:${esc(record.email)}" style="color:#784E61">${esc(record.email)}</a>.` : ""}</p>` + tableau(lignes) + cv + (pieceInterne.length ? `<p style="margin:16px 0 0">Le bulletin simplifié envoyé au candidat est en pièce jointe.</p>` : ""),
    bouton: { texte: "Voir les demandes reçues", url: `${SITE}/espace/admin.html#demandes` },
  });
  return (await envoyer(NOTIFY_TO, sujet, html, false, String(record.email ?? record.ambassadeur_email ?? ""), pieceInterne)) ? new Response("OK", { status: 200 }) : new Response("Email failed", { status: 502 });
});
