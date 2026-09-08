# rondo v0.2 — redesign plan

Cel: z "flat 2007 browser game" do nowoczesnego live-casino look&feel.
Punkt odniesienia zachowany w tagu `v0.1-flat`.

## Zasady spójności

- Jedna scena Pixi na cały viewport (resize-aware); DOM tylko na glass-panele
  (HUD, drawery, chat) warstwowo NAD canvasem.
- Fokus podąża za fazą: **betting** → grid duży (dolny środek), koło mniejsze
  i przygaszone; **spinning/result** → koło rośnie i jest bohaterem, grid
  zjeżdża w dół i maleje. Tweeny easowane, nic nie skacze.
- Paleta: głęboka zieleń + złoto + szkło (blur/translucency), glow na
  aktywnej fazie. Zero twardych ramek z v0.1.

## Etapy (osobne commity)

### 1. Scena i layout (fundament)
- Pixi `resizeTo: window`, układ przeliczany z viewportu (landscape-first).
- `FocusController`: tween scale/pozycji grida i koła sterowany fazą.
- DOM HUD v2: top glass bar (brand, faza+countdown, gracz+saldo), chip-dock
  na dole (pigułka), prawa krawędź = kolumna przycisków (History, Chat,
  Leave).

### 2. Koło pseudo-3D + uczciwa fizyka kulki
- Rzut: `project(angle, r, h)` → `{x: cos·r, y: sin·r·cosTilt − h·sinTilt}`,
  tilt ≈ 55°. Kieszenie = czworokąty między elipsą wewn./zewn., rysowane
  co klatkę do jednego `Graphics` (37 quadów + separatory + stożek + rim);
  37 etykiet `Text` pozycjonowanych/skalowanych per klatka.
- Koło NIGDY nie staje: idle spin wolny, spin szybszy, po wyniku wraca do
  idle. Kulka: orbita przeciwbieżna na zewnętrznym torze → spirala do
  wewnątrz → konwergencja kąta do `wheelRotation + pocketAngle(number)`
  (ląduje tam, gdzie kieszeń JEST) → mikro-bounce → jedzie z kołem.
- Marker znika; wynik komunikują banner + podświetlenie kieszeni/pola.

### 3. Feedback wygranej
- Confetti: burst ~120 cząstek Pixi (prostokąty, grawitacja, obrót, fade)
  przy `returned > 0`; skala z wysokością wygranej.
- Win banner v2: pop + glow + odliczanie kwoty w górę; spokojna wersja
  "no win".

### 4. Drag & drop żetonów (+ klik zostaje)
- `pointerdown` na żetonie w docku → ghost żeton śledzi kursor → drop nad
  canvasem → współrzędne → istniejący rect hit-test grida → `place_bet`.
- Grid podświetla spot pod kursorem podczas przeciągania.

### 5. Chat + drawery + wyjście
- Protokół: `chat_send {text}` (client) / `chat_message {playerId, nickname,
  text, at}` (server, broadcast) + `chatHistory` w snapshot (ring buffer 50
  w pamięci serwera, bez DB); rate-limit 1 msg/s.
- Prawa kolumna przycisków otwiera slide-in drawery: **History** (bety z DB),
  **Players**, **Chat** (badge nieprzeczytanych).
- **Leave table**: czyści sesję z localStorage, rozłącza WS, wraca na Join —
  nowy nick = świeży gość ze 100$ (stare wiersze zostają w DB, to ficzer:
  historia stołu jest prawdziwa).

## Ryzyka / decyzje
- Pseudo-3D w czystym Pixi zamiast three.js: jeden renderer, zero nowych
  zależności, pełna kontrola; koszt to ręczna projekcja (znana matematyka).
- Redraw `Graphics` co klatkę (≈80 kształtów) jest tani; gdyby nie był —
  fallback: RenderTexture płaskiego koła + `PerspectiveMesh`.
- Chat bez persystencji (ring buffer) — świadomy skrót; DB gdy zajdzie
  potrzeba moderacji/historii.
