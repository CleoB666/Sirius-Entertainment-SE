# Sirius Entertainment – företagssida

En fristående statisk webbplats för Sirius Entertainment. Den innehåller:

- företagscentrerad startsida med studions fyra kreativa områden;
- spelöversikt för webbspel, mobilapp och PC-projekt;
- separat, utbyggbart bibliotek för kostnadsfria webbspel;
- community-sida;
- framtida store;
- media-sida för YouTube och TikTok;
- samarbetssida för Sirius Lyrics;
- en inbyggd version av The Sock Heist som öppnas i en ny flik;
- en gemensam levande stjärnbakgrund, slumpmässiga stjärnfall och animerad mobilmeny.

## Starta lokalt

1. Packa upp ZIP-filen och öppna hela projektmappen i VS Code.
2. Öppna panelen **Run and Debug**.
3. Välj **Run Sirius Entertainment** och tryck på den gröna Run-knappen, eller tryck `F5`.

Webbplatsen öppnas automatiskt på `http://127.0.0.1:4173/`. Inga VS Code-tillägg och ingen paketinstallation behövs. Projektet kan även startas från VS Code-terminalen med `npm start` eller `node server.mjs`.

Stoppa den lokala servern med den röda stoppknappen i VS Code eller `Ctrl+C` i terminalen.

Du kan också publicera innehållet i mappen `dist` direkt via Netlify. Något byggkommando behövs inte.

## Viktiga filer

| Fil | Innehåll |
| --- | --- |
| `dist/index.html` | Startsidan |
| `dist/games/index.html` | Spel och lanseringsstatus |
| `dist/web-games/index.html` | Webbspelsbiblioteket |
| `dist/web-games/sockjakten/` | Hela det spelbara The Sock Heist-spelet |
| `dist/community/index.html` | Communityplanen |
| `dist/store/index.html` | Framtida merchbutik |
| `dist/media/index.html` | YouTube och TikTok |
| `dist/collaborations/index.html` | Sirius Lyrics |
| `dist/assets/site.css` | Hela designen |
| `dist/assets/site.js` | Länkar, X-animerad mobilmeny, stjärnfall och andra animationer |
| `dist/assets/analytics.js` | Google Analytics-konfiguration |

Se `EDITERA-SIDAN.md` för exakta instruktioner.
