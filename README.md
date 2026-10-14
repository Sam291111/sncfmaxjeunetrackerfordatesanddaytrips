# MAX Jeune Journey Finder

A small local web app that finds rail itineraries using SNCF's daily MAX availability dataset, with paid TER segments available as connections.

## Run

Requires Node.js 20+ and `unzip` on PATH.

```sh
npm start
```

Then open http://127.0.0.1:3000. The first live search downloads SNCF's GTFS timetable archive and fetches the selected-date MAX dataset export. The files are cached under `.cache/`. GTFS is refreshed after 24 hours; if SNCF is temporarily unreachable, an existing timetable cache remains usable.

## Architecture

- `server.js` validates local API requests, fetches and caches SNCF data, and builds the dated timetable legs.
- `planner.js` owns route construction and search. `stations.js` is the shared station identity/alias registry; `products.js` centralizes rail mode, MAX-feed and OUIGO classification; `time.js` handles Paris service dates and train times.
- `route-worker-client.js` runs route-search expansion in at most two cancellable worker threads. Data loading and timetable-leg construction still run on the server thread; multi-day searches can therefore delay other requests and the Electron window.
- The filtered GTFS stop-time index is built for the rolling 30-day service window and cached as a compressed file keyed to the GTFS version. MAX and connection-rule cache writes use temporary files and atomic replacement.
- User-entered dates and GTFS service times are interpreted in `Europe/Paris`, independent of the computer's configured timezone. GTFS times beyond `24:00` and daylight-saving transitions are preserved.
- The main planner supports one-way and return searches. MAX availability remains a daily snapshot; timetable-only and OUIGO results are identified as unverified where appropriate.

## Checks and route audits

```sh
npm test
npm run audit:stations
npm run audit:routes -- --date 2026-10-08 --origin "Lyon Part Dieu" --destination "Paris Gare de Lyon"
npm run audit:search -- --date 2026-10-08 --return-date 2026-10-08 --origin "Lyon Part Dieu" --destination "Rennes"
```

`audit:routes` compares direct displayed services with the cached MAX feed. `audit:search` builds the route from cached GTFS and MAX data and checks route invariants. Their results are only as current as the cached feed window.

## macOS app

The desktop app runs the same local Node server inside an Electron window. It listens only on `127.0.0.1`, stores downloaded SNCF data in the macOS application support folder, and opens SNCF/Trainline booking links in your default browser. It still needs an internet connection for live timetable and MAX availability data.

On a Mac, install the desktop dependencies and launch the app in development mode:

```sh
npm install
npm run desktop
```

