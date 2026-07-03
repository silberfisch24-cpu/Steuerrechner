# Steuerrechner Design System & Styleguide

Dieses Dokument dient als zentrale Referenz für das Design-System des Steuerrechners. Es basiert auf dem offiziellen **CDU Corporate Design Manual (Stand Mai 2026)**.

Hier ist dokumentiert, wie die UI-Elemente farblich und typografisch aufgebaut sind, welche CSS-Variablen sie steuern und wie sie schnell angepasst werden können.

---

## 🎨 1. Die offizielle CDU-Farbpalette

Verwende für farbliche Anpassungen ausschließlich diese vordefinierten Farben aus dem Styleguide:

| Name | Hex-Code | RGB-Wert | Beschreibung / Verwendung |
| :--- | :--- | :--- | :--- |
| **Cadenabbia-Türkis** | `#52b7c1` | `82, 183, 193` | **Hauptfarbe:** Akzente, primäre Buttons, Graphen, aktive Zustände |
| **Rhöndorf-Blau** | `#2d3c4b` | `45, 60, 75` | **Sekundärfarbe:** Textfarbe (sehr gut lesbar), Tabellenköpfe, Highlight-Flächen |
| **Union-Gold** | `#ffa600` | `255, 166, 0` | **Tertiärfarbe:** Sehr dosiert für Highlights, Warnungen, Vergleichs-Graphen |
| **Weiß** | `#ffffff` | `255, 255, 255` | **Dominierende Farbe:** Haupt-Hintergrund, Inhaltskarten |

### Zusatzfarben (für Flächen & Box-Hintergründe)
* **Cadenabbia-Türkis (10%)**: `#f2f8fa` (Standard für weiche Hintergründe)
* **Cadenabbia-Türkis (25%)**: `#ddeef1` (Für zarte Rahmen um Karten)
* **Cadenabbia-Türkis (60%)**: `#a7d5dc` (Für Graphen-Unterfütterungen)
* **Rhöndorf-Blau (10%)**: `#e5e5e9` (Für neutrale Linien und Trennelemente)
* **Rhöndorf-Blau (25%)**: `#bec1c7` (Für Formular-Rahmen)
* **Rhöndorf-Blau (60%)**: `#737986` (Für sekundäre/gedämpfte Texte)

---

## ⚙️ 2. CSS-Variablen & UI-Zuordnung (styles.css & steuerrechner_entlastung_2028.html)

In den Stylesheets (`styles.css` und im `<style>`-Block der `steuerrechner_entlastung_2028.html`) steuern diese CSS-Variablen das Aussehen der Benutzeroberfläche:

| CSS-Variable | Wert | UI-Element / Zweck | Wie anpassen? |
| :--- | :--- | :--- | :--- |
| `--bg-primary` | `#ffffff` | Hauptseite-Hintergrund | Ändert den Hintergrund der gesamten App |
| `--bg-secondary` | `#f2f8fa` | Hintergrund der Sidebar & Seite | Ändert den Kontrastbereich hinter den Karten |
| `--card-bg` | `#ffffff` | Hintergrund der Inhaltskarten | Ändert den Hintergrund von Formularen/Diagrammkarten |
| `--card-border` | `#ddeef1` | Rahmen um Inhaltskarten | Ändert die Farbe der feinen Umrandung |
| `--accent-color` | `#52b7c1` | Primäre Akzentfarbe | Ändert Buttons, aktive Schieberegler, Markierungen |
| `--accent-glow` | `rgba(82,183,193,0.15)`| Schimmer-Effekt bei Fokus | Ändert das Leuchten um aktive Eingabefelder |
| `--text-main` | `#2d3c4b` | Haupttext | Ändert die Farbe aller Überschriften & Fließtexte |
| `--text-muted` | `#737986` | Gedämpfter Text | Ändert Labels, Beschreibungen, sekundäre Infos |
| `--neutral-border` | `#e5e5e9` | Trennlinien & Tabellenränder | Ändert Teiler und Input-Rahmen |
| `--table-header` | `#2d3c4b` | Tabellenkopf | Ändert den Hintergrund des Spaltenkopfs |
| `--table-row-hover` | `#f2f8fa` | Zeilen-Hover-Effekt | Ändert den Hintergrund einer Zeile bei Hover |
| `--positive` | `#10b981` | Positive Ersparnisse (Grün) | Ändert die Farbe von "+ X €"-Beträgen |
| `--negative` | `#ef4444` | Zusätzliche Belastung (Rot) | Ändert die Farbe von "- X €"-Beträgen |

