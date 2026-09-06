# Redigera Sirius Entertainment-sidan

## Lägg in de officiella länkarna

Öppna `dist/assets/site.js`. Överst finns:

```js
const LINKS = {
  youtube: "https://www.youtube.com/@SiriusEntertainment-k7o",
  tiktok: "https://www.tiktok.com/@siriusentertainment777?_r=1&_t=ZN-99SZbrkqBhD",
  spotify: "https://open.spotify.com/artist/75t48ljrcloH7Mtr987cOW?si=VX_07Qt_T8WqZgjo4JZxZA&utm_source=copy-link",
  lyricsYoutube: "https://www.youtube.com/@SiriusLyrics89",
  lyricsTiktok: "https://www.tiktok.com/@sirius.lyrics4?_r=1&_t=ZN-99SZvnrd810",
  portfolio: "https://dianabunjaku.com/",
};
```

De nuvarande officiella kanaladresserna är redan inlagda här. Byt bara adressen på denna plats om en kanal flyttar.

## Lägg till fler webbspel

`dist/web-games/` är basmappen för alla webbspel. The Sock Heist ligger komplett i `dist/web-games/sockjakten/`, medan `dist/web-games/index.html` är bibliotekssidan som länkar till spelen.

För varje nytt spel:

1. Duplicera hela blocket som börjar med `<article class="game-library-card"`.
2. Byt titel, universum, beskrivning, genrer och knapptext.
3. Skapa en egen undermapp, exempelvis `dist/web-games/new-game/`, och lägg hela spelet där.
4. Sätt kortets länk till `new-game/index.html` och behåll `target="_blank"` om spelet ska öppnas i en ny flik.
5. Placera det nya kortet före HTML-kommentaren som markerar var framtida spel ska läggas in.

När hela `dist` publiceras till Netlify följer alla spelmappar automatiskt med i samma GitHub-projekt och samma webbplats.

## När mobilappen lanseras

I `dist/games/index.html` finns kortet **Interactive storytelling app**. Det är ett fristående projekt. När appen lanseras lägger du in App Store- och Google Play-knappar i kortet och sparar länkarna i `LINKS` i `dist/assets/site.js`.

## När PC-spelet får titel

Sök efter `Online PC game` i `dist/games/index.html` och ersätt namnet, beskrivningen och statusen när projektet kan visas offentligt. Lägg då även in köp- och nedladdningsknappar med riktiga länkar. De känsliga konceptdetaljerna ska inte skrivas in som synlig platshållartext.

## När community öppnar

`dist/community/index.html` beskriver den planerade strukturen. Forum, användarkonton och chatt kräver en backend eller en extern communityplattform. Lägg inte in låtsaskonton i HTML-versionen; koppla i stället sidan till det riktiga systemet när det är valt.

## När store öppnar

`dist/store/index.html` innehåller bara kategorier och har ingen betalning. En riktig butik behöver produktdata, lager, betalningsleverantör, köpvillkor, integritetstext och fraktinformation.

Store-kategorierna använder ikoner tills riktiga produktbilder finns.

## Koppla Google Analytics

Analytics-koden finns redan på alla företagssidor och inne i The Sock Heist, men skickar ingenting förrän ett giltigt Measurement ID har lagts in.

1. Öppna Google Analytics och välj samma konto som portfolion använder.
2. Skapa helst en separat GA4-egendom för **Sirius Entertainment**. Då kan du växla mellan portfolion och Sirius med egendomsväljaren utan att blanda statistiken.
3. Skapa ett Web data stream för Sirius-domänen.
4. Kopiera dess Measurement ID, som börjar med `G-`.
5. Öppna `dist/assets/analytics.js` och klistra in ID:t på raden `const GA_MEASUREMENT_ID = "";`.

För en offentlig lansering riktad till besökare i EES behöver samtyckesval kopplas till Google-taggen. Analytics-filen är därför medvetet avstängd tills ID och samtyckeslösning är redo.

## Ändra design

Alla färger och grundmått finns högst upp i `dist/assets/site.css` under `:root`. Exempel:

```css
--deep: #020716;
--cyan: #77d9ff;
--violet: #8d6cff;
--orange: #ff9b44;
```

Stjärnhimmelns långsamma rörelse och stjärnfallens utseende finns i samma CSS-fil. De slumpmässiga startpositionerna och tidsintervallen finns i `dist/assets/site.js` under `launchShootingStar()`.

## Publicera på Netlify

1. Lägg projektet på GitHub.
2. Skapa en ny site i Netlify från repositoryt.
3. Lämna build command tomt.
4. Sätt publish directory till `dist`.
5. Lägg till din domän under Domain management när testsidan är godkänd.
