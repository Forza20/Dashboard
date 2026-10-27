# Dashboard

Besøgsstatistik for [Forza20.github.io](https://forza20.github.io) fra [GoatCounter](https://forza20.goatcounter.com).

Et GitHub Actions-workflow henter hver dag antal besøgende i alt, pr. land (locations) og pr. skærmstørrelse (screen sizes) og gemmer dem i [stats-historik.md](stats-historik.md). Filen er grundlaget for et dashboard med udviklingen i besøgende pr. uge.

## Filer

| Fil | Indhold |
| --- | --- |
| [stats-historik.md](stats-historik.md) | Historik: én række pr. dato, type (Total / Location / Screen size) og værdi |
| [scripts/fetch-goatcounter.js](scripts/fetch-goatcounter.js) | Henter tal fra GoatCounters API (Node 20, ingen afhængigheder) |
| [.github/workflows/goatcounter.yml](.github/workflows/goatcounter.yml) | Kører scriptet dagligt kl. 21:50 UTC og committer ændringer |

## Opsætning

1. Opret en API-nøgle i GoatCounter: brugernavn øverst → **API** → ny nøgle med adgang til at læse statistik.
2. Gem nøglen som repository secret `GOATCOUNTER_TOKEN`:
   `gh secret set GOATCOUNTER_TOKEN -R Forza20/Dashboard`
3. Hent historik én gang: **Actions → Hent GoatCounter-tal → Run workflow**, med `days` = fx 365.

## Bemærk

- Tallene er unikke besøgende pr. UTC-døgn. GoatCounter har kun lokationer og skærmstørrelser i UTC.
- Hver kørsel overskriver i går og i dag, så gårsdagens tal bliver endelige.
- Filtrene virker hver for sig: GoatCounter oplyser ikke land og skærmstørrelse kombineret.
