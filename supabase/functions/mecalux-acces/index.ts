// @ts-nocheck
// Pilotage équipe Mecalux — comptes et demandes d'accès.
//   POST { action: "inscription", prenom, nom, email, password }   → crée le compte et envoie le lien de confirmation (e-mail « Pilotage »)
//   POST { action: "oubli", email }                                → envoie un lien pour choisir un nouveau mot de passe
//   POST { action: "decider", d, decision, role? }                        → valide ou refuse (administrateur connecté avec double authentification) ;
//                                                                      un refus supprime le compte s'il a été créé pour le pilotage (jamais un compte HT Portage)
//   POST { action: "retirer", email }                              → retire l'accès et supprime le compte s'il a été créé pour le pilotage (administrateur)
//   POST { action: "partager_prefactures", a: [emails], fichiers: [{chemin, nom}], mois, message? } → envoie les PDF des préfactures
//                                                                      à des membres de l'équipe (membre Harington connecté avec double authentification)
//   POST { action: "reinit_mfa", email }                           → supprime la double authentification d'un membre (téléphone perdu ; administrateur)
//   POST (déclencheur base, en-tête x-webhook-secret) INSERT mecalux_demandes → e-mail aux administrateurs : valider / refuser
//   POST (déclencheur base, en-tête x-webhook-secret) INSERT mecalux_pf_evenements → e-mail du circuit des préfactures aux bonnes personnes
//   POST (déclencheur base, en-tête x-webhook-secret) INSERT mecalux_fiche_evenements → fiche hebdomadaire (temps perdus, change requests) : signature du chef de projet Mecalux
// Secrets partagés du projet : RESEND_API_KEY, NOTIFY_FROM, WEBHOOK_SECRET. « Verify JWT » désactivé.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const SITE = "https://www.htportage.fr/mecalux/";
const ORIGINES = ["https://www.htportage.fr", "https://htportage.fr"];

function serverKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const vals = Array.isArray(keys) ? keys : Object.values(keys);
    return vals.map((v) => typeof v === "string" ? v : v?.key).find(Boolean) ?? "";
  } catch { return ""; }
}
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serverKey(), { auth: { persistSession: false } });

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function gabarit(titre: string, corps: string, bouton?: { texte: string; url: string }, bouton2?: { texte: string; url: string }) {
  const btn = (b, fond, couleur) => `<td style="background:${fond};border-radius:999px;padding:0"><a href="${esc(b.url)}" style="display:inline-block;padding:13px 26px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:${couleur};text-decoration:none">${esc(b.texte)}</a></td>`;
  const boutons = bouton ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px"><tr>${btn(bouton, "#21324E", "#ffffff")}${bouton2 ? `<td style="width:12px"></td>${btn(bouton2, "#F3E6EC", "#784E61")}` : ""}</tr></table>` : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(titre)}</title></head>
<body style="margin:0;padding:0;background:#F1F4F7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F4F7"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#21324E;padding:22px 32px"><span style="font-family:Arial,sans-serif;font-size:17px;font-weight:bold;letter-spacing:2px;color:#ffffff">PILOTAGE ÉQUIPE MECALUX</span><div style="width:36px;height:3px;background:#C187A1;margin-top:8px;border-radius:2px"></div></td></tr>
<tr><td style="padding:32px 32px 28px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1B1C1C"><h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:#21324E">${esc(titre)}</h1>${corps}${boutons}</td></tr>
<tr><td style="background:#F7F8FA;padding:16px 32px;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#6B7385">E-mail envoyé automatiquement par le pilotage de l'équipe Harington chez Mecalux.</td></tr>
</table></td></tr></table></body></html>`;
}
const P = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
const texte = (html: string) => html.replace(/<(style|title|head)[\s\S]*?<\/\1>/gi, "").replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, u, t) => t.replace(/<[^>]+>/g, "") + " : " + u)
  .replace(/<\/(p|h1|tr|table)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");

async function envoyer(to: string[], sujet: string, html: string, extra: { cc?: string[]; attachments?: { filename: string; content: string }[]; reply_to?: string } = {}) {
  const from = (NOTIFY_FROM.match(/<([^>]+)>/)?.[1] ?? NOTIFY_FROM).trim();
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `Pilotage Mecalux <${from}>`, to, subject: sujet, html, text: texte(html), ...(extra.cc?.length ? { cc: extra.cc } : {}), ...(extra.attachments?.length ? { attachments: extra.attachments } : {}), ...(extra.reply_to ? { reply_to: extra.reply_to } : {}) }),
  });
  if (!r.ok) { console.error("Resend", r.status, await r.text()); return false; }
  return true;
}
async function autorise(cle: string, max: number, fenetre: number) {
  const { data, error } = await admin.rpc("limiter", { p_cle: cle, p_max: max, p_fenetre: fenetre });
  return error ? true : data === true;
}
async function admins(): Promise<string[]> {
  const { data } = await admin.from("mecalux_equipe").select("email").eq("admin", true);
  return (data ?? []).map((x) => x.email).filter((e) => EMAIL_OK.test(e));
}

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGINES.includes(o) ? o : ORIGINES[0], "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

// ---------- Circuit des préfactures (déclencheur) → e-mail à chaque étape ----------
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const eur = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
async function pieceJointe(chemin: string, nom: string) {
  if (!chemin) return null;
  const { data, error } = await admin.storage.from("mecalux-justifs").download(chemin);
  if (error || !data) { console.error("pièce", chemin, error?.message); return null; }
  const o = new Uint8Array(await data.arrayBuffer()); let bin = ""; for (let i = 0; i < o.length; i += 0x8000) bin += String.fromCharCode(...o.subarray(i, i + 0x8000));
  return { filename: nom, content: btoa(bin) };
}
async function etapePrefacture(ev) {
  const { data: pf } = await admin.from("mecalux_prefactures").select("*").eq("id", ev.pf_id).maybeSingle();
  if (!pf) return;
  const { data: p } = await admin.from("mecalux_projets").select("*").eq("id", pf.projet_id).maybeSingle();
  const { data: circ } = await admin.from("mecalux_circuit").select("role,nom,email");
  const C = Object.fromEntries((circ ?? []).map((x) => [x.role, x]));
  let cpH = null;
  if (p?.cp_harington_id) { const { data: r } = await admin.from("mecalux_ressources").select("nom,email").eq("id", p.cp_harington_id).maybeSingle(); cpH = r; }
  const ok = (e) => EMAIL_OK.test(String(e ?? "").trim());
  const em = (...l) => [...new Set(l.flat().map((e) => String(e ?? "").trim().toLowerCase()).filter(ok))];
  const adv = em(C.adv?.email), advM = em(C.adv_mecalux?.email), prep = em(C.preparation?.email, cpH?.email), cpM = em(p?.cp_mecalux_email);
  const [an, mo] = String(pf.mois).split("-"); const periode = `${MOIS[+mo - 1]} ${an}`;
  const total = (pf.lignes ?? []).reduce((x, l) => x + (Number(l.montant) || 0), 0);
  const projet = [p?.client, p?.nom].filter(Boolean).join(" · ") + (p?.site ? ` (${p.site})` : "");
  const lien = SITE + "#prefacture-" + pf.id;
  const com = ev.commentaire ? P(`<b>Commentaire :</b> ${esc(ev.commentaire)}`) : "";
  const resume = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;font-size:14px"><tr><td style="color:#6B7385;padding:3px 14px 3px 0">Projet</td><td><b>${esc(projet)}</b></td></tr><tr><td style="color:#6B7385;padding:3px 14px 3px 0">Période</td><td>${esc(periode)}</td></tr><tr><td style="color:#6B7385;padding:3px 14px 3px 0">Montant HT</td><td><b>${esc(eur(total))}</b></td></tr>${pf.bdc ? `<tr><td style="color:#6B7385;padding:3px 14px 3px 0">Bon de commande</td><td><b>${esc(pf.bdc)}</b></td></tr>` : ""}${pf.numero_facture ? `<tr><td style="color:#6B7385;padding:3px 14px 3px 0">Facture</td><td><b>${esc(pf.numero_facture)}</b></td></tr>` : ""}</table>`;
  const nomF = (t) => `${t} ${String(p?.client ?? "")} ${String(p?.site ?? p?.nom ?? "")} ${pf.mois}.pdf`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ");
  const F = pf.fichiers ?? {};
  let to: string[] = [], cc: string[] = [], titre = "", corps = "", bouton = null, pj = [];
  const sujetBase = `Préfacture ${periode} — ${projet}`;
  switch (ev.action) {
    case "soumettre":
      to = adv; cc = prep; titre = "Préfacture à vérifier";
      corps = P(`Bonjour${C.adv?.nom ? " " + esc(C.adv.nom) : ""},`) + P("Une préfacture est prête : merci de la vérifier avant envoi à Mecalux.") + resume + com;
      bouton = { texte: "Vérifier la préfacture", url: lien }; break;
    case "adv_renvoyer":
      to = prep; cc = adv; titre = "Préfacture à corriger";
      corps = P("Le Responsable ADV Harington a renvoyé la préfacture pour correction.") + resume + com; bouton = { texte: "Corriger la préfacture", url: lien }; break;
    case "adv_valider":
      to = em(advM, cpM); cc = em(adv, prep); titre = "Préfacture Harington pour validation";
      corps = P("Bonjour,") + P(`Veuillez trouver ci-joint la préfacture Harington de ${esc(periode)}.`) + resume + com +
        P(`${C.adv_mecalux?.nom ? esc(C.adv_mecalux.nom) + ", merci" : "Merci"} de la valider dans le pilotage en indiquant le numéro du bon de commande, ou de la refuser avec un commentaire.`);
      bouton = { texte: "Valider la préfacture", url: lien }; pj = [await pieceJointe(F.pdf, nomF("Préfacture"))]; break;
    case "mecalux_valider":
      to = adv; cc = prep; titre = "Bon de commande reçu";
      corps = P(`Bonjour${C.adv?.nom ? " " + esc(C.adv.nom) : ""},`) + P("Mecalux a validé la préfacture et transmis le bon de commande : vous pouvez facturer.") + resume + com;
      bouton = { texte: "Facturer", url: lien }; pj = [await pieceJointe(F.bdc, nomF("BDC " + (pf.bdc ?? "")))]; break;
    case "mecalux_refuser":
      to = adv; cc = prep; titre = "Préfacture refusée par Mecalux";
      corps = P("Mecalux a refusé la préfacture.") + resume + com; bouton = { texte: "Voir la préfacture", url: lien }; break;
    case "facturer":
      to = em(advM, cpM); cc = em(adv, prep); titre = "Facture Harington";
      corps = P("Bonjour,") + P(`Veuillez trouver ci-joint la facture Harington correspondant à la préfacture de ${esc(periode)}.`) + resume + com;
      pj = [await pieceJointe(F.facture, nomF("Facture " + (pf.numero_facture ?? "")))]; break;
    case "rouvrir":
      to = prep; cc = adv; titre = "Préfacture rouverte";
      corps = P("La préfacture a été remise en brouillon.") + resume + com; bouton = { texte: "Voir la préfacture", url: lien }; break;
    default: return;
  }
  cc = cc.filter((e) => !to.includes(e));
  if (!to.length) { to = cc.length ? cc : await admins(); cc = []; }
  if (!to.length) return;
  await envoyer(to, `${titre} — ${sujetBase}`, gabarit(titre, corps, bouton ?? undefined), { cc, attachments: pj.filter(Boolean) });
}

