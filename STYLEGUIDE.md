# Steuerrechner Design System & Styleguide

Dieses Dokument dient als zentrale Referenz für das Design-System des Steuerrechners. Es basiert auf dem offiziellen **CDU Corporate Design Manual (Stand Mai 2026)** und dem ergänzenden **Digitale Design-Elemente Manual (Stand Mai 2026)**.

Hier ist dokumentiert, wie die UI-Elemente farblich und typografisch aufgebaut sind, welche CSS-Variablen sie steuern und wie sie schnell angepasst werden können.

---

## 🎨 1. Die offizielle CDU-Farbpalette

Verwende für farbliche Zuweisungen ausschließlich diese vordefinierten Farben aus den offiziellen Markenrichtlinien:

| Name | Hex-Code | RGB-Wert | Beschreibung / Verwendung |
| :--- | :--- | :--- | :--- |
| **Cadenabbia-Türkis** | `#52b7c1` | `82, 183, 193` | **Hauptfarbe:** Akzente, primäre interaktive Elemente, positive Werte |
| **Rhöndorf-Blau** | `#2d3c4b` | `45, 60, 75` | **Sekundärfarbe:** Haupttextfarbe, strukturierende Hintergründe (Sidebar, Tabellenköpfe) |
| **Union-Gold** | `#ffa600` | `255, 166, 0` | **Tertiärfarbe:** Äußerst dosiert für Highlights, Warnungen oder Vergleichs-Graphen |
| **Weiß** | `#ffffff` | `255, 255, 255` | **Dominierende Farbe:** Haupt-Hintergrund, Inhaltskarten |

### Zusatzfarben (für Flächen & Box-Hintergründe)
* **Cadenabbia-Türkis (10%)**: `#f2f8fa` (Standard für weiche Panel-Hintergründe)
* **Cadenabbia-Türkis (25%)**: `#ddeef1` (Zarte Linien und Rahmen um Inhaltskarten)
* **Cadenabbia-Türkis (60%)**: `#a7d5dc` (Für Graphen-Flächen und dekorative Hervorhebungen)
* **Rhöndorf-Blau (10%)**: `#e5e5e9` (Für neutrale Linien, Tabellenteiler und Ränder)
* **Rhöndorf-Blau (25%)**: `#bec1c7` (Für Formular-Rahmen und Ränder)
* **Rhöndorf-Blau (60%)**: `#737986` (Für gedämpfte, sekundäre Beschriftungen und Achsentexte)

---

## 🚫 2. Hintergründe & Verläufe

> [!IMPORTANT]
> **Verbot von Farbverläufen**
> Gemäß dem digitalen Handbuch (Design-Elemente_5.pdf, S. 5) sind **Farbverläufe (Gradients) ausdrücklich nicht gestattet**.
> 
* Hintergründe müssen flach in Weiß (`#ffffff`) oder in einer der weichen Zusatzfarben (z. B. `#f2f8fa` für Sidebar/Panels) angelegt sein.
* Es dürfen keine CSS-Gradients (wie `linear-gradient` oder `radial-gradient`) für Layout-Flächen verwendet werden.

---

## ⚙️ 3. CSS-Variablen & UI-Zuordnung (src/Rechner.jsx & src/index.css)

In der Vite-Projektstruktur werden alle Design-Tokens im `.sr-root`-Selektor deklariert. Diese Variablen steuern das gesamte Erscheinungsbild:

| CSS-Variable | Wert | UI-Element / Zweck |
| :--- | :--- | :--- |
| `--paper` | `#ffffff` | Haupt-Hintergrund |
| `--panel` | `#f2f8fa` | Hintergrund der Sidebar und Informationsboxen |
| `--ink` | `#2d3c4b` | Haupttext (Rhöndorf-Blau) |
| `--ink-soft` | `#737986` | Gedämpfter Text und Diagramm-Achsen |
| `--line` | `#ddeef1` | Trennlinien, Gitter & feine Umrandungen |
| `--steel` | `#2d3c4b` | Status Quo 2026 (Rhöndorf-Blau, z. B. Kurven/Flächen) |
| `--steel-soft` | `#737986` | Status Quo 2026 Füllungen/Raster |
| `--gold` | `#52b7c1` | Reform 2028 (Cadenabbia-Türkis, z. B. Kurven/Schaltflächen) |
| `--gold-soft` | `#a7d5dc` | Reform 2028 Füllungen/Hintergründe |
| `--brick` | `#ffa600` | Highlight-Linien und relative Prozentkurven (Union-Gold) |
| `--c-stadt` | `#737986` | Referenzprofil Städter |
| `--c-vorstadt` | `#ffa600` | Referenzprofil Vorstadt |
| `--c-land` | `#2d3c4b` | Referenzprofil Land |

---

## 🛠️ 4. Typografie (Schriftarten & Formatierung)

Die typografischen Vorgaben folgen streng den Spezifikationen der offiziellen Handbücher:

### 4.1 Headline-Schrift (Überschriften)
* **Schriftfamilie:** `Inter` (Schriftschnitt **ExtraBold**, Gewicht `800`).
* **Laufweite (Letter Spacing):** Muss auf **-10** (CSS: `letter-spacing: -0.02em`) gesetzt werden, um die charakteristische Kompaktheit der Marke zu gewährleisten.
* **Schreibung:** Headlines stehen immer in normaler Groß- und Kleinschreibung – **niemals in reinen Versalien (Großbuchstaben)**.

### 4.2 Subline-Schrift (Untertitel)
* **Schriftfamilie:** `Inter` (Schriftschnitt **Medium**, Gewicht `500`).
* **Schreibung:** Normale Groß- und Kleinschreibung.

### 4.3 Fließtext & Formular-Labels (Copy)
* **Schriftfamilie:** `IBM Plex Serif` (Schriftschnitt **Regular**, Gewicht `400`).
* **Hervorhebungen (Accents):** Wichtige Wörter oder Phrasen im Text werden *ausschließlich* in **`IBM Plex Serif Bold Italic`** (Gewicht `700`, `font-style: italic`) gesetzt.

### 4.4 Ausnahmen (Tabellendaten & Diagramme)
* Für tabellarische Zahlen, Diagramm-Achsen und technische Datenpunkte darf **`IBM Plex Mono`** (monospace) verwendet werden, um die vertikale Ausrichtung von Ziffern und die Lesbarkeit zu verbessern.

---

## 📊 5. Diagramm-Farben (Recharts in src/Rechner.jsx)

Die Farben im Diagramm spiegeln die Marken-Identitäten und Referenzprofile wider:

* **Aktuelles Profil / Reform 2028 (Hauptkurve):**
  * Linie: `#52b7c1` (Cadenabbia-Türkis)
  * Füllung darunter: `rgba(82, 183, 193, 0.12)` (`var(--gold)` mit 12% Deckkraft)
* **Städter (Referenz):** `#737986` (60% Rhöndorf-Blau, gestrichelt)
* **Vorstadt (Referenz):** `#ffa600` (Union-Gold, gestrichelt)
* **Land (Referenz):** `#2d3c4b` (Rhöndorf-Blau, gestrichelt)
* **Rasterlinien (Grid):** `#ddeef1` (`var(--line)`)
* **Achsenbeschriftung (Ticks):** `#737986` (`var(--ink-soft)`)
* **Tooltips (Info-Box):** 
  * Hintergrund: `#ffffff` (`var(--paper)`) mit feinem Rahmen `#ddeef1` (`var(--line)`)
  * Text: `#2d3c4b` (`var(--ink)`)
