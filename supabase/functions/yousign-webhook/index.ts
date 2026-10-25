// HT Portage — réception des notifications Yousign (webhook).
// signature_request.done     → télécharge le PDF signé, le range dans l'espace du consultant, statut « signé »
// signature_request.declined / expired / canceled → statut « refusé » / « annulé »
// Chaque notification est authentifiée (HMAC SHA-256, en-tête x-yousign-signature-256) et traitée une seule fois.
//
// Secrets : YOUSIGN_API_KEY, YOUSIGN_ENV, YOUSIGN_WEBHOOK_SECRET ; RESEND_API_KEY, NOTIFY_TO, NOTIFY_FROM.
// E-mails : information de l'équipe (signé / refusé / expiré) et, une fois signé, e-mail au consultant.
// Déploiement : « Verify JWT » désactivé (Yousign n'envoie pas de jeton Supabase ; la signature HMAC est vérifiée ici).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const YS_KEY = Deno.env.get("YOUSIGN_API_KEY") ?? "";
const YS_URL = Deno.env.get("YOUSIGN_ENV") === "production" ? "https://api.yousign.app/v3" : "https://api-sandbox.yousign.app/v3";
const SECRET = Deno.env.get("YOUSIGN_WEBHOOK_SECRET") ?? "";

function serverKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const vals = Array.isArray(keys) ? keys : Object.values(keys);
    return (vals.map((v: unknown) => typeof v === "string" ? v : (v as { key?: string })?.key).find(Boolean) as string) ?? "";
  } catch { return ""; }
}
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serverKey(), { auth: { persistSession: false } });

export async function hmac(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return "sha256=" + Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function egal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function ys(path: string) {
  const r = await fetch(YS_URL + path, { headers: { Authorization: "Bearer " + YS_KEY } });
  if (!r.ok) throw new Error("Yousign GET " + path + " → " + r.status + " " + (await r.text()).slice(0, 200));
  return r;
}
const SITE = "https://www.htportage.fr";
const CONTACT = "contact@htportage.fr";
const NOTIFY_TO = (Deno.env.get("NOTIFY_TO") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "";
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}
const nl2br = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

// ---------------------------------------------------------------------------
// Gabarit e-mail HT Portage (tables + styles en ligne : compatible Outlook / Gmail)
// ---------------------------------------------------------------------------
type Gabarit = { titre: string; corps: string; bouton?: { texte: string; url: string }; apercu?: string; interne?: boolean };
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
      ${o.interne ? "Notification interne envoyée automatiquement par le site HT Portage." : "HT Portage — portage salarial. Cet e-mail vous est adressé dans le cadre de votre espace consultant ; pour toute question, répondez simplement à ce message."}
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
// externe = e-mail au consultant (expéditeur « Service Administratif HT PORTAGE », réponse vers contact@)
async function envoyer(to: string[], sujet: string, html: string, externe = false) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key || !NOTIFY_FROM || !to.length) return;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: externe ? `Service Administratif HT PORTAGE <${adresseFrom()}>` : NOTIFY_FROM, to, subject: sujet, html,
      ...(externe ? { reply_to: NOTIFY_TO[0] ?? CONTACT } : {}),
    }),
  }).catch((e) => { console.error("Resend", e); return null; });
  if (r && !r.ok) console.error("Resend", r.status, await r.text());
}

async function traiter(evt: { event_id: string; event_name: string; data?: { signature_request?: { id: string; status?: string } } }) {
  const sr = evt.data?.signature_request;
  if (!sr?.id) return;
  // Une notification peut être renvoyée : on ne la traite qu'une fois
  const { error: dup } = await admin.from("yousign_evenements").insert({ event_id: evt.event_id, event_name: evt.event_name, sr_id: sr.id });
  if (dup) { console.log("Déjà traité", evt.event_id); return; }

  try {
    await appliquer(evt, sr);
  } catch (e) {
    // échec : on oublie l'événement pour que la nouvelle tentative de Yousign le retraite
    await admin.from("yousign_evenements").delete().eq("event_id", evt.event_id);
    throw e;
  }
}

