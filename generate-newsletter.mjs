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
const SYSTEM = `Sei Cheyenne, founder di URBNX — la piattaforma italiana che aiuta i professionisti a lavorare da location alternative (hotel, castelli, agriturismi, spazi di coworking unici).
Scrivi la newsletter settimanale in prima persona plurale ("noi di URBNX", "vi portiamo", "abbiamo scelto").
Tono: caldo, diretto, appassionato. Come se scrivessi a dei colleghi o amici che condividono la stessa visione del lavoro. Mai linguaggio da brochure o da ufficio marketing.
Usa frasi vere, non slogan. Le persone devono sentire che c'è un team vero dietro, non un bot.
Non inventare dati o URL. Rispondi SOLO con JSON valido, nessun testo extra.`;

async function generateContent(locations) {
  const locationSummary = locations
    .map((l, i) => `Location ${i + 1}: ${l.name}${l.city ? ` (${l.city})` : ""}${l.address ? `\nIndirizzo: ${l.address}` : ""}`)
    .join("\n\n");

  const msg = await client.messages.create({
    model: CFG.anthropicModel,
    max_tokens: 1800,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Genera il contenuto per la newsletter di questa settimana.

${locationSummary}

Rispondi con questo JSON (tutti i campi obbligatori):
{
  "subject": "oggetto email breve e curioso, max 50 caratteri, non generico",
  "intro": "paragrafo di apertura personale: parla di come stai vivendo lo smart working questa settimana, cosa hai notato, un pensiero autentico. 4-5 frasi, circa 80-100 parole. Prima persona plurale.",
  "tip": {
    "title": "un consiglio pratico per questa settimana, formulato come suggerimento tra amici, max 50 car",
    "body": "spiega il consiglio con dettagli concreti: perché funziona, come si applica, cosa cambia davvero. 4-5 frasi, circa 80 parole."
  },
  "locations": [
    {
      "description": "racconta questa location come se la stessi consigliando a un amico: che atmosfera ha, cosa la rende speciale per lavorare, che tipo di giornata ci puoi passare. 3-4 frasi, circa 60-70 parole.",
      "cta": "testo link, max 20 car"
    },
    {
      "description": "stessa cosa per la seconda location, stessa lunghezza e stesso tono.",
      "cta": "testo link, max 20 car"
    }
  ],
  "sign_off": "saluto finale caldo e personale, 1-2 frasi, firma come 'il team URBNX' o simile"
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
  const p = (text) =>
    `<p style="margin:0 0 18px;font-size:16px;line-height:1.75;color:#2d2d2d;">${text}</p>`;

  const locationBlocks = locations
    .map(
      (loc, i) => `
    <tr><td style="padding:0 0 40px;">
      ${
        loc.image
          ? `<a href="${loc.link}" style="display:block;margin-bottom:16px;"><img src="${loc.image}" alt="${loc.name}" width="560" style="width:100%;max-width:560px;height:260px;object-fit:cover;display:block;border-radius:4px;"></a>`
          : ""
      }
      <h2 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#111;letter-spacing:-0.3px;">${loc.name}</h2>
      ${loc.city ? `<p style="margin:0 0 12px;font-size:13px;color:#999;">${loc.city}</p>` : ""}
      ${p(content.locations[i].description)}
      <a href="${loc.link}" style="font-size:15px;color:#1a1a1a;font-weight:600;text-decoration:underline;">${content.locations[i].cta} →</a>
    </td></tr>`
    )
    .join(`<tr><td style="padding:0 0 40px;"><hr style="border:none;border-top:1px solid #ebebeb;"></td></tr>`);

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${content.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f7;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f9f9f7">
<tr><td align="center" style="padding:40px 16px;">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:6px;">

  <!-- HEADER -->
  <tr><td style="padding:32px 40px 24px;">
    <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">urbnx — smart working</p>
  </td></tr>

  <!-- INTRO -->
  <tr><td style="padding:0 40px 32px;">
    ${p(content.intro)}

    <!-- DIVIDER -->
    <hr style="border:none;border-top:1px solid #ebebeb;margin:32px 0;">

    <!-- TIP -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:20px 24px;background:#f5f4f0;border-left:3px solid #2d2d2d;border-radius:2px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#888;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Il consiglio di questa settimana</p>
        <p style="margin:0 0 10px;font-size:17px;font-weight:600;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${content.tip.title}</p>
        <p style="margin:0;font-size:15px;line-height:1.7;color:#444;font-family:Georgia,'Times New Roman',serif;">${content.tip.body}</p>
      </td></tr>
    </table>

    <hr style="border:none;border-top:1px solid #ebebeb;margin:32px 0;">

    <!-- LOCATIONS INTRO -->
    <p style="margin:0 0 28px;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Gli spazi di questa settimana</p>

  </td></tr>

  <!-- LOCATIONS -->
  <tr><td style="padding:0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${locationBlocks}
    </table>
  </td></tr>

  <!-- SIGN OFF -->
  <tr><td style="padding:8px 40px 40px;">
    <hr style="border:none;border-top:1px solid #ebebeb;margin:0 0 28px;">
    ${p(content.sign_off)}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:20px 40px;border-top:1px solid #ebebeb;text-align:center;">
    <p style="margin:0;font-size:12px;color:#bbb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      © ${new Date().getFullYear()} URBNX ·
      <a href="{{unsubscribe}}" style="color:#bbb;text-decoration:underline;">Annulla iscrizione</a>
    </p>
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

async function createZohoCampaign(token, subject, contentUrl) {
  const z = CFG.zoho;
  const listDetails = JSON.stringify({ [z.listKey]: [] });

  const params = new URLSearchParams({
    campaignname: `Newsletter URBNX – ${new Date().toLocaleDateString("it-IT")}`,
    from_email: z.fromEmail,
    from_name: z.fromName,
    reply_to: z.replyTo,
    subject,
    list_details: listDetails,
    content_url: contentUrl,
    resfmt: "JSON",
  });
  if (z.topicId) params.set("topicId", z.topicId);

  const r = await fetchJson("https://campaigns.zoho.eu/api/v2/createCampaign", {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (r.code !== "200") throw new Error(`Zoho campaign error: ${JSON.stringify(r)}`);
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

  // Salva il soggetto per la fase Zoho (eseguita dopo il push su GitHub)
  writeFileSync("newsletter-subject.txt", content.subject);

  const htmlUrl = CFG.htmlUrl;
  if (htmlUrl && CFG.zoho.refreshToken) {
    console.log("▶ Creo campagna Zoho...");
    const token = await getZohoToken();
    const result = await createZohoCampaign(token, content.subject, htmlUrl);
    console.log(`  → Campagna creata: ${result.campaignKey}`);
    console.log("  ℹ️  Bozza salvata su Zoho — verifica e invia manualmente.");
  } else {
    console.log("ℹ️  HTML generato. Campagna Zoho verrà creata dopo il push.");
  }
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
