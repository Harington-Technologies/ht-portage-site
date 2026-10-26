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
async function envoyer(to: string[], sujet: string, html: string, externe = false) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: externe ? `Service Administratif HT PORTAGE <${adresseFrom()}>` : NOTIFY_FROM,
      to, subject: sujet, html,
      ...(externe ? { reply_to: NOTIFY_TO[0] ?? CONTACT } : {}),
    }),
  });
  if (!r.ok) { console.error("Resend error", r.status, await r.text()); return false; }
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
    return (await envoyer(NOTIFY_TO, sujet, html)) ? new Response("OK") : new Response("Email failed", { status: 502 });
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

if (Deno.env.get("HTP_TEST") !== "1") Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const table: string = payload?.table ?? "";
  const record: Record<string, unknown> = payload?.record ?? {};

  if (table === "consultant_missions") return await mission(payload);
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
    corps: `<p style="margin:0 0 14px">Une nouvelle demande vient d'arriver par le site.${record.email ? ` Vous pouvez répondre directement à <a href="mailto:${esc(record.email)}" style="color:#784E61">${esc(record.email)}</a>.` : ""}</p>` + tableau(lignes) + cv,
    bouton: { texte: "Voir les demandes reçues", url: `${SITE}/espace/admin.html#demandes` },
  });
  return (await envoyer(NOTIFY_TO, sujet, html)) ? new Response("OK", { status: 200 }) : new Response("Email failed", { status: 502 });
});