// ---------- Fiche hebdomadaire d'un projet au forfait (déclencheur) ----------
async function etapeFiche(ev) {
  const { data: f } = await admin.from("mecalux_fiches").select("*").eq("id", ev.fiche_id).maybeSingle();
  if (!f) return;
  const { data: p } = await admin.from("mecalux_projets").select("*").eq("id", f.projet_id).maybeSingle();
  if (!p) return;
  let cpH = null;
  if (p.cp_harington_id) { const { data: r } = await admin.from("mecalux_ressources").select("nom,email").eq("id", p.cp_harington_id).maybeSingle(); cpH = r; }
  const ok = (e) => EMAIL_OK.test(String(e ?? "").trim());
  const em = (...l) => [...new Set(l.flat().map((e) => String(e ?? "").trim().toLowerCase()).filter(ok))];
  const projet = [p.client, p.nom].filter(Boolean).join(" · ") + (p.site ? ` (${p.site})` : "");
  const sem = String(f.semaine); const n = Number(sem.split("-W")[1]);
  const A = f.contenu?.aleas ?? [], C = f.contenu?.cr ?? [];
  const tA = A.reduce((x, a) => x + (Number(a.montant_jours) || 0) + (Number(a.frais) || 0), 0), jA = A.reduce((x, a) => x + (Number(a.jours) || 0), 0);
  const tC = C.reduce((x, c) => x + (Number(c.impact_montant) || 0), 0);
  const lien = SITE + "#projet-" + p.id;
  const resume = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;font-size:14px"><tr><td style="color:#6B7385;padding:3px 14px 3px 0">Projet</td><td><b>${esc(projet)}</b></td></tr><tr><td style="color:#6B7385;padding:3px 14px 3px 0">Semaine</td><td>${n}</td></tr><tr><td style="color:#6B7385;padding:3px 14px 3px 0">Temps perdus sur site</td><td><b>${A.length}</b> · ${esc(String(jA).replace(".", ","))} j-h · ${esc(eur(tA))}</td></tr><tr><td style="color:#6B7385;padding:3px 14px 3px 0">Change requests</td><td><b>${C.length}</b> · ${esc(eur(tC))}</td></tr></table>`;
  const detail = (A.length ? P("<b>Temps perdus</b><br>" + A.map((a) => `${esc(a.date_debut)}${a.date_fin !== a.date_debut ? " → " + esc(a.date_fin) : ""} · ${esc(a.cause)} · ${esc(String(a.jours).replace(".", ","))} j-h`).join("<br>")) : "") +
    (C.length ? P("<b>Change requests</b><br>" + C.map((c) => `${esc(c.numero)} · ${esc(c.titre)} · ${esc(eur(c.impact_montant))}`).join("<br>")) : "");
  const com = ev.commentaire ? P(`<b>Commentaire :</b> ${esc(ev.commentaire)}`) : "";
  const harington = em(f.envoyee_par, cpH?.email);
  if (ev.action === "envoyer") {
    const to = em(p.cp_mecalux_email); if (!to.length) return;
    await envoyer(to, `À signer — temps perdus et change requests, semaine ${n} — ${projet}`, gabarit("Fiche de la semaine à valider et signer",
      P(`Bonjour${p.cp_mecalux_prenom ? " " + esc(p.cp_mecalux_prenom) : ""},`) + P("Harington vous transmet le relevé de la semaine pour ce projet au forfait : temps perdus sur site (équipe présente sans pouvoir travailler) et change requests.") + resume + detail + com +
      P("Merci de le valider et de le signer dans le pilotage, avec votre compte, ou de le refuser en indiquant le motif."),
      { texte: "Valider et signer", url: lien }), { cc: harington.filter((e) => !to.includes(e)) });
  } else if (ev.action === "signer" || ev.action === "refuser") {
    const to = harington.length ? harington : await admins(); if (!to.length) return;
    const signe = ev.action === "signer";
    await envoyer(to, `${signe ? "Signée" : "Refusée"} — fiche semaine ${n} — ${projet}`, gabarit(signe ? "Fiche signée par Mecalux" : "Fiche refusée par Mecalux",
      P(signe ? `${esc(f.signataire || ev.par_email)} a validé et signé la fiche de la semaine ${n}. Les temps perdus et les change requests sont désormais validés.` : `${esc(ev.par_email)} a refusé la fiche de la semaine ${n}. Corrigez les éléments concernés puis renvoyez-la pour signature.`) + resume + com,
      { texte: "Voir le projet", url: lien }));
  }
}

