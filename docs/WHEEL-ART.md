# Koło v2 — realizm (analiza referencji)

Cel: z "dobrego koła gry online" zrobić koło, które robi szał. Wszystko dalej
proceduralnie (zero assetów — nota o pochodzeniu w README zostaje prawdziwa).

## Analiza referencji (5 uwag Arka → elementy prawdziwego koła)

1. **Turret** (środek): na realnym kole to toczony metalowy trzonek z
   talerzykami i ozdobnym klejnotem na szczycie — u nas była "żółta plama".
2. **Drewno**: mahoń z widocznymi słojami na rimie i orzechowy środek.
3. = pkt 1 (turret to najbardziej charakterystyczny ozdobnik).
4. **Stożek (cone)**: środkowa część z klinami/promienistymi liniami,
   obraca się razem z rotorem — daje odczucie ruchu nawet gdy kieszenie
   są rozmyte.
5. **Ball track + stator**: nieruchoma drewniana rama z wgłębionym kanałem
   kulki (inner shadow, chromowane listwy) i apronem z metalowymi
   deflektorami ("diamentami"). Osobna płaszczyzna: pas numerów wyżej,
   kieszenie schodkiem niżej, rozdzielone chromem.

## Plan (każdy blok = "tydzień developera", tu: etapy jednej sesji)

- **W1 — Materiały i stator.** Proceduralna tekstura drewna (canvas 2D:
  baza + słoje + smugi, 2 palety: mahoń/orzech) → `Texture.from`; statyczna
  rama: drewniany rim z połyskiem (łuk światła u góry), wgłębiony ball track
  (cień górny/odbicie dolne + chromowane listwy), apron z 8 metalowymi
  diamentami. Stator rysowany RAZ.
- **W2 — Rotor: dwie płaszczyzny.** Nowa geometria pierścieni: pas numerów
  (0.63–0.79 R) i kieszenie (0.47–0.62 R) obniżone o `h` w projekcji
  (schodek + cień na styku), chromowane frety między segmentami zamiast
  czarnych kresek, cienki chrom oddzielający rotor od statora.
- **W3 — Cone + turret.** Stożek rysowany raz PŁASKO (kliny, drewno,
  radialny połysk) i obracany pełną macierzą afiniczną `P·R(θ)` — te same
  równania co etykiety, więc kliny wirują w poprawnej perspektywie za
  darmo. Turret: podstawa, toczony trzonek z highlightem, talerzyki,
  fasetowany klejnot + błyski, cień na stożku.
- **W4 — Balistyka i strojenie.** Nowe promienie toru kulki (kanał 0.985 R,
  kieszeń 0.545 R), poprawki labeli (promień/rozmiar), winner-highlight na
  obu pasach, przegląd wydajności (statyczne warstwy raz, per-frame tylko
  rotor-band + kieszenie + kulka).
