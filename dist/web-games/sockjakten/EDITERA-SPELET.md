# Redigera The Sock Heist

Gör en liten ändring i taget, spara filen och uppdatera sidan i Live Server.

## Ändra en karaktär

Öppna `js/config.js` och leta efter karaktärens id:

```js
clawster: {
  speed: 260,
  jump: 540,
  cooldown: 10,
  drawHeight: 79,
}
```

- `speed` styr toppfarten.
- `acceleration` styr hur snabbt figuren kommer upp i fart.
- `jump` styr hoppkraften.
- `cooldown` är väntetiden efter specialförmågan.
- `width` och `height` är figurens träffyta. Den följer den synliga figuren men är något smalare för att rörelserna ska kännas rättvisa.
- `drawHeight` styr figurens synliga storlek.

## Byt bild eller musik

Karaktärsvalet använder transparenta `*-portrait.png`-filer. Byt `portraitAsset` i `js/config.js` om filnamnet ändras. Karaktären ska vara en centrerad helkroppsmodell utan bakgrund. Rumsbilderna ska vara 16:9 och sedda rakt från sidan.

Theme song byts genom att ersätta `assets/theme-song.mp3`. Den spelas endast under laddningen och på startsidan. Karaktärsvalets musik ligger i `assets/AmbienceTTHCPickCharacter.mp3`. Varje levels `music`-värde finns bredvid `background` i `js/levels.js`, och `syncAudioForContext()` i `js/game.js` ser till att rätt spår endast spelas i rätt vy eller under aktiv gameplay.

Laundry Room använder det färdiga spåret `assets/AmbienceTTHCLaundry.mp3`. Om någon nivåmusik senare ska bytas räcker det att ersätta motsvarande MP3-fil med samma filnamn; ingen kod behöver ändras.

## Förstå rummets koordinater

Spelytan är 1280 × 720 pixlar. Övre vänstra hörnet är `x: 0, y: 0`.

All leveldesign finns i `js/levels.js`. Varje nivå har en rumsbild och exakta spelzoner som följer möblernas verkliga överkanter. I spelet ritas dessa kanter ut med ljusa linjer, så spelaren ser direkt var det går att landa.

## Möbelytor

En yta som går att landa på:

```js
{ x: 105, y: 452, w: 458, h: 30, type: "bed", label: "sängen" }
```

- `x` och `y` placerar ytans övre vänstra hörn.
- `w` är den landningsbara bredden.
- `h` används för att beskriva objektets tjocklek.

Spelet ritar bara en diskret kantglimt; rumsbilden står för själva möbeln.

## Klättring

Klätterzoner ska följa tyg, handtag, rör eller möbelsidor i bakgrundsbilden:

```js
{ x: 485, y: 405, w: 58, h: 195, label: "sängöverkast" }
```

När spelaren närmar sig visas `W/S KLÄTTRA`.

## Gömställen

```js
{ x: 145, y: 505, w: 380, h: 92, label: "under sängen" }
```

Spelaren trycker `Q` eller `F` nära zonen. Efter drygt fem sekunder börjar gömstället låta och Draco kan undersöka det, så gömmandet är inte obegränsat.

## Ljudzoner

```js
{ x: 720, y: 586, w: 120, h: 14, label: "knarrande golv" }
```

Rörelse över zonen höjer Dracos misstanke. Vanliga snabba steg kan också höras om Draco är nära.

## Föremål och flyktväg

```js
{ x: 430, y: 420, kind: "sock" }
```

Tillåtna sorter är `sock`, `key`, `button`, `spoon`, `spool`, `clip` och `remote`.

Flyktvägen är låst tills alla föremål är samlade:

```js
exit: { x: 1230, y: 519, w: 38, h: 80, label: "dörrspringan" }
```

## Dracos fria rumsrörelse

Draco använder rummets faktiska `surfaces` som möjliga mål. Funktionen `chooseDracoRoamTarget()` väljer kontinuerligt en ny nåbar golv- eller möbelyta, varierar hastigheten och kan göra korta riktningsbyten. `keepDracoMoving()` upptäcker om han inte har förflyttat sig och väljer då omedelbart en ny väg. Syn, ljud och spelarens beteende styr övergången till `alert`, `chase` och `search` i `updateDraco()`.

Varje figur har dessutom ett `*-motion.webp` i `assets/`. Bilden är ett 3 × 2-ark med poser i ordningen vila, gångsteg 1, gångsteg 2, hopp, klättring och vaksamhet. `getCharacterFrame()` väljer automatiskt rätt pose under spelet.

## Crew-AI när du spelar Draco

`chooseThiefRoamTarget()` låter varje tjuv välja nya nåbara mål på rummets riktiga möbelytor. `tryThiefHide()` och `leaveThiefHideSpot()` styr hur de använder mörka gömställen, medan `useThiefAiAbility()` innehåller deras enklare AI-anpassade förmågor. Ändra sannolikheter och tider försiktigt så att Draco-läget förblir utmanande men möjligt att klara.

## Balansera förmågorna

Cooldown och beskrivning finns i `js/config.js`. Effekt, räckvidd och varaktighet finns i `useAbility()` i `js/game.js`.

Vaktstöt är medvetet en bedövning, inte en automatisk fångst. Magnetklo och Genidrag kräver att målet är inom räckvidd. Vingsvep fungerar i luften. Falskt spår kräver att Draco redan misstänker något.

## Återställ eller lås upp nivåer

Återställ framsteg i webbläsarens utvecklarverktyg:

```js
localStorage.removeItem("sockjakten-progress-v4")
```

Lås upp alla fyra nivåer under testning:

```js
localStorage.setItem("sockjakten-progress-v4", "4")
```

Uppdatera sidan efter kommandot.

## Publicera en ändring tillsammans med företagssidan

Kör kommandona från Sirius Entertainment-projektets rotmapp. När Netlify är kopplat till företagssidans GitHub-repository publiceras både sidan och alla webbspel normalt automatiskt:

```bash
git add .
git commit -m "Beskriv vad du ändrade"
git push
```