---

## 📊 3. Diagramm-Farben (Chart.js in app.js)

Die Farben im Diagramm der Vanilla-HTML-Version werden in `app.js` (und im `<script>`-Block der `steuerrechner_entlastung_2028.html` ab ca. Zeile 1236) direkt im JavaScript-Code definiert:

* **Aktuelles Profil (Hauptkurve)**: 
  * Linie: `#52b7c1` (Cadenabbia-Türkis)
  * Fläche darunter: `rgba(82, 183, 193, 0.1)`
* **Städter (Referenz)**: `#737986` (60% Rhöndorf-Blau, gestrichelt)
* **Vorstadt (Referenz)**: `#ffa600` (Union-Gold, gestrichelt)
* **Land (Referenz)**: `#2d3c4b` (Rhöndorf-Blau, gestrichelt)
* **Rasterlinien (Grid)**: `#e5e5e9` (10% Rhöndorf-Blau)
* **Achsenbeschriftung (Ticks)**: `#737986` (60% Rhöndorf-Blau)
* **Tooltips (Info-Box bei Hover)**: 
  * Hintergrund: `rgba(45, 60, 75, 0.95)` (95% Rhöndorf-Blau)
  * Text: `#ffffff` & `#f2f8fa`

---

## ⚛️ 4. React-Komponente (Rechner.html & Rechner.jsx)

Die React-Version nutzt eigene CSS-Variablen im `.sr-root`-Selektor innerhalb der Datei. Um dort Farben zu ändern, passe diese Zuweisungen an:

```css
.sr-root {
    --paper: #ffffff;      /* Haupt-Hintergrund */
    --panel: #f2f8fa;      /* Sidebar / Panel-Hintergrund */
    --ink: #2d3c4b;        /* Haupttext (Rhöndorf-Blau) */
    --ink-soft: #737986;   /* Gedämpfter Text / Achsen */
    --line: #ddeef1;       /* Trennlinien & Gitter */
    --steel: #2d3c4b;      /* Status Quo 2026 Linie (Rhöndorf-Blau) */
    --steel-soft: #737986; /* Status Quo 2026 Fläche */
    --gold: #52b7c1;       /* Reform 2028 Linie (Cadenabbia-Türkis) */
    --gold-soft: #a7d5dc;  /* Reform 2028 Fläche */
    --brick: #ffa600;      /* Highlight-Linien (Union-Gold) */
    --c-stadt: #737986;    /* Referenz Städter */
    --c-vorstadt: #ffa600; /* Referenz Vorstadt */
    --c-land: #2d3c4b;     /* Referenz Land */
}
```

---

## 🛠️ 5. Typografie (Schriftarten)

* **Überschriften**: `Outfit` (wird über Variable `--font-heading` zugewiesen)
  * *Hinweis aus dem Styleguide:* Headlines dürfen **nie in reinen Versalien (Großbuchstaben)** stehen. Verwende normale Groß- und Kleinschreibung.
* **Fließtext / Formular-Labels**: `Plus Jakarta Sans` (wird über Variable `--font-body` zugewiesen)
* **Untertitel / Serifen-Akzente (React)**: `Fraunces` bzw. `IBM Plex Serif`

---

## 📝 Kurzanleitung: "Wie ändere ich die Farbe von..."

1. **Den primären Button / den Berechnen-Button**: 
   Suche in `styles.css` nach `.accent-color` oder passe `--accent-color` an. 
2. **Die Hintergrundfarbe der Sidebar**:
   Passe `--bg-secondary` an.
3. **Die Linie für das 'Aktuelle Profil' im Diagramm**:
   Passe in `app.js` den Wert `borderColor` für das erste Dataset (ca. Zeile 234) bzw. `--gold` in `Rechner.jsx` an.
4. **Den Tabellen-Header**:
   Passe `--table-header` in den Stylesheets an.
