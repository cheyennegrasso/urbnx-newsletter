# URBNX Newsletter — Setup in 5 passi

## Cosa serve
- Account GitHub (gratis)
- Chiave API Anthropic
- Credenziali Zoho Campaigns

---

## Passo 1 — Carica i file su GitHub

1. Vai su **github.com** → `+` → **New repository**
2. Nome: `urbnx-newsletter` · Visibilità: **Public** · crea
3. Carica tutto il contenuto di questa cartella (inclusa `.github/`)
4. Se `.github/` non si vede, crea manualmente: `New file` → `.github/workflows/newsletter.yml` e incolla il contenuto

---

## Passo 2 — Chiave Anthropic

1. Vai su **console.anthropic.com** → API Keys → **Create Key**
2. Copia la chiave (la usi al Passo 4)

---

## Passo 3 — Credenziali Zoho

### 3a. Crea un Self Client
1. Vai su **api-console.zoho.eu** → `Self Client`
2. Scope: `ZohoCampaigns.campaign.ALL,ZohoCampaigns.contact.ALL`
3. Duration: **10 minuti** · crea → ti dà `client_id`, `client_secret`, `code`

### 3b. Ottieni il Refresh Token (fai subito, il code scade in 10 min)
Incolla nel browser (sostituisci i valori):
```
https://accounts.zoho.eu/oauth/v2/token?code=CODE&client_id=CLIENT_ID&client_secret=CLIENT_SECRET&redirect_uri=https://localhost&grant_type=authorization_code
```
Copia il `refresh_token` dalla risposta JSON.

### 3c. Trova List Key e Topic ID
- **List Key**: Zoho Campaigns → Mailing Lists → clicca la tua lista → URL contiene `listkey=XXXX`
- **Topic ID**: Settings → Topics → clicca il topic → URL contiene `topicId=XXXX`

---

## Passo 4 — Secrets su GitHub

Nel repository: **Settings → Secrets and variables → Actions → New repository secret**

| Nome secret | Valore |
|---|---|
| `ANTHROPIC_API_KEY` | chiave da Passo 2 |
| `ZOHO_CLIENT_ID` | da Passo 3a |
| `ZOHO_CLIENT_SECRET` | da Passo 3a |
| `ZOHO_REFRESH_TOKEN` | da Passo 3b |
| `ZOHO_LIST_KEY` | da Passo 3c |
| `ZOHO_TOPIC_ID` | da Passo 3c |
| `ZOHO_FROM_EMAIL` | es. newsletter@urbnx.com |

---

## Passo 5 — Prima prova

1. **Actions** → **Newsletter URBNX Settimanale** → **Run workflow**
2. Attendi ~1 minuto — controlla i log
3. Vai su Zoho Campaigns → Draft: trovi la newsletter creata
4. Aprila, controlla, e invia manualmente

Quando sei soddisfatta, cambia `DRAFT_MODE: "true"` in `"false"` nel file `.github/workflows/newsletter.yml` per attivare l'invio automatico ogni lunedì.

---

## Risoluzione problemi comuni

**"Nessuna location trovata"** → L'endpoint dell'API potrebbe usare un tipo diverso. Prova ad aprire `https://app.urbnx.com/wp-json/wp/v2/types` e cerca il tipo che contiene le location (es. `location`, `smartworking`, ecc.). Poi aggiorna `locationPostType` in `generate-newsletter.mjs`.

**Errore Zoho token** → Il refresh token è scaduto o sbagliato. Ripeti il Passo 3.

**La foto non si vede nell'email** → L'URL dell'immagine deve essere pubblico. Verifica aprendo il link in una finestra in incognito.
