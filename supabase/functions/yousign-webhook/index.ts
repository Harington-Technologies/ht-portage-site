// HT Portage — réception des notifications Yousign (webhook).
// signature_request.done     → télécharge le PDF signé, le range dans l'espace du consultant, statut « signé »
// signature_request.declined / expired / canceled → statut « refusé » / « annulé »
// Chaque notification est authentifiée (HMAC SHA-256, en-tête x-yousign-signature-256) et traitée une seule fois.
//
// Secrets : YOUSIGN_API_KEY, YOUSIGN_ENV, YOUSIGN_WEBHOOK_SECRET ; RESEND_API_KEY, NOTIFY_TO, NOTIFY_FROM (e-mail d'information).
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
async function informer(sujet: string, html: string) {
  const key = Deno.env.get("RESEND_API_KEY"), to = Deno.env.get("NOTIFY_TO"), from = Deno.env.get("NOTIFY_FROM");
  if (!key || !to || !from) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()), subject: sujet, html }),
  }).catch((e) => console.error("Resend", e));
}
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

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
        await admin.from("consultant_missions").update({ statut: "active" }).eq("id", row.mission_id).eq("statut", "validee");
      }
      await informer("Signé : " + row.titre + " — " + qui,
        "<p>Le document <strong>" + esc(row.titre) + "</strong> de " + esc(qui) + " a été signé par toutes les parties.</p><p>Il est disponible dans l'espace du consultant et dans l'administration.</p>");
    } else if (["signature_request.declined", "signature_request.expired", "signature_request.canceled"].includes(evt.event_name)) {
      const statut = evt.event_name === "signature_request.declined" ? "refuse" : "annule";
      await admin.from("documents").update({ statut, yousign_statut: evt.event_name.split(".")[1] }).eq("id", row.id);
      await informer((statut === "refuse" ? "Signature refusée : " : "Signature annulée ou expirée : ") + row.titre + " — " + qui,
        "<p>La demande de signature <strong>" + esc(row.titre) + "</strong> de " + esc(qui) + " est " + (statut === "refuse" ? "refusée" : "annulée ou expirée") + ".</p>");
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