// ---------- Demande créée (déclencheur) → e-mail aux administrateurs ----------
async function nouvelleDemande(d) {
  const dest = await admins();
  if (!dest.length || d.statut !== "en_attente") return;
  const nom = [d.prenom, d.nom].filter(Boolean).join(" ") || d.email;
  const lien = SITE + "#acces";
  const html = gabarit("Nouvelle demande d'accès",
    P(`<strong>${esc(nom)}</strong> (<a href="mailto:${esc(d.email)}" style="color:#784E61">${esc(d.email)}</a>) a créé son compte et demande l'accès au pilotage de l'équipe Mecalux.`) +
    P("Une fois validé, il aura accès à l'ensemble du pilotage : projets, ressources, frais, justificatifs et préfactures.") +
    P(`<span style="color:#6B7385;font-size:13px">Par sécurité, la décision se prend dans le pilotage, après connexion avec votre code de double authentification.</span>`),
    { texte: "Valider ou refuser", url: lien });
  await envoyer(dest, `Demande d'accès au pilotage Mecalux — ${nom}`, html);
}

// Administrateur du pilotage, session validée par la double authentification (aal2)
async function adminConnecte(req: Request): Promise<string> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return "";
  const { data: u, error } = await admin.auth.getUser(jwt);
  if (error || !u?.user?.email) return "";
  let aal = "";
  try { aal = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal ?? ""; } catch { aal = ""; }
  if (aal !== "aal2") return "";
  const { data: ad } = await admin.from("mecalux_equipe").select("email").ilike("email", u.user.email).eq("admin", true).maybeSingle();
  return ad ? u.user.email : "";
}

