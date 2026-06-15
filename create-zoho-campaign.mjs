#!/usr/bin/env node
import https from "https";
import { readFileSync } from "fs";

const z = {
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  listKey: process.env.ZOHO_LIST_KEY,
  topicId: process.env.ZOHO_TOPIC_ID,
  fromEmail: process.env.ZOHO_FROM_EMAIL || "crm@urbnx.com",
  fromName: process.env.ZOHO_FROM_NAME || "URBNX",
};
const htmlUrl = process.env.NEWSLETTER_HTML_URL;
const subject = readFileSync("newsletter-subject.txt", "utf8").trim();

const post = (url, opts) =>
  new Promise((res, rej) => {
    const req = https.request(url, opts, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        try { res(JSON.parse(d)); } catch { rej(new Error(`JSON parse error: ${d}`)); }
      });
    });
    req.on("error", rej);
    if (opts.body) req.write(opts.body);
    req.end();
  });

const postWithRetry = async (url, opts, attempts = 3) => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await post(url, opts);
    } catch (e) {
      if (i === attempts - 1) throw e;
      const wait = 2000 * (i + 1);
      console.log(`  ⚠ Errore rete (${e.message}), riprovo tra ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
};

const d = new Date();
const campaignName = `Newsletter ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

async function main() {
  console.log("▶ Ottengo token Zoho...");
  const tp = new URLSearchParams({
    refresh_token: z.refreshToken,
    client_id: z.clientId,
    client_secret: z.clientSecret,
    grant_type: "refresh_token",
  });
  const tr = await postWithRetry(`https://accounts.zoho.eu/oauth/v2/token?${tp}`, { method: "POST" });
  if (!tr.access_token) throw new Error(`Token error: ${JSON.stringify(tr)}`);

  console.log("▶ Creo campagna Zoho...");
  const cp = new URLSearchParams({
    campaignname: campaignName,
    from_email: z.fromEmail,
    from_name: z.fromName,
    reply_to: z.fromEmail,
    subject,
    list_details: JSON.stringify({ [z.listKey]: [] }),
    content_url: htmlUrl,
    resfmt: "JSON",
  });
  if (z.topicId) cp.set("topicId", z.topicId);

  const cr = await postWithRetry("https://campaigns.zoho.eu/api/v2/createCampaign", {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${tr.access_token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: cp.toString(),
  });

  if (cr.code !== "200") throw new Error(`Zoho error: ${JSON.stringify(cr)}`);
  console.log(`  → Campagna "${campaignName}" creata: ${cr.campaignKey}`);
  console.log("  ℹ️  Bozza salvata su Zoho — verifica e invia manualmente.");
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
