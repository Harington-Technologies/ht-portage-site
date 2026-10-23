// HT Portage — notification e-mail à chaque nouvelle demande du site.
// Déclenchée par un Database Webhook Supabase (INSERT sur contacts, candidatures, recommandations).
// Envoi via Resend, comme pour Cultikids.
//
// Secrets à définir (Supabase › Edge Functions › Secrets) :
//   RESEND_API_KEY   clé Resend
//   NOTIFY_TO        destinataire(s), séparés par des virgules (ex. contact@htportage.fr)
//   NOTIFY_FROM      expéditeur vérifié dans Resend (ex. "HT Portage <site@htportage.fr>")
//   WEBHOOK_SECRET   chaîne aléatoire, à recopier dans l'en-tête x-webhook-secret du webhook
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_TO = (Deno.env.get("NOTIFY_TO") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const LABELS: Record<string, string> = {
  contacts: "Nouvelle demande",
  candidatures: "Nouvelle candidature",
  recommandations: "Nouvelle recommandation Ambassadeur",
};

const HIDDEN = new Set(["id", "consentement", "traite", "statut", "cv_path"]);

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const table: string = payload?.table ?? "";
  const record: Record<string, unknown> = payload?.record ?? {};
  if (payload?.type !== "INSERT" || !LABELS[table]) return new Response("Ignored", { status: 200 });

  let subject = LABELS[table];
  if (table === "contacts" && record.type === "simulation") subject = "Nouvelle demande de simulation";
  subject += ` — ${record.nom ?? record.ambassadeur_nom ?? ""}`;

  const rows = Object.entries(record)
    .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "")
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#4A5468;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;white-space:pre-wrap">${esc(v)}</td></tr>`)
    .join("");

  let cvLink = "";
  if (table === "candidatures" && typeof record.cv_path === "string" && record.cv_path) {
    const { data } = await admin.storage.from("cv").createSignedUrl(record.cv_path, 60 * 60 * 24 * 7);
    if (data?.signedUrl) cvLink = `<p><a href="${esc(data.signedUrl)}">Télécharger le CV</a> (lien valable 7 jours)</p>`;
  }

  const html = `<div style="font-family:Arial,sans-serif;color:#1B1C1C">
    <h2 style="color:#21324E">${esc(subject)}</h2>
    <table style="border-collapse:collapse;font-size:14px">${rows}</table>
    ${cvLink}
    <p style="color:#4A5468;font-size:12px">Reçu via le site HT Portage — à traiter dans Supabase (table ${esc(table)}).</p>
  </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: NOTIFY_FROM, to: NOTIFY_TO, subject, html }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, await res.text());
    return new Response("Email failed", { status: 502 });
  }
  return new Response("OK", { status: 200 });
});
