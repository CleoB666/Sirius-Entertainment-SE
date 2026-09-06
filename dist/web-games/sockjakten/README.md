# The Sock Heist

Ett rumsbaserat smyg- och heistspel för webbläsaren, producerat av **Sirius Entertainment** och baserat på **The Tiny Heist Crew**. Du kan spela som någon av fem socktjuvar eller som väktaren Draco.

Spelet ligger som en komplett undermapp i Sirius Entertainment-projektet. Det kräver ingen databas, ingen extern spelmotor och inget byggsteg.

## Spela lokalt i VS Code

1. Packa upp Sirius Entertainment-paketet.
2. Öppna projektets rotmapp i **Visual Studio Code**.
3. Installera tillägget **Live Server** när VS Code föreslår det.
4. Högerklicka på `dist/index.html` och välj **Open with Live Server**.
5. Öppna sedan `/web-games/sockjakten/` från Browser Games-sidan.

Öppna inte bara `index.html` genom att dubbelklicka. JavaScript-modulerna behöver köras via en lokal webbserver, exempelvis Live Server.

## Kontroller

| Handling | Tangenter |
|---|---|
| Rör dig | `A`/`D` eller vänster/höger pil |
| Hoppa | `Mellanslag` |
| Klättra på tyg, rör och möbler | `W`/`S` eller upp/ner pil |
| Göm dig/lämna gömstället | `Q` eller `F` |
| Specialförmåga | `E` eller `Shift` |
| Pausa | `P` eller `Esc` |
| All musik av/på | `M` |

Pekkontroller visas automatiskt på telefoner och surfplattor.

## Gameplay

Som socktjuv samlar du alla lysande föremål och når sedan den orange flyktvägen. Draco strövar kontinuerligt och oförutsägbart mellan rummets golv och möbler. Om han ser eller hör dig övergår han stegvis från lugn till misstänksam, jakt och sökning. Bryt hans blick och tryck `Q` vid sängar, korgar, skåp eller andra markerade gömställen.

Möblernas ljusa överkanter visar exakt var figuren kan landa. Hoppa med riktning mot kanten för ett automatiskt kantgrepp och en kort uppdragning. Markerat tyg, rör och handtag klättras med `W/S` eller piltangenterna.

Som Draco söker du igenom rummet och fångar alla socktjuvar genom att röra vid dem. Draco har ingen tidsgräns. I stället söker tjuvarna aktivt efter nivåns strumpor och Draco förlorar om de hinner stjäla samtliga. Tjuvarna väljer nya vägar mellan golv och möbler, hoppar, klättrar, gömmer sig och använder sina egna förmågor när du närmar dig. Stanna nära ett misstänkt gömställe för att tvinga fram den som gömmer sig. Vaktstöt bedövar synliga tjuvar i närheten men fångar dem inte automatiskt.

## Nivåer

1. **Sovrummet** – strumpor, säng, byrå, garderob och de första gömställena.
2. **Tvättstugan** – maskiner, handdukar, korgar och blött klinkergolv.
3. **Vardagsrummet** – soffa, bord, bokhylla och fler möjliga vägar.
4. **Köket** – en senare och svårare nivå med heta ytor och fler ljudfällor.

Nivåerna låses upp i ordning och framstegen sparas i webbläsaren.

## Publicera tillsammans med företagssidan

Spelet ska inte läggas i ett separat repository. Kör Git-kommandona från Sirius Entertainment-projektets rotmapp:

```bash
git init
git add .
git commit -m "Uppdatera Sirius Entertainment och The Sock Heist"
git branch -M main
git remote add origin https://github.com/DITT-NAMN/DITT-REPO.git
git push -u origin main
```

Byt adressen mot företagssidans repository. Du kan också ladda upp hela projektet via GitHubs webbgränssnitt.

Koppla därefter projektet till Netlify:

1. Välj **Add new site** → **Import an existing project**.
2. Välj GitHub och spelets repository.
3. Låt **Build command** vara tomt.
4. Sätt **Publish directory** till `dist`.
5. Klicka **Deploy**.

`netlify.toml` i projektets rot innehåller redan rätt publiceringsmapp. Hela `/web-games/sockjakten/` följer med automatiskt.

### 3. Koppla egen domän

Öppna **Domain management** i Netlify och välj **Add a domain** för Sirius Entertainment-domänen.

## Var ändrar jag vad?

| Fil | Innehåll |
|---|---|
| `js/config.js` | Karaktärernas fart, hopp, storlek, texter och cooldowns |
| `js/levels.js` | Möbelytor, klättring, gömställen, ljudzoner, föremål och nivåordning |
| `js/game.js` | Mjuk fysik, kantgrepp, Draco-AI, smygsystem, poseanimationer och rendering |
| `styles.css` | Menyer, HUD, färger, typografi och responsiv design |
| `index.html` | Synlig text, regler, knappar och sidstruktur |
| `assets/` | Karaktärer, Sirius-logga, rumsbilder och theme song |

Konkreta kodexempel finns i [EDITERA-SPELET.md](EDITERA-SPELET.md).

## Versionens viktigaste förbättringar

- Rummen är själva spelvärlden; möblerna är ytorna du hoppar och klättrar på.
- Sovrummet är ny första nivå och köket är flyttat till nivå fyra.
- Draco väljer löpande nya mål, byter ibland riktning och tar sig mellan golv och nåbara möbler utan långa stopp.
- I Draco-läget väljer Crew-medlemmarna egna rutter, söker gömställen och använder balanserade AI-versioner av sina specialförmågor.
- Alla figurer växlar mellan separata poser för vila, gång, hopp, klättring och vaksamhet.
- Karaktärsvalet använder separata transparenta 3D-porträtt som visar hela figuren utan bildbakgrund.
- Landningsytorna följer de synliga möblernas överkanter och visas tydligt i rummet.
- Tydlig varning för lugn, misstanke, jakt, sökning och gömt läge.
- Gömställen och ljudzoner påverkar jakten.
- Fast fysikuppdatering, coyote time, jump buffering och mjukare acceleration.
- Förmågorna har kortare effekt, begränsad räckvidd och längre cooldown.
- Sirius Entertainment är korrekt avsändare; The Tiny Heist Crew är seriens/tjuvarnas namn.

## Bild- och ljudfiler

Karaktärsvalets filer heter `*-portrait.png` och ska vara transparenta helkroppsrenderingar med luft runt hela figuren. De kopplas via `portraitAsset` i `js/config.js`. Rörelsearken `*-motion.webp` används endast inne i gameplay och ska lämna luft runt hela figuren i varje ruta.

Rumsbilderna heter `room-bedroom.webp`, `room-laundry.webp`, `room-living.webp` och `room-kitchen.webp`. Theme song ligger i `assets/theme-song.mp3` och spelas endast under laddningen och på startsidan. Karaktärsvalet använder `assets/AmbienceTTHCPickCharacter.mp3`. Samtliga fyra nivåer – Bedroom, Laundry Room, Living Room och Kitchen – har ett eget färdigt `AmbienceTTHC*.mp3` som loopas endast under aktiv gameplay. Musiken pausas i regler och pausmeny och återupptas när spelet fortsätter.
