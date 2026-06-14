# URBNX Newsletter — Contesto Progetto

## Cos'è
Automazione completa per la newsletter settimanale di URBNX (urbnx.com), piattaforma italiana per smart working in location alternative. La newsletter va su Zoho Campaigns, esce ogni lunedì.

## Architettura
- `generate-newsletter.mjs` — script Node.js che fa tutto: pesca 2 location da URBNX via API pubblica, chiama Claude per i testi, costruisce l'HTML e crea la campagna su Zoho
- `.github/workflows/newsletter.yml` — GitHub Actions, si attiva ogni lunedì alle 7:00 UTC (9:00 IT)
- Il workflow pubblica `newsletter.html` nel repo e passa l'URL a Zoho (Zoho vuole URL pubblico, non HTML grezzo)

## Scelte tecniche
- **Modello Claude**: `claude-haiku-4-5-20251001` — sufficiente per copy breve, ~20x più economico di Opus
- **Rotazione location**: deterministica via numero settimana (`weekNum()`), zero stato esterno
- **Una sola chiamata Claude**: genera tutto in JSON strutturato (oggetto, headline, intro, tip, tagline per ogni location)
- **DRAFT_MODE=true** per default — la campagna viene creata come bozza su Zoho finché non si cambia a `false`

## Location (fonte dati)
Le location NON sono esposte via REST API (il CPT `locations` non ha `show_in_rest => true`).
Si usa invece **`locations.json`** nel repo — file statico generato da `build-locations.mjs` che scrapa il sitemap pubblico `https://app.urbnx.com/locations-sitemap.xml`.
- 123 location attive con nome, immagine, città, indirizzo, link
- Da rigenerare manualmente solo quando si aggiungono nuove location: `node build-locations.mjs`
- Lo script della newsletter legge da questo file, zero chiamate API a URBNX

## Secrets GitHub da configurare (Settings → Secrets → Actions)
| Secret | Dove si trova |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `ZOHO_CLIENT_ID` | api-console.zoho.eu → Self Client |
| `ZOHO_CLIENT_SECRET` | api-console.zoho.eu → Self Client |
| `ZOHO_REFRESH_TOKEN` | vedi README.md Passo 3b |
| `ZOHO_LIST_KEY` | Zoho Campaigns → Mailing Lists → URL della lista |
| `ZOHO_TOPIC_ID` | Zoho Campaigns → Settings → Topics → URL del topic |
| `ZOHO_FROM_EMAIL` | es. newsletter@urbnx.com |

## Stato setup
- [x] Script generazione newsletter (legge da locations.json)
- [x] Workflow GitHub Actions (singolo run, niente doppio Claude)
- [x] locations.json generato (123 location)
- [x] build-locations.mjs (scraper da rigenerare quando servono nuove location)
- [x] Repository GitHub creato (deve essere Public)
- [ ] Zoho OAuth configurato (api-console.zoho.eu → Self Client)
- [ ] Secrets configurati su GitHub
- [ ] Prima prova in modalità bozza
- [ ] Approvazione e switch a DRAFT_MODE=false

## Prossimo passo
Setup OAuth Zoho su `api-console.zoho.eu`, poi caricare tutto su GitHub e configurare i Secrets.
