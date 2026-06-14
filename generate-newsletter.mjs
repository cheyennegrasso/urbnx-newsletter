#!/usr/bin/env node
import Anthropic from "@anthropic-ai/sdk";
import https from "https";
import { readFileSync, writeFileSync } from "fs";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CFG = {
  anthropicModel: "claude-haiku-4-5-20251001",
  zoho: {
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
    listKey: process.env.ZOHO_LIST_KEY,
    topicId: process.env.ZOHO_TOPIC_ID,
    fromEmail: process.env.ZOHO_FROM_EMAIL || "crm@urbnx.com",
    fromName: process.env.ZOHO_FROM_NAME || "URBNX",
    replyTo: process.env.ZOHO_REPLY_TO || "crm@urbnx.com",
  },
  draftMode: process.env.DRAFT_MODE !== "false",
  htmlUrl: process.env.NEWSLETTER_HTML_URL,
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── UTILS ─────────────────────────────────────────────────────────────────
const httpsPost = (url, opts = {}) =>
  new Promise((res, rej) => {
    const req = https.request(url, opts, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res({ status: r.statusCode, body: d }));
    });
    req.on("error", rej);
    if (opts.body) req.write(opts.body);
    req.end();
  });

const fetchJson = async (url, opts) => {
  const r = await httpsPost(url, opts);
  return JSON.parse(r.body);
};

const weekNum = () => {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
};

// ─── 1. LOCATIONS ──────────────────────────────────────────────────────────
function pickLocations() {
  let all;
  try {
    all = JSON.parse(readFileSync("locations.json", "utf8"));
  } catch {
    throw new Error(
      'locations.json non trovato. Esegui prima: node build-locations.mjs'
    );
  }

  if (!Array.isArray(all) || all.length === 0) {
    throw new Error("locations.json è vuoto o non valido.");
  }

  const w = weekNum();
  return [all[w % all.length], all[(w + 1) % all.length]];
}

// ─── 2. CONTENT GENERATION (Claude) ────────────────────────────────────────
const SYSTEM = `Sei il copywriter della newsletter settimanale di URBNX, la piattaforma italiana per lo smart working in location alternative.
Scrivi in italiano, tono professionale ma caldo, frasi brevi.
Non inventare dati o URL. Rispondi SOLO con JSON valido, nessun testo extra.`;