// Membre Harington du pilotage (admin, superuser ou harington), session validée par la double authentification (aal2)
async function haringtonConnecte(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: u, error } = await admin.auth.getUser(jwt);
  if (error || !u?.user?.email) return null;
  let aal = "";
  try { aal = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal ?? ""; } catch { aal = ""; }
  if (aal !== "aal2") return null;
  const { data: m } = await admin.from("mecalux_equipe").select("email,nom,role,admin").ilike("email", u.user.email).maybeSingle();
  return m && (m.admin || ["admin", "superuser", "harington"].includes(m.role)) ? m : null;
}

// Envoi des préfactures d'un mois à des membres de l'équipe choisis dans la liste
async function partagerPrefactures(req: Request, b) {
  const par = await haringtonConnecte(req);
  if (!par) return json(req, { erreur: "Action réservée à l'équipe Harington connectée avec la double authentification." }, 403);
  if (!(await autorise("mecalux-partage:" + par.email.toLowerCase(), 20, 3600))) return json(req, { erreur: "Trop d'envois : réessayez plus tard." }, 429);
  const a = [...new Set((Array.isArray(b.a) ? b.a : []).map((e) => String(e ?? "").trim().toLowerCase()).filter((e) => EMAIL_OK.test(e)))].slice(0, 20);
  if (!a.length) return json(req, { erreur: "Choisissez au moins un destinataire." }, 400);
  const { data: eq } = await admin.from("mecalux_equipe").select("email");
  const equipe = new Set((eq ?? []).map((x) => String(x.email).toLowerCase()));
  const hors = a.filter((e) => !equipe.has(e));
  if (hors.length) return json(req, { erreur: "Destinataire hors de l'équipe : " + hors.join(", ") }, 400);
  const fichiers = (Array.isArray(b.fichiers) ? b.fichiers : []).slice(0, 40);
  if (!fichiers.length) return json(req, { erreur: "Aucune préfacture à envoyer." }, 400);
  const pj = []; let taille = 0;
  for (const f of fichiers) {
    const chemin = String(f?.chemin ?? "");
    if (!/^prefactures\/partage\/[\w-]+\/[\w.-]+\.pdf$/.test(chemin)) return json(req, { erreur: "Fichier refusé." }, 400);
    const nom = String(f?.nom ?? "prefacture.pdf").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120);
    const x = await pieceJointe(chemin, /\.pdf$/i.test(nom) ? nom : nom + ".pdf");
    if (!x) return json(req, { erreur: "Fichier introuvable : " + nom }, 400);
    taille += x.content.length; if (taille > 30_000_000) return json(req, { erreur: "Pièces jointes trop lourdes : envoyez moins de préfactures à la fois." }, 400);
    pj.push(x);
  }
  const m = String(b.mois ?? ""); const [an, mo] = m.split("-"); const periode = /^\d{4}-\d{2}$/.test(m) ? `${MOIS[+mo - 1]} ${an}` : "";
  const qui = par.nom || par.email;
  const message = String(b.message ?? "").trim().slice(0, 2000);
  const liste = `<ul style="margin:0 0 16px;padding-left:20px">${pj.map((x) => `<li>${esc(x.filename)}</li>`).join("")}</ul>`;
  const html = gabarit(`Préfactures${periode ? " de " + periode : ""}`,
    P("Bonjour,") + P(`${esc(qui)} vous transmet ${pj.length > 1 ? `les ${pj.length} préfactures` : "la préfacture"}${periode ? " de " + esc(periode) : ""}, en pièce jointe.`) +
    (message ? P(esc(message).replace(/\n/g, "<br>")) : "") + liste +
    P(`<span style="color:#6B7385;font-size:13px">Documents de travail, non valables comme factures.</span>`),
    { texte: "Ouvrir le pilotage", url: SITE + "#prefactures" });
  const ok = await envoyer(a, `Préfactures${periode ? " " + periode : ""} — envoyées par ${qui}`, html, { attachments: pj, reply_to: par.email });
  if (!ok) return json(req, { erreur: "L'envoi de l'e-mail a échoué. Réessayez." }, 502);
  console.log("Préfactures partagées", pj.length, "→", a.join(", "), "par", par.email);
  for (const f of fichiers) await admin.storage.from("mecalux-justifs").remove([String(f.chemin)]);
  return json(req, { ok: true, n: pj.length, a });
}

