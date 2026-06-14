#!/usr/bin/env node
// Esegui una volta sola (o quando aggiungi nuove location):
//   node build-locations.mjs
// Genera locations.json che viene letto dallo script della newsletter.
import https from "https";
import { writeFileSync } from "fs";

const fetch = (url) =>
  new Promise((res, rej) => {
    https.get(url, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res(d));
    }).on("error", rej);
  });

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function extractLocationData(html, url) {
  const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/s);
  const name = h1 ? h1[1].replace(/<[^>]+>/g, "").trim() : "";

  const imgs = [...html.matchAll(/src="(https:\/\/app\.urbnx\.com\/wp-content\/uploads\/[^"]+)"/g)];
  const image = imgs.length > 0 ? imgs[0][1] : "";

  const addrMatch = html.match(/(Via|Viale|Piazza|Corso|Strada|Contrada|Loc\.|Frazione)[^<]{10,80}/);
  const address = addrMatch ? addrMatch[0].trim() : "";

  const cityMatch = address.match(/\d{5}\s+([^,]+)/);
  const city = cityMatch ? cityMatch[1].trim() : "";

  return { name, link: url, image, address, city };
}

async function scrapeInBatches(urls, batchSize = 10) {
  const results = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const html = await fetchWithRetry(url);
          return extractLocationData(html, url);
        } catch (e) {
          console.error(`  ✗ Errore ${url}: ${e.message}`);
          return null;
        }
      })
    );
    results.push(...batchResults.filter(Boolean));
    process.stdout.write(`\r  → ${Math.min(i + batchSize, urls.length)}/${urls.length} processate`);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log();
  return results;
}

async function main() {
  console.log("▶ Scarico sitemap location...");
  const sitemap = await fetchWithRetry("https://app.urbnx.com/locations-sitemap.xml");
  const urls = [...sitemap.matchAll(/https:\/\/app\.urbnx\.com\/locations\/[^<]+/g)].map((m) => m[0]);
  console.log(`  → ${urls.length} location trovate`);

  console.log("▶ Scarico dati (batch da 10, ~15 secondi)...");
  const locations = await scrapeInBatches(urls, 10);

  const valid = locations.filter((l) => l.name);
  console.log(`  → ${valid.length} location con dati validi`);

  writeFileSync("locations.json", JSON.stringify(valid, null, 2));
  console.log("✓ locations.json salvato");
}

main().catch((e) => {
  console.error("ERRORE:", e.message);
  process.exit(1);
});