async function generateContent(locations) {
  const locationSummary = locations
    .map((l, i) => `Location ${i + 1}: ${l.name}${l.city ? ` (${l.city})` : ""}${l.address ? `\nIndirizzo: ${l.address}` : ""}`)
    .join("\n\n");

  const msg = await client.messages.create({
    model: CFG.anthropicModel,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Genera il contenuto per la newsletter di questa settimana.

${locationSummary}

Rispondi con questo JSON (tutti i campi obbligatori):
{
  "subject": "oggetto email (max 50 caratteri)",
  "preheader": "preheader (max 85 caratteri)",
  "headline": "titolo principale newsletter (max 60 caratteri)",
  "intro": "paragrafo introduttivo sullo smart working (2-3 frasi, max 120 parole)",
  "tip": { "title": "titolo consiglio settimana (max 40 car)", "body": "consiglio pratico smart working (max 60 parole)" },
  "locations": [
    { "tagline": "frase breve accattivante per location 0 (max 50 car)", "cta": "testo bottone (max 20 car)" },
    { "tagline": "frase breve accattivante per location 1 (max 50 car)", "cta": "testo bottone (max 20 car)" }
  ]
}`,
      },
    ],
  });

  let text = msg.content[0].text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(text);
}

// ─── 3. HTML EMAIL ─────────────────────────────────────────────────────────
function buildHtml(content, locations) {
  const locationBlocks = locations
    .map(
      (loc, i) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;border:1px solid #e0e0e0;">
      ${
        loc.image
          ? `<tr><td><a href="${loc.link}" style="display:block;"><img src="${loc.image}" alt="${loc.name}" width="600" style="width:100%;max-width:600px;height:220px;object-fit:cover;display:block;filter:grayscale(100%);"></a></td></tr>`
          : ""
      }
      <tr><td style="padding:24px;">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#888;">SPAZIO DELLA SETTIMANA</p>
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111;">${loc.name}</h2>
        <p style="margin:0 0 16px;font-size:14px;color:#555;font-style:italic;">${content.locations[i].tagline}</p>
        <a href="${loc.link}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:1px;">${content.locations[i].cta}</a>
      </td></tr>
    </table>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${content.subject}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f5f5">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;">

  <!-- HEADER -->
  <tr><td style="padding:32px;border-bottom:2px solid #111;text-align:center;">
    <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#111;">URBNX</p>
    <p style="margin:4px 0 0;font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase;">Smart Working Newsletter</p>
  </td></tr>

  <!-- HERO -->
  <tr><td style="padding:40px 32px 32px;">
    <h1 style="margin:0 0 16px;font-size:28px;font-weight:700;line-height:1.2;color:#111;">${content.headline}</h1>
    <p style="margin:0;font-size:15px;line-height:1.7;color:#444;">${content.intro}</p>
  </td></tr>

  <!-- DIVIDER -->
  <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e0e0e0;"></td></tr>

  <!-- TIP -->
  <tr><td style="padding:32px;">
    <p style="margin:0 0 8px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#888;">CONSIGLIO DELLA SETTIMANA</p>
    <h3 style="margin:0 0 8px;font-size:16px;font-weight:700;color:#111;">${content.tip.title}</h3>
    <p style="margin:0;font-size:14px;line-height:1.7;color:#555;">${content.tip.body}</p>
  </td></tr>

  <!-- DIVIDER -->
  <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e0e0e0;"></td></tr>

  <!-- LOCATIONS -->
  <tr><td style="padding:32px;">
    <p style="margin:0 0 24px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#888;">SPAZI IN EVIDENZA</p>
    ${locationBlocks}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:24px 32px;background:#111;text-align:center;">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:4px;color:#fff;text-transform:uppercase;">URBNX</p>
    <p style="margin:0;font-size:11px;color:#888;">© ${new Date().getFullYear()} URBNX · <a href="{{unsubscribe}}" style="color:#888;">Annulla iscrizione</a></p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── 4. ZOHO ───────────────────────────────────────────────────────────────
async function getZohoToken() {
  const z = CFG.zoho;
  const params = new URLSearchParams({
    refresh_token: z.refreshToken,
    client_id: z.clientId,
    client_secret: z.clientSecret,
    grant_type: "refresh_token",
  });
  const r = await fetchJson(`https://accounts.zoho.eu/oauth/v2/token?${params}`, {
    method: "POST",
  });
  if (!r.access_token) throw new Error(`Zoho token error: ${JSON.stringify(r)}`);
  return r.access_token;
}

async function createZohoCampaign(token, subject, htmlUrl) {
  const z = CFG.zoho;
  const now = new Date();
  now.setMinutes(now.getMinutes() + 10);
  const scheduleTime = now.toISOString().replace("T", " ").substring(0, 16);

  const params = new URLSearchParams({
    campaign_name: `Newsletter URBNX – ${new Date().toLocaleDateString("it-IT")}`,
    campaign_type: "Regular",
    email_details: JSON.stringify({
      sender_address: z.fromEmail,
      sender_name: z.fromName,
      reply_to: z.replyTo,
      subject,
    }),
    recipients: JSON.stringify({ list_details: [{ list_unique_key: z.listKey, status: "active" }] }),
    content_type: "url",
    html_url: htmlUrl,
  });
  if (z.topicId) params.set("topic_id", z.topicId);
  if (!CFG.draftMode) {
    params.set("schedule_time", scheduleTime);
    params.set("schedule_type", "Immediate");
  }

  const r = await fetchJson("https://campaigns.zoho.eu/api/v1.1/createcampaign?resfmt=JSON", {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (r.status !== "success") throw new Error(`Zoho campaign error: ${JSON.stringify(r)}`);
  return r;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("▶ Seleziono location della settimana...");
  const locations = pickLocations();
  console.log(`  → ${locations.map((l) => l.name).join(" / ")}`);

  console.log("▶ Genero contenuto con Claude...");
  const content = await generateContent(locations);
  console.log(`  → Oggetto: ${content.subject}`);

  console.log("▶ Costruisco HTML...");
  const html = buildHtml(content, locations);
  writeFileSync("newsletter.html", html);
  console.log("  → newsletter.html salvato");

  if (CFG.htmlUrl && CFG.zoho.refreshToken) {
    console.log("▶ Creo campagna Zoho...");
    const token = await getZohoToken();
    const result = await createZohoCampaign(token, content.subject, CFG.htmlUrl);
    console.log(`  → Campagna creata: ${result.campaign_key}`);
    if (CFG.draftMode) {
      console.log("  ℹ️  Modalità bozza — verifica su Zoho e invia manualmente.");
    }
  } else {
    console.log("ℹ️  Credenziali Zoho non presenti — solo HTML generato.");
  }
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