async function appliquer(evt: { event_name: string }, sr: { id: string }) {
  const { data: rows } = await admin.from("documents").select("*").eq("yousign_sr_id", sr.id);
  if (!rows?.length) { console.log("Aucun document pour", sr.id); return; }

  for (const row of rows) {
    const { data: p } = await admin.from("profils").select("prenom, nom, email").eq("id", row.user_id).maybeSingle();
    const qui = [p?.prenom, p?.nom].filter(Boolean).join(" ") || p?.email || "consultant";
    if (evt.event_name === "signature_request.done") {
      const liste = await (await ys("/signature_requests/" + sr.id + "/documents")).json();
      const doc = (Array.isArray(liste) ? liste : liste.data ?? []).find((x: { nature: string }) => x.nature === "signable_document");
      if (!doc) throw new Error("Document signé introuvable pour " + sr.id);
      const pdf = new Uint8Array(await (await ys("/signature_requests/" + sr.id + "/documents/" + doc.id + "/download")).arrayBuffer());
      const chemin = row.user_id + "/" + row.id + "-signe.pdf";
      const up = await admin.storage.from("documents").upload(chemin, pdf, { contentType: "application/pdf", upsert: true });
      if (up.error) throw up.error;
      const auj = new Date().toISOString();
      await admin.from("documents").update({ statut: "signe", storage_path: chemin, yousign_statut: "done", signe_le: auj, date_document: auj.slice(0, 10) }).eq("id", row.id);
      if (row.type === "annexe" && row.mission_id) {
        const { error: em } = await admin.from("consultant_missions").update({ statut: "active" }).eq("id", row.mission_id).eq("statut", "validee");
        if (em) console.error("Mission non passée en active", row.mission_id, em.message);
      }
      const estCdi = row.type === "cdi";
      await envoyer(NOTIFY_TO, "Signé : " + row.titre + " — " + qui, gabarit({
        interne: true, titre: (estCdi ? "CDI signé" : "Annexe signée") + " — " + qui,
        corps: `<p style="margin:0 0 14px">Le document <strong>${esc(row.titre)}</strong> de <strong>${esc(qui)}</strong> a été signé par toutes les parties.</p>` +
          `<p style="margin:0">Le PDF signé est rangé dans l'espace du consultant${!estCdi ? " et la mission est désormais active" : ""}.</p>`,
        bouton: { texte: "Voir les signatures", url: SITE + "/espace/admin.html#signatures" },
      }));
      if (p?.email) {
        await envoyer([p.email], estCdi ? "Votre contrat de travail HT Portage est signé" : "Votre mission est confirmée — annexe signée", gabarit({
          titre: estCdi ? "Votre contrat de travail est signé" : "Votre mission est confirmée",
          apercu: "Le document signé est disponible dans votre espace consultant.",
          corps: `<p style="margin:0 0 14px">Bonjour ${esc(p.prenom ?? "")},</p>` +
            (estCdi
              ? `<p style="margin:0 0 14px">Votre contrat de travail à durée indéterminée en portage salarial a été signé par l'ensemble des parties. Bienvenue chez HT Portage !</p>`
              : `<p style="margin:0 0 14px">L'annexe à votre contrat de travail, qui fixe les conditions de votre mission, a été signée par vous-même, votre client et HT Portage. Votre mission est désormais <strong>active</strong>.</p>`) +
            `<p style="margin:0 0 14px">Vous trouverez le document signé, au format PDF, dans la rubrique « Contrats et missions » de votre espace consultant. Nous vous conseillons de le conserver précieusement.</p>` +
            `<p style="margin:0">Notre équipe reste à votre disposition pour toute question : il vous suffit de répondre à cet e-mail.</p>`,
          bouton: { texte: "Accéder à mes contrats", url: SITE + "/espace/contrats.html" },
        }), true);
      }
    } else if (["signature_request.declined", "signature_request.expired", "signature_request.canceled"].includes(evt.event_name)) {
      const statut = evt.event_name === "signature_request.declined" ? "refuse" : "annule";
      await admin.from("documents").update({ statut, yousign_statut: evt.event_name.split(".")[1] }).eq("id", row.id);
      const quoi = statut === "refuse" ? "refusée" : evt.event_name.endsWith("expired") ? "expirée" : "annulée";
      await envoyer(NOTIFY_TO, "Signature " + quoi + " : " + row.titre + " — " + qui, gabarit({
        interne: true, titre: "Signature " + quoi,
        corps: `<p style="margin:0 0 14px">La demande de signature <strong>${esc(row.titre)}</strong> de <strong>${esc(qui)}</strong> a été ${quoi}.</p>` +
          `<p style="margin:0">${statut === "refuse" ? "Un des signataires a refusé de signer : prenez contact avec lui pour en connaître la raison, puis renvoyez les contrats depuis l'administration." : "Les contrats peuvent être renvoyés en signature depuis l'administration."}</p>`,
        bouton: { texte: "Ouvrir l'administration", url: SITE + "/espace/admin.html#signatures" },
      }));
    } else {
      await admin.from("documents").update({ yousign_statut: evt.event_name }).eq("id", row.id);
    }
  }
}

if (Deno.env.get("HTP_TEST") !== "1") Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.text();
  if (!SECRET || !egal(req.headers.get("x-yousign-signature-256") ?? "", await hmac(body))) {
    return new Response("Unauthorized", { status: 401 });
  }
  let evt;
  try { evt = JSON.parse(body); } catch { return new Response("Bad request", { status: 400 }); }
  // Yousign exige une réponse en moins d'une seconde : le traitement continue en arrière-plan.
  const tache = traiter(evt).catch((e) => console.error("Traitement webhook", evt?.event_id, e));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(tache); else await tache;
  return new Response("OK", { status: 200 });
});