async function decider(req: Request, b) {
  const { data: d } = await admin.from("mecalux_demandes").select("*").eq("id", b.d).maybeSingle();
  if (!d) return json(req, { erreur: "Demande introuvable." }, 404);
  const ad = await adminConnecte(req);
  if (!ad) return json(req, { erreur: "Action réservée aux administrateurs connectés avec la double authentification." }, 403);
  const par = ad;
  if (d.statut !== "en_attente") return json(req, { ok: true, deja: true, statut: d.statut, email: d.email });
  const valider = b.decision === "valider";
  const nom = [d.prenom, d.nom].filter(Boolean).join(" ");
  if (valider) {
    // Rôle choisi par l'administrateur ; à défaut : Harington pour une adresse @harington.fr, sinon Mecalux
    const role = ["admin", "harington", "mecalux"].includes(b.role) ? b.role : (/@harington\.fr$/i.test(d.email) ? "harington" : "mecalux");
    const { error } = await admin.from("mecalux_equipe").upsert({ email: d.email.toLowerCase(), nom: nom || null, role }, { onConflict: "email", ignoreDuplicates: true });
    if (error) { console.error(error); return json(req, { erreur: "Enregistrement impossible." }, 500); }
  }
  await admin.from("mecalux_demandes").update({ statut: valider ? "acceptee" : "refusee", traite_le: new Date().toISOString(), traite_par: par }).eq("id", d.id);
  if (valider) await envoyer([d.email], "Votre accès au pilotage Mecalux est ouvert", gabarit("Votre accès est ouvert",
    P(`Bonjour${d.prenom ? " " + esc(d.prenom) : ""},`) + P("Votre demande a été validée : vous pouvez vous connecter au pilotage de l'équipe Mecalux avec l'adresse et le mot de passe choisis lors de la création de votre compte."),
    { texte: "Accéder au pilotage", url: SITE + "connexion.html" }));
  let supprime = false;
  if (!valider) {
    // Suppression du compte, uniquement s'il a été créé pour le pilotage et qu'il n'est pas dans l'équipe
    const uid = d.user_id || (await admin.rpc("mecalux_id_compte", { p_email: d.email })).data;
    if (uid) {
      const { data: u } = await admin.auth.admin.getUserById(uid);
      const { data: membre } = await admin.from("mecalux_equipe").select("email").ilike("email", d.email).maybeSingle();
      if (u?.user && u.user.user_metadata?.app === "mecalux" && !membre) {
        const { error } = await admin.auth.admin.deleteUser(uid);
        if (error) console.error("Suppression du compte refusé", error); else { supprime = true; console.log("Compte refusé supprimé", d.email, "par", par); }
      }
    }
    await envoyer([d.email], "Votre demande d'accès au pilotage Mecalux", gabarit("Votre demande n'a pas été acceptée",
      P(`Bonjour${d.prenom ? " " + esc(d.prenom) : ""},`) + P("Votre demande d'accès au pilotage de l'équipe Mecalux n'a pas été acceptée" + (supprime ? " et le compte créé a été supprimé" : "") + ". Si vous pensez qu'il s'agit d'une erreur, contactez votre interlocuteur Harington.")));
  }
  return json(req, { ok: true, statut: valider ? "acceptee" : "refusee", email: d.email, supprime });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Déclencheur base de données
  if (req.headers.get("x-webhook-secret")) {
    if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });
    const p = await req.json().catch(() => null);
    if (p?.table === "mecalux_demandes" && p?.type === "INSERT" && p.record) {
      try { await nouvelleDemande(p.record); } catch (e) { console.error(e); }
    }
    if (p?.table === "mecalux_pf_evenements" && p?.type === "INSERT" && p.record) {
      try { await etapePrefacture(p.record); } catch (e) { console.error(e); }
    }
    if (p?.table === "mecalux_fiche_evenements" && p?.type === "INSERT" && p.record) {
      try { await etapeFiche(p.record); } catch (e) { console.error(e); }
    }
    return new Response("OK");
  }

  const b = await req.json().catch(() => ({}));
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  try {
    if (b.action === "inscription") {
      const email = String(b.email ?? "").trim().toLowerCase(), prenom = String(b.prenom ?? "").trim().slice(0, 100), nom = String(b.nom ?? "").trim().slice(0, 100), password = String(b.password ?? "");
      if (!EMAIL_OK.test(email) || !prenom || !nom) return json(req, { erreur: "Merci de compléter tous les champs." }, 400);
      if (password.length < 10) return json(req, { erreur: "Le mot de passe doit faire au moins 10 caractères." }, 400);
      if (!(await autorise("mecalux-inscr-ip:" + ip, 5, 3600)) || !(await autorise("mecalux-inscr:" + email, 3, 86400))) return json(req, { erreur: "Trop de tentatives : réessayez plus tard." }, 429);
      const { data: refus } = await admin.from("mecalux_demandes").select("id").ilike("email", email).eq("statut", "refusee").gt("traite_le", new Date(Date.now() - 7 * 86400000).toISOString()).limit(1).maybeSingle();
      if (refus) return json(req, { erreur: "Une demande d'accès avec cette adresse a été refusée récemment. Contactez votre interlocuteur Harington." }, 403);
      const { data, error } = await admin.auth.admin.generateLink({ type: "signup", email, password, options: { data: { prenom, nom, app: "mecalux" }, redirectTo: SITE + "connexion.html" } });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) return json(req, { erreur: "Un compte existe déjà avec cette adresse : connectez-vous, ou utilisez « Mot de passe oublié »." }, 409);
        console.error(error); return json(req, { erreur: "Création du compte impossible. Réessayez." }, 500);
      }
      await envoyer([email], "Confirmez votre adresse — pilotage Mecalux", gabarit("Confirmez votre adresse e-mail",
        P(`Bonjour ${esc(prenom)},`) + P("Vous avez demandé un accès au pilotage de l'équipe Harington chez Mecalux. Confirmez votre adresse en cliquant sur le bouton ci-dessous.") +
        P("Votre demande sera ensuite transmise pour validation : vous recevrez un e-mail dès que votre accès sera ouvert."),
        { texte: "Confirmer mon adresse", url: data.properties.action_link }));
      return json(req, { ok: true });
    }
    if (b.action === "oubli") {
      const email = String(b.email ?? "").trim().toLowerCase();
      if (!EMAIL_OK.test(email)) return json(req, { erreur: "Indiquez votre e-mail." }, 400);
      if (!(await autorise("mecalux-oubli-ip:" + ip, 10, 3600)) || !(await autorise("mecalux-oubli:" + email, 3, 3600))) return json(req, { erreur: "Trop de tentatives : réessayez plus tard." }, 429);
      // Uniquement pour les comptes du pilotage (équipe autorisée ou demande en cours)
      const { data: eq } = await admin.from("mecalux_equipe").select("email").ilike("email", email).maybeSingle();
      const { data: dm } = eq ? { data: null } : await admin.from("mecalux_demandes").select("id").ilike("email", email).limit(1).maybeSingle();
      if (!eq && !dm) return json(req, { ok: true });
      const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: SITE + "connexion.html?reset=1" } });
      if (!error && data?.properties?.action_link) await envoyer([email], "Nouveau mot de passe — pilotage Mecalux", gabarit("Choisissez un nouveau mot de passe",
        P("Bonjour,") + P("Vous avez demandé à changer le mot de passe de votre accès au pilotage de l'équipe Mecalux. Le lien ci-dessous est valable une heure.") +
        P(`<span style="color:#6B7385;font-size:13px">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.</span>`),
        { texte: "Choisir mon mot de passe", url: data.properties.action_link }));
      return json(req, { ok: true });
    }
    if (b.action === "reinit_mfa") {
      const par = await adminConnecte(req);
      if (!par) return json(req, { erreur: "Action réservée aux administrateurs connectés avec la double authentification." }, 403);
      const email = String(b.email ?? "").trim().toLowerCase();
      const { data: m } = await admin.from("mecalux_equipe").select("email").ilike("email", email).maybeSingle();
      if (!m) return json(req, { erreur: "Cette adresse n'est pas dans l'équipe." }, 404);
      const { data: uid } = await admin.rpc("mecalux_id_compte", { p_email: email });
      if (!uid) return json(req, { erreur: "Aucun compte créé avec cette adresse." }, 404);
      const { data: lf } = await admin.auth.admin.mfa.listFactors({ userId: uid });
      for (const f of lf?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ userId: uid, id: f.id });
      console.log("Double authentification réinitialisée", email, "par", par);
      return json(req, { ok: true, n: (lf?.factors ?? []).length });
    }
    if (b.action === "retirer") {
      const par = await adminConnecte(req);
      if (!par) return json(req, { erreur: "Action réservée aux administrateurs connectés avec la double authentification." }, 403);
      const email = String(b.email ?? "").trim().toLowerCase();
      if (email === par.toLowerCase()) return json(req, { erreur: "Vous ne pouvez pas retirer votre propre accès." }, 400);
      const { error: e1 } = await admin.from("mecalux_equipe").delete().ilike("email", email);
      if (e1) { console.error(e1); return json(req, { erreur: "Retrait impossible." }, 500); }
      let supprime = false;
      const { data: uid } = await admin.rpc("mecalux_id_compte", { p_email: email });
      if (uid) {
        const { data: u } = await admin.auth.admin.getUserById(uid);
        if (u?.user?.user_metadata?.app === "mecalux") {
          const { error } = await admin.auth.admin.deleteUser(uid);
          if (error) console.error("Suppression du compte", error); else supprime = true;
        }
      }
      console.log("Accès retiré", email, supprime ? "(compte supprimé)" : "", "par", par);
      return json(req, { ok: true, supprime });
    }
    if (b.action === "decider") return await decider(req, b);
    if (b.action === "partager_prefactures") return await partagerPrefactures(req, b);
  } catch (e) { console.error(e); return json(req, { erreur: "Erreur inattendue. Réessayez." }, 500); }
  return json(req, { erreur: "Action inconnue." }, 400);
});