To package a macOS app bundle (for this Mac's architecture):

```sh
npm run desktop:package
```

The `.app` bundle is written under `out/`. The package step excludes the local `.cache/` data so timetable downloads are not copied into the app.

To run without network access, use:

```sh
npm run sample
```

Sample results are synthetic and the page labels sample mode.

## Data and limits

- MAX availability: SNCF Open Data dataset `tgvmax`, refreshed daily.
- Timetables and paid TER connections: SNCF Voyageurs national GTFS export. It includes OUIGO services as well as TGV and regional trains.
- OUIGO handling: the current GTFS export identifies OUIGO in trip IDs. Its 7xxx services are treated as OUIGO Grande Vitesse candidates; its 4xxx services are OUIGO Train Classique and remain paid, since MAX Jeune applies to OUIGO Grande Vitesse only. The public MAX feed does not include OUIGO seat inventory, so candidate schedules are not confirmed free reservations.
- MAX availability is indicative: the public feed's OUI flag is a daily snapshot, not a live remaining-seat count or booking confirmation. Confirm fares, connections, and availability with SNCF before booking. For an SNCF Connect comparison, select MAX JEUNE in the passenger/subscription options; otherwise the results show regular fares.
- Feed station codes are normalized to timetable station names before routing. The audit command checks every distinct IATA code in the last loaded MAX snapshot against current GTFS stop areas: `npm run audit:stations` (run the planner once first so `.cache/max.json` and `.cache/gtfs/stops.txt` exist). Add `-- --all` to print every code, including exact matches. Coverage varies by feed version; the audit reports the current snapshot. This checks station-name coverage, not whether the MAX feed contains every commercial train. Zürich HB is retained as a map destination.
- Journey details show train numbers, including alternate numbers for an identical departure recorded more than once. Each leg links to SNCF Connect and Trainline and has a “Copy leg details” button for its stations, date, times, and train number. SNCF Connect opens its general search form. Trainline opens a route/date results link for verified station IDs (currently Lyon Part-Dieu and Paris Gare de Lyon, in either direction); other stations use the general Trainline search form until their IDs are verified. A result can be selected to open its ticket-options page, but the URL contains a live `selectedOutward` token. Reopening the tested token selected a different train, so it is not a reliable direct link to a chosen service. The planner links to route results, not a guaranteed selected-train ticket page. MAX JEUNE is not applied automatically: add it under Trainline passenger options and verify the exact train, MAX fare, and availability with the seller before booking. Trainline documents MAX JEUNE support [here](https://www.thetrainline.com/fr/compagnies-ferroviaires/sncf/cartes-abonnements-de-train/abonnement-max-jeune); its [Global API](https://www.thetrainline.com/about-us/partnerships) is provided through the distribution partner programme. Connection summaries name the transfer station so same-time options via different stations remain distinguishable.
- Explore destination details can load additional MAX departure options on demand. Day-trip and dated-return options are paired with a return that respects the minimum destination stay and station-change time.
- Paid connection fares are not calculated. Paid rail, TER and bus/coach timetable connections are shown when available; the [GTFS reference](https://gtfs.org/documentation/schedule/reference/#routestxt) defines route type `3` as bus, so those connections are labeled separately from TER. Paid prices and ticket availability are not checked.
- Paid timetable legs are currently considered at the entered origin or destination; intermediate connections are built from MAX availability records.
- Outbound and return trains depart on the dates entered; an overnight itinerary may arrive the following day.
- Routes allow up to four train changes, including overnight and longer connections, so the planner can show a long fallback when no shorter route is available. Same-day searches require at least 30 minutes at the destination and a return arrival on the same calendar day; when no such pair is found among the displayed results, both directions are still shown with a warning. Transfer times use the loaded SNCF station- and train-specific rules; if a station or rule cannot be resolved, a conservative station-based fallback applies. Actual transfer minima can vary by station pair and train.
- Results show daytime options flagged available by the MAX feed, a separate Intercités de nuit section, OUIGO Grande Vitesse candidates with an explicit availability warning, and then the fastest itinerary found. Night services are identified from the MAX feed's `IC NUIT` axis. The fastest option may use paid rail. Fares are not included.
- Brussels searches show an eligibility warning: the public MAX feed can mark Brussels services `OUI`, while SNCF's published MAX JEUNE €0 terms name France, Luxembourg and Freiburg, but not Belgium. Treat feed flags for Brussels as unconfirmed and verify the MAX fare in SNCF Connect.
- The “Include possible OUIGO trains” setting independently controls OUIGO Grande Vitesse timetable candidates in the full journey results and closest-stop search. It is enabled by default; switching it off leaves confirmed MAX trains in the search and excludes OUIGO candidates from fastest-route comparisons too. It does not change MAX seat availability data.
- When paid rail is disabled, the optional closest-stop section can show an incomplete route that gets nearest to the destination using the selected MAX and possible OUIGO legs. OUIGO availability remains unverified. Distance is approximate and calculated from GTFS station coordinates. Same-city pseudo-legs (such as a Lyon Perrache to Lyon Part-Dieu hop) are excluded from the route graph.
- Explore mode maps stations reachable with MAX-only routes using zero through five changes. The 3–5 change filters are off initially; after the first search, changing any filter refreshes the map automatically. Each station appears once using its fewest selected changes, so turn off 0–2 to focus on routes that need more changes. Routes with more changes may include long waits or backtracking. It supports one-way, same-day return, or a return on a chosen later date. Same-day returns require a default three-hour stay at the destination; change this in minutes to suit the trip. A later return can be up to 28 days after the outbound date, leaving the following day in the 30-day snapshot for overnight return connections, and the list shows the return date and times. For searches dated today, the “Only include trains leaving after now” option is on by default and can be turned off; its cutoff uses the Mac's current local time and also applies to additional departure times. The map coordinates come from GTFS station locations. Expanded itinerary options show outbound and return journeys as separate panels.
- Connection preferences apply to both the journey planner and Explore. The default minimum uses SNCF's daily station- and train-specific transfer dataset; SNCF marks forbidden station/train pairs with `-1`. When no rule matches, or station codes cannot be resolved, a station-based fallback applies and the UI identifies when transfer data is unavailable. You can instead choose a single manual minimum from 0 to 240 minutes, or disable all minimum times and SNCF-prohibited-transfer checks. Disabling them can show zero-minute or otherwise infeasible transfers; use that mode to explore possible connections, then verify them before travel. A maximum transfer wait can be set from 1 to 10,080 minutes; blank leaves long and overnight waits unrestricted, and this limit still applies when minimum rules are disabled.
- Date comparison counts distinct direct MAX-available train departures for a station pair over the published rolling 30-day window. Dates outside the window and dates with no MAX-available direct train are visibly crossed out and disabled. Paris (all stations) combines the main Paris terminals; Lyon (all stations) combines Part-Dieu, Perrache and Saint-Exupéry TGV. Known terminal names use their station IATA codes so a search for one station does not count a train to another. Connecting journeys are not included in that calendar.
- Station-specific availability uses station IATA codes where available. Lille Europe (`FRLLE`) and Lille Flandres (`FRADJ`) are mapped separately because the feed's text labels can show both as `LILLE (intramuros)`.
- The official MAX Planner is a useful comparison and shows remaining-seat counts. Its page calls `api/public/refdata/search-freeplaces-proposals` with station IATA codes (for example, Lyon Part-Dieu `FRLPD` to Paris Gare de Lyon `FRPLY`). Direct server requests to that endpoint receive a DataDome 403 challenge, so the local app does not automate around that protection. Compare routes through the official planner page when it is normally accessible.
- SNCF's public `tgvmax` feed provides a daily MAX-available flag and train number, but not remaining seats. In a browser comparison for Lyon Part-Dieu to Paris Gare de Lyon on 14 October 2026, the partner planner displayed 11 trains with seat counts; the public feed listed 12 train numbers as available, with at least one availability flag differing. Treat the calendar counts as a snapshot and verify scarce or conflicting trains with the official planner.

## Data quality and possible improvements

- Repeated searches reuse timetable table indexes and grouped stop-time rows; timetable segment generation pre-filters stops outside the MAX route graph before producing candidate segments. Concurrent requests for the same date window share one stop-time scan. Journey, Explore, additional-times, and closest-destination searches share a bounded connection-frontier expander with conservative Pareto-label pruning. The expander binary-searches each station's sorted departures to skip trains that have already left, and a configured maximum wait bounds the departure window. It retains separate departure cohorts for the main planner and additional-times results, and disables dominance pruning when a finite maximum wait could make an earlier arrival invalid. Quick uses a 12,000-label frontier and 60,000 connection checks; Thorough (the default) uses 48,000 and 240,000 for standard searches. Thorough day-trip Explore gets a larger bounded budget of 72,000 frontier labels, 480,000 outbound checks, 30,000 return labels and 96,000 shared return checks so it can favor destination coverage. Return checks use an initial fair share per destination, then redistribute unused work to candidates whose return search hit its expansion share. Uncapped removes these budgets and can use substantial memory. API diagnostics report stage-specific limits, destination-level return truncation reasons, labels pruned, and sampled peak process memory during the worker task. Route workers are terminated before their concurrency slot is released, so a follow-up search cannot overlap cleanup of the previous worker.
- Day-trip outbound results retain the earliest journey for each distinct return-transfer profile, since a train-specific transfer rule can make a later-arriving service the only feasible day trip. An uncapped connection-scan prototype is available internally with `router: 'csa'`; on a fresh 13 October 2026 feed it returned the same 49 validated destinations as Thorough, while taking 22.0 seconds versus 5.2 seconds for the bounded search. It remains opt-in because the live run found no additional destinations and took about 4.2 times longer. See [the live A/B report](out/live-daytrip-csa-prototype-2026-10-12.json).
- Regression checks use Node's built-in test runner and need no extra dependencies: `npm test`. They cover exact terminal matching, direct-service retention, MAX-first versus fastest-paid separation, overnight connections, route-label dominance and its maximum-wait safeguard, time-windowed expansion, connection settings, day-trip stay defaults, date and request validation, and API safety headers. Route audits cover four-change journeys and five-change Explore paths. The initial suite caught and fixed omitted next-day transfer legs, missing cross-terminal Paris connections, and Explore return-pair lookups that dropped valid direct services. `npm run audit:routes -- --date YYYY-MM-DD --origin "Station" --destination "Station"` compares direct `OUI` services in the loaded MAX snapshot with the route engine's direct results. `npm run audit:search -- --date YYYY-MM-DD --return-date YYYY-MM-DD --origin "Station" --destination "Station"` also loads the cached GTFS and runs the full route builder, then checks direct-service coverage, same-day pairing, timing, transfers, endpoints, and MAX/paid invariants. Run the planner first so `.cache/max.json` and `.cache/gtfs/` cover the chosen dates.
- The public [MAX availability dataset](https://ressources.data.sncf.com/explore/dataset/tgvmax/) is a daily 30-day snapshot. It gives train number, station IATA codes, times, and an available/not-available flag; it does not provide the remaining-seat count. A missing or different train can therefore be a difference between the public snapshot and the partner planner's current inventory.
- The national [SNCF timetable export](https://ressources.data.sncf.com/explore/dataset/horaires-sncf/) includes OUIGO schedules. SNCF says MAX Jeune reservations at €0 are available on eligible [OUIGO Grande Vitesse trains](https://www.ouigo.com/faq?question=vous-avez-un-abonnement-max-jeune-ou-max-senior); OUIGO Train Classique is not included. No public OUIGO MAX seat-count stream was found, so the app shows the schedule as an unverified candidate and never counts it as a confirmed available MAX seat.
- SNCF publishes [national timetable data](https://ressources.data.sncf.com/explore/dataset/horaires-sncf/) in GTFS and NeTEx for the coming 151 days. It also publishes GTFS-RT trip updates and service alerts: updates cover trains running in the next 60 minutes, while alerts cover upcoming services and refresh every two minutes. These feeds can flag delays or cancellations, but cannot fill MAX inventory gaps.
- SNCF's [minimum connection time dataset](https://ressources.data.sncf.com/explore/dataset/temps-correspondance-minimaux/) is downloaded and cached locally for 24 hours. Its daily ZIP contains station-pair rules, train-specific exceptions and station references. The planner uses these rules for connection eligibility and required wait times. It also displays the publication timestamp for the MAX snapshot separately from the time this app retrieved it and the time the search finished.
- The [SNCF Navitia API](https://numerique.sncf.com/startup/api/) can provide an independent route-planning comparison, but requires a developer token and does not include MAX availability. It is best used as an alternative paid-connection/timetable cross-check, not as an availability source.
- The partner MAX Planner exposes richer seat-count results in its own website, but its API is challenged when called directly from this app. The app links to the planner for manual comparison instead of trying to work around that protection.
