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
Tono: caldo, diretto, appassionato. Come se scrivessi a un amico che condivide la tua stessa visione del lavoro. Niente linguaggio da brochure o da marketing.
Non inventare dati o URL.`;

async function generateContent(locations) {
  const locationSummary = locations
    .map((l, i) => `Location ${i + 1}: ${l.name}${l.city ? ` (${l.city})` : ""}${l.address ? `\nIndirizzo: ${l.address}` : ""}`)
    .join("\n\n");

  const msg = await client.messages.create({
    model: CFG.anthropicModel,
    max_tokens: 3000,
    system: SYSTEM,
    tools: [
      {
        name: "newsletter_content",
        description: "Genera il contenuto completo della newsletter settimanale URBNX",
        input_schema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Oggetto email curioso e specifico, max 50 caratteri" },
            intro: { type: "string", description: "Inizia con un dato, fatto o osservazione sorprendente sul lavoro remoto o sulle abitudini dei professionisti italiani oggi (non inventare numeri). Poi collega alla visione URBNX. 100-120 parole, prima persona plurale, tono diretto e personale." },
            tip: {
              type: "object",
              properties: {
                title: { type: "string", description: "Titolo consiglio pratico, max 55 caratteri" },
                highlight: { type: "string", description: "Una frase breve e d'impatto che cattura il cuore del consiglio, max 18 parole. Sarà mostrata in grassetto e in evidenza." },
                body: { type: "string", description: "Sviluppo del consiglio: spiega il problema, la soluzione concreta, cosa cambia. 80-100 parole." },
              },
              required: ["title", "highlight", "body"],
            },
            locations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string", description: "Descrizione vivida e sensoriale della location: atmosfera, luce, sensazioni, cosa si mangia o si vede. 60-80 parole, concreto e diretto." },
                  cta: { type: "string", description: "Testo del link, max 20 caratteri" },
                },
                required: ["description", "cta"],
              },
            },
            sign_off: { type: "string", description: "Congedo personale e caldo, 2-3 frasi, firmato come team URBNX" },
          },
          required: ["subject", "intro", "tip", "locations", "sign_off"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "newsletter_content" },
    messages: [
      {
        role: "user",
        content: `Genera il contenuto per la newsletter di questa settimana.

${locationSummary}

Per l'intro: apri con un fatto o osservazione concreta sul lavoro da remoto in Italia oggi, poi porta alla visione URBNX. Scrivi come se stessi raccontando a un amico qualcosa che ti ha colpito questa settimana. 100-120 parole.
Per ogni location: descrivi cosa si vede, si sente, si respira. Due o tre immagini precise valgono più di dieci aggettivi generici. 60-80 parole.
Per il consiglio: l'highlight deve essere la frase che la persona si ricorderà. Il body spiega il perché in modo pratico.`,
      },
    ],
  });

  const toolUse = msg.content.find((c) => c.type === "tool_use");
  if (!toolUse) throw new Error(`Claude non ha restituito tool_use. Content: ${JSON.stringify(msg.content)}`);
  const result = toolUse.input;
  console.log(`  → Campi ricevuti: ${Object.keys(result).join(", ")}`);
  if (typeof result.locations === "string") {
    try { result.locations = JSON.parse(result.locations); } catch {}
  }
  if (!Array.isArray(result.locations) || result.locations.length < 2) {
    throw new Error(`locations non valido: ${JSON.stringify(result.locations)}`);
  }
  if (typeof result.tip === "string") {
    try { result.tip = JSON.parse(result.tip); } catch {}
  }
  if (!result.tip?.highlight) result.tip.highlight = result.tip.title;
  return result;
}

// ─── 3. HTML EMAIL ─────────────────────────────────────────────────────────
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

function buildHtml(content, locations) {
  const p = (text) =>
    `<p style="margin:0 0 20px;font-size:16px;line-height:1.8;color:#333;font-family:${FONT};">${text}</p>`;

  const locationBlocks = locations
    .map(
      (loc, i) => `
    <tr><td style="padding:0 0 40px;">
      ${
        loc.image
          ? `<a href="${loc.link}" style="display:block;margin-bottom:20px;"><img src="${loc.image}" alt="${loc.name}" width="560" style="width:100%;max-width:560px;height:280px;object-fit:cover;display:block;border-radius:6px;"></a>`
          : ""
      }
      <h2 style="margin:0 0 4px;font-size:21px;font-weight:700;color:#542784;letter-spacing:-0.3px;font-family:${FONT};">${loc.name}</h2>
      ${loc.city ? `<p style="margin:0 0 16px;font-size:13px;color:#aaa;font-family:${FONT};">${loc.city}</p>` : `<p style="margin:0 0 16px;"></p>`}
      ${p(content.locations[i].description)}
      <a href="${loc.link}" style="display:inline-block;font-size:14px;color:#fff;background:#542784;text-decoration:none;padding:10px 22px;border-radius:4px;font-weight:600;font-family:${FONT};">${content.locations[i].cta} →</a>
    </td></tr>`
    )
    .join(`<tr><td style="padding:0 0 40px;"><hr style="border:none;border-top:1px solid #f0f0f0;"></td></tr>`);

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${content.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:${FONT};">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f2">
<tr><td align="center" style="padding:32px 16px;">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:8px;overflow:hidden;">

  <!-- HEADER -->
  <tr><td style="padding:28px 40px 20px;border-bottom:1px solid #f0f0f0;">
    <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#542784;font-family:${FONT};">URBNX</p>
  </td></tr>

  <!-- SALUTO + INTRO -->
  <tr><td style="padding:36px 40px 0;">
    <p style="margin:0 0 20px;font-size:16px;line-height:1.8;color:#333;font-family:${FONT};">Ciao $[FNAME]$,</p>
    ${p(content.intro)}

    <!-- DIVIDER -->
    <hr style="border:none;border-top:1px solid #f0f0f0;margin:8px 0 32px;">

    <!-- TIP -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td style="padding:24px 28px;background:#f8f8f6;border-left:3px solid #542784;border-radius:4px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#aaa;font-family:${FONT};">Consiglio della settimana</p>
        <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#542784;font-family:${FONT};">${content.tip.title}</p>
        <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#542784;line-height:1.6;padding:12px 16px;background:#fff;border-radius:4px;font-family:${FONT};">${content.tip.highlight}</p>
        <p style="margin:0;font-size:15px;line-height:1.8;color:#555;font-family:${FONT};">${content.tip.body}</p>
      </td></tr>
    </table>

    <!-- LOCATIONS LABEL -->
    <p style="margin:0 0 28px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#bbb;font-family:${FONT};">Gli spazi di questa settimana</p>
  </td></tr>

  <!-- LOCATIONS -->
  <tr><td style="padding:0 40px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${locationBlocks}
    </table>
  </td></tr>

  <!-- SIGN OFF -->
  <tr><td style="padding:0 40px 36px;">
    <hr style="border:none;border-top:1px solid #f0f0f0;margin:0 0 28px;">
    ${p(content.sign_off)}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:20px 40px;background:#f8f8f6;text-align:center;">
    <p style="margin:0;font-size:12px;color:#ccc;font-family:${FONT};">
      © ${new Date().getFullYear()} URBNX ·
      <a href="{{unsubscribe}}" style="color:#ccc;text-decoration:underline;">Annulla iscrizione</a>
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
