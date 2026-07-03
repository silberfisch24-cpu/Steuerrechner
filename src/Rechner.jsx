import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Label,
  ResponsiveContainer,
} from "recharts";

// ---------------------------------------------------------------------------
// Steuermodell (korrigiert)
// ---------------------------------------------------------------------------
// Entfernungspauschale: seit 1.1.2026 einheitlich 0,38 €/km ab dem 1. km
// (vorher 0,30 €/km bis 20 km, danach 0,38 €/km). Gilt für t0 UND t1, da die
// Koalitionseinigung vom 2.7.2026 daran nichts ändert.
function calcPendlerkosten(km, days = 220) {
  if (km <= 0) return 0;
  return days * km * 0.38;
}

// Vereinfachtes Strukturmodell des §32a-Tarifs: linear ansteigender
// Grenzsteuersatz je Progressionszone -> Integration ergibt die
// quadratische Form, die das echte Gesetz ebenfalls erzeugt.
function calcTarif(zveHalf, gfb, eck1, eck2) {
  if (zveHalf <= gfb) return 0;
  
  if (zveHalf <= eck1) {
    const z = (zveHalf - gfb) / (eck1 - gfb);
    return (0.14 + (0.1 * z) / 2) * (zveHalf - gfb);
  }
  
  const taxAtEck1 = (0.14 + 0.1 / 2) * (eck1 - gfb);
  
  if (zveHalf <= eck2) {
    const z = (zveHalf - eck1) / (eck2 - eck1);
    return taxAtEck1 + (0.24 + (0.18 * z) / 2) * (zveHalf - eck1);
  }
  
  const taxAtEck2 = taxAtEck1 + (0.24 + 0.18 / 2) * (eck2 - eck1);
  return taxAtEck2 + 0.42 * (zveHalf - eck2);
}

// t0 = geltendes Recht 2026, t1 = volle Wirkung der Koalitionseinigung ab 2028
const PARAMS = {
  t0: {
    pausch: 1230,
    gfb: 12348,
    eck1: 17799,
    eck2: 69879,
    kgMonat: 259
  },
  t1: {
    pausch: 1430,
    gfb: 12900,
    eck1: 17800,
    eck2: 70600,
    kgMonat: 272
  },
};

const KFB_PRO_KIND_T0 = 9756; // Kinderfreibetrag + BEA, Ehepaar, 2026

// BVerfG-Vorgabe (Existenzminimum des Kindes): KFB kann bei einer KG-Erhöhung
// nicht konstant bleiben. Konservative Kopplung:
// KFB steigt um 85% der relativen Kindergeld-Anpassung (259 € -> 272 €, d.h. +5,02% * 0,85).
const KG_REL_ANSTIEG = PARAMS.t1.kgMonat / PARAMS.t0.kgMonat - 1;
const KFB_PRO_KIND_T1 = KFB_PRO_KIND_T0 * (1 + 0.85 * KG_REL_ANSTIEG);

// Grenzsteuersatz an der letzten verdienten Einheit (Ableitung der Tarifformel):
// steigt linear von 14% auf 24%, dann linear von 24% auf 42%, danach konstant 42%.
function marginalRate(zveHalf, gfb, eck1, eck2) {
  if (zveHalf <= gfb) return 0;
  if (zveHalf <= eck1) return 0.14 + 0.1 * ((zveHalf - gfb) / (eck1 - gfb));
  if (zveHalf <= eck2) return 0.24 + 0.18 * ((zveHalf - eck1) / (eck2 - eck1));
  return 0.42;
}

// Einkommensteuer: Splittingtarif für Verheiratete (§32a Abs. 5 EStG, Halbteilung),
// Grundtarif für Singles (voller Betrag, keine Halbteilung).
function incomeTax(zve, gfb, eck1, eck2, verheiratet) {
  return verheiratet ? 2 * calcTarif(zve / 2, gfb, eck1, eck2) : calcTarif(zve, gfb, eck1, eck2);
}

function incomeMarginalRate(zve, gfb, eck1, eck2, verheiratet) {
  return verheiratet ? marginalRate(zve / 2, gfb, eck1, eck2) : marginalRate(zve, gfb, eck1, eck2);
}

// ---------------------------------------------------------------------------
// Sozialversicherung 2026
// (bundeseinheitlich, gilt auch für Sachsen-Anhalt;
// die abweichende AG/AN-Aufteilung bei der Pflegeversicherung betrifft nur
// den Freistaat Sachsen, nicht Sachsen-Anhalt)
// ---------------------------------------------------------------------------
const BBG_KV_PV = 69750;   // Beitragsbemessungsgrenze Kranken-/Pflegeversicherung, 2026
const BBG_RV_ALV = 101400; // Beitragsbemessungsgrenze Renten-/Arbeitslosenversicherung, 2026
const SATZ_RV = 0.093;     // Arbeitnehmeranteil Rentenversicherung (18,6% / 2)
const SATZ_ALV = 0.013;    // Arbeitnehmeranteil Arbeitslosenversicherung (2,6% / 2)
const SATZ_KV = 0.0875;    // Arbeitnehmeranteil Krankenversicherung: 7,3% + halber Zusatzbeitrag (Ø 2,9% / 2)

// Pflegeversicherung: Arbeitnehmeranteil nach Kinderzahl, 2026 (Basis 1,8%,
// Kinderlosenzuschlag +0,6, ab 2. Kind -0,25 je Kind bis max. -1,0 bei 5+)
function pvSatzAN(kids) {
  if (kids <= 0) return 0.024;
  if (kids === 1) return 0.018;
  const abschlag = Math.min(kids - 1, 4) * 0.0025;
  return 0.018 - abschlag;
}

// Sozialversicherungsbeiträge einer Person: real, gedeckelt an der jeweils
// eigenen (personenbezogenen!) Beitragsbemessungsgrenze.
function calcSVBeitrag(bruttoPerson, kids) {
  if (bruttoPerson <= 0) return { rv: 0, alv: 0, kv: 0, pv: 0, sa: 0, total: 0 };
  
  const bKV = Math.min(bruttoPerson, BBG_KV_PV);
  const bRV = Math.min(bruttoPerson, BBG_RV_ALV);
  
  const rv = bRV * SATZ_RV;
  const alv = bRV * SATZ_ALV;
  const kv = bKV * SATZ_KV;
  const pv = bKV * pvSatzAN(kids);
  
  // Abzugsfähige Vorsorgeaufwendungen (§10 EStG, Näherung): RV und PV voll
  // abzugsfähig, bei KV pauschal 4% Kürzung für den nicht-Basis-Anteil
  // (Krankengeldanspruch). ALV zählt zu den "sonstigen Vorsorgeaufwendungen",
  // deren separater Höchstbetrag in der Praxis durch KV/PV meist bereits
  // ausgeschöpft ist – daher hier ohne zusätzlichen Steuereffekt angesetzt.
  const sa = rv + kv * 0.96 + pv;
  
  return { rv, alv, kv, pv, sa, total: rv + alv + kv + pv };
}

function calculateNetRelief(brutto1, brutto2, km1, km2, kids, familienstand) {
  const verheiratet = familienstand === "verheiratet";
  const bruttoGesamt = brutto1 + (verheiratet ? brutto2 : 0);
  
  const realWk1 = calcPendlerkosten(km1);
  const realWk2 = verheiratet ? calcPendlerkosten(km2) : 0;
  
  const wkT0 = Math.max(PARAMS.t0.pausch, realWk1) + (verheiratet ? Math.max(PARAMS.t0.pausch, realWk2) : 0);
  const wkT1 = Math.max(PARAMS.t1.pausch, realWk1) + (verheiratet ? Math.max(PARAMS.t1.pausch, realWk2) : 0);
  
  const sv1 = calcSVBeitrag(brutto1, kids);
  const sv2 = verheiratet ? calcSVBeitrag(brutto2, kids) : { rv: 0, alv: 0, kv: 0, pv: 0, sa: 0, total: 0 };
  
  // SV-Beiträge sind nicht Teil der Steuerreform und daher für t0 und t1 gleich.
  const sa = sv1.sa + sv2.sa;
  
  const zveT0 = Math.max(0, bruttoGesamt - wkT0 - sa);
  const zveT1 = Math.max(0, bruttoGesamt - wkT1 - sa);
  
  // Kinderfreibetrag: volle Höhe (inkl. BEA) nur bei Zusammenveranlagung;
  // Alleinstehende erhalten grundsätzlich nur den hälftigen Freibetrag.
  const kfbT0 = (verheiratet ? KFB_PRO_KIND_T0 : KFB_PRO_KIND_T0 / 2) * kids;
  const kfbT1 = (verheiratet ? KFB_PRO_KIND_T1 : KFB_PRO_KIND_T1 / 2) * kids;
  
  const kgT0 = PARAMS.t0.kgMonat * 12 * kids;
  const kgT1 = PARAMS.t1.kgMonat * 12 * kids;
  
  const estT0 = incomeTax(zveT0, PARAMS.t0.gfb, PARAMS.t0.eck1, PARAMS.t0.eck2, verheiratet);
  const estT1 = incomeTax(zveT1, PARAMS.t1.gfb, PARAMS.t1.eck1, PARAMS.t1.eck2, verheiratet);
  
  const estKfbT0 = incomeTax(Math.max(0, zveT0 - kfbT0), PARAMS.t0.gfb, PARAMS.t0.eck1, PARAMS.t0.eck2, verheiratet);
  const estKfbT1 = incomeTax(Math.max(0, zveT1 - kfbT1), PARAMS.t1.gfb, PARAMS.t1.eck1, PARAMS.t1.eck2, verheiratet);
  
  // Günstigerprüfung:
  // Bei Singles wird der halbe KFB mit dem halben Kindergeld verglichen.
  // Bei Verheirateten der volle KFB mit dem vollen Kindergeld.
  const kgOffsetT0 = (verheiratet ? 1 : 0.5) * kgT0;
  const kgOffsetT1 = (verheiratet ? 1 : 0.5) * kgT1;
  
  const guenstigerT0 = (estT0 - estKfbT0) > kgOffsetT0 ? "Kinderfreibetrag" : "Kindergeld";
  const guenstigerT1 = (estT1 - estKfbT1) > kgOffsetT1 ? "Kinderfreibetrag" : "Kindergeld";
  
  // Der finanzielle Vorteil durch Kinder:
  // Wenn der KFB günstiger ist, profitiert man von der Steuerersparnis PLUS dem nicht-angerechneten Kindergeldteil.
  // Wenn Kindergeld günstiger ist, profitiert man vom vollen Kindergeld.
  const vorteilT0 = guenstigerT0 === "Kinderfreibetrag" ? (estT0 - estKfbT0) + (kgT0 - kgOffsetT0) : kgT0;
  const vorteilT1 = guenstigerT1 === "Kinderfreibetrag" ? (estT1 - estKfbT1) + (kgT1 - kgOffsetT1) : kgT1;
  
  // Netto-Steuerlast darf negativ werden: das bildet den Fall ab, in dem das
  // Kindergeld die tarifliche Steuer übersteigt und der Staat per saldo an die
  // Familie auszahlt. Kein künstlicher Floor mehr nötig – die Differenz ist
  // automatisch korrekt, auch im Übergang zwischen Nullsteuerzone und
  // Günstigerprüfungs-Knick.
  const effT0 = estT0 - vorteilT0;
  const effT1 = estT1 - vorteilT1;
  const entlastung = effT0 - effT1;
  
  // Real vom Lohn abgezogene / veranlagte Steuer: Kindergeld ist eine separate
  // Auszahlung und mindert nie die tarifliche Steuer selbst. Der Kinderfreibetrag
  // mindert sie nur, wenn die Günstigerprüfung tatsächlich zugunsten des KFB
  // ausfällt – andernfalls bleibt es bei der vollen tariflichen Steuer auf das
  // zvE ohne KFB-Abzug (Regelfall: Familienleistungsausgleich läuft über KG).
  const realTaxT0 = guenstigerT0 === "Kinderfreibetrag" ? estKfbT0 : estT0;
  const realTaxT1 = guenstigerT1 === "Kinderfreibetrag" ? estKfbT1 : estT1;
  
  const avgT0 = zveT0 > 0 ? (realTaxT0 / zveT0) * 100 : 0;
  const avgT1 = zveT1 > 0 ? (realTaxT1 / zveT1) * 100 : 0;
  
  const grenzT0 = incomeMarginalRate(zveT0, PARAMS.t0.gfb, PARAMS.t0.eck1, PARAMS.t0.eck2, verheiratet) * 100;
  const grenzT1 = incomeMarginalRate(zveT1, PARAMS.t1.gfb, PARAMS.t1.eck1, PARAMS.t1.eck2, verheiratet) * 100;
  
  return {
    entlastung,
    effT0,
    effT1,
    estT0,
    estT1,
    realTaxT0,
    realTaxT1,
    zveT0,
    zveT1,
    bruttoGesamt,
    wkT0,
    wkT1,
    vorteilT0,
    vorteilT1,
    kgT0,
    kgT1,
    sa,
    sv1,
    sv2,
    avgT0,
    avgT1,
    grenzT0,
    grenzT1,
    guenstigerT0,
    guenstigerT1,
  };
}

const eur0 = (v) =>
  v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const axisEuro = (v) => `${v.toLocaleString("de-DE")}€`;

const REF_PROFILES = [
  { key: "stadt", label: "Städter (≤10 km / ≤10 km)", km1: 5, km2: 5, color: "var(--c-stadt)" },
  { key: "vorstadt", label: "Vorstadt (30 km / ≤10 km)", km1: 30, km2: 5, color: "var(--c-vorstadt)" },
  { key: "land", label: "Land (25 km / 25 km)", km1: 25, km2: 25, color: "var(--c-land)" },
];
const REF_KIDS = 2;

export default function SteuerreformRechner() {
  const [familienstand, setFamilienstand] = useState("verheiratet");
  const [brutto1, setBrutto1] = useState(34000);
  const [brutto2, setBrutto2] = useState(18000);
  const [km1, setKm1] = useState(20);
  const [km2, setKm2] = useState(8);
  const [kids, setKids] = useState(2);

  // ResponsiveContainer misst seine Breite beim allerersten Rendern in
  // Grid-Layouts manchmal falsch (0px) und zeichnet die Linien erst nach
  // einem echten Resize-Event neu – z.B. auswertbar durch das Ziehen eines
  // Reglers. Ein einmaliges, kurz verzögertes Resize-Event nach dem Mount
  // erzwingt die korrekte Neuvermessung, ohne dass man interagieren muss.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
    return () => clearTimeout(t);
  }, []);

  const verheiratet = familienstand === "verheiratet";
  const bruttoAktuell = brutto1 + (verheiratet ? brutto2 : 0);
  const splitRatio = bruttoAktuell > 0 ? brutto1 / bruttoAktuell : 1;

  const chartData = useMemo(() => {
    const points = [];
    const step = 2000;
    for (let b = 0; b <= 200000; b += step) {
      const row = { brutto: b };
      REF_PROFILES.forEach((p) => {
        row[p.key] = Math.round(
          calculateNetRelief(b * 0.5, b * 0.5, p.km1, p.km2, REF_KIDS, "verheiratet").entlastung
        );
      });
      const e1 = b * splitRatio;
      const e2 = b - e1;
      const eigen = calculateNetRelief(e1, e2, km1, km2, kids, familienstand);
      row.eigen = Math.round(eigen.entlastung);
      row.effT0 = Math.round(eigen.effT0);
      row.effT1 = Math.round(eigen.effT1);
      row.effGap = [Math.min(row.effT0, row.effT1), Math.max(row.effT0, row.effT1)];
      row.estT0 = Math.round(eigen.estT0);
      row.estT1 = Math.round(eigen.estT1);
      row.avgT0 = Number(eigen.avgT0.toFixed(1));
      row.avgT1 = Number(eigen.avgT1.toFixed(1));
      row.guenstigerT0 = eigen.guenstigerT0;
      row.guenstigerT1 = eigen.guenstigerT1;
      const relPct = eigen.effT0 > 0 ? ((eigen.effT0 - eigen.effT1) / eigen.effT0) * 100 : null;
      row.eigenPct = relPct !== null && relPct <= 150 ? Number(relPct.toFixed(1)) : null;
      points.push(row);
    }
    return points;
  }, [km1, km2, kids, splitRatio, familienstand]);

  // Letzter Bruttowert, an dem die Netto-Transferbilanz noch negativ ist –
  // d.h. das Kindergeld übersteigt die tarifliche Steuer noch vollständig.
  // Bestimmt die Breite des "Kindergeld"-Blocks in Grafik 2.
  const kgGrenzeT0 = chartData.find((p) => p.effT0 >= 0)?.brutto ?? 200000;
  const kgGrenzeT1 = chartData.find((p) => p.effT1 >= 0)?.brutto ?? 200000;

  const current = useMemo(
    () => calculateNetRelief(brutto1, verheiratet ? brutto2 : 0, km1, km2, kids, familienstand),
    [brutto1, brutto2, km1, km2, kids, familienstand, verheiratet]
  );

                    return (
                    <div className="sr-root">
                        <style>
                            {
                                ` @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

                                .sr-root {
                                    --paper: #ffffff;
                                    --panel: #f2f8fa;
                                    --ink: #2d3c4b;
                                    --ink-soft: #737986;
                                    --line: #ddeef1;
                                    --steel: #2d3c4b;
                                    --steel-soft: #737986;
                                    --gold: #52b7c1;
                                    --gold-soft: #a7d5dc;
                                    --brick: #ffa600;
                                    --c-stadt: #737986;
                                    --c-vorstadt: #ffa600;
                                    --c-land: #2d3c4b;
                                    font-family: 'IBM Plex Sans', sans-serif;
                                    background: var(--paper);
                                    color: var(--ink);
                                    padding: 28px;
                                    border-radius: 4px;
                                    max-width: 1180px;
                                    margin: 0 auto;
                                    box-sizing: border-box;
                                }

                                .sr-root * {
                                    box-sizing: border-box;
                                }

                                .sr-mono {
                                    font-family: 'IBM Plex Mono', monospace;
                                }

                                .sr-display {
                                    font-family: 'Fraunces', serif;
                                }

                                .sr-header {
                                    display: flex;
                                    justify-content: space-between;
                                    align-items: flex-end;
                                    border-bottom: 1.5px solid var(--ink);
                                    padding-bottom: 14px;
                                    margin-bottom: 22px;
                                    gap: 16px;
                                    flex-wrap: wrap;
                                }

                                .sr-eyebrow {
                                    font-family: 'IBM Plex Mono', monospace;
                                    font-size: 11px;
                                    letter-spacing: 0.12em;
                                    text-transform: uppercase;
                                    color: var(--steel);
                                    margin: 0 0 6px 0;
                                }

                                .sr-title {
                                    font-size: 26px;
                                    font-weight: 500;
                                    margin: 0;
                                    line-height: 1.15;
                                }

                                .sr-subtitle {
                                    font-size: 12.5px;
                                    color: var(--ink-soft);
                                    max-width: 360px;
                                    text-align: right;
                                    line-height: 1.5;
                                }

                                .sr-grid {
                                    display: grid;
                                    grid-template-columns: 250px minmax(0, 1fr);
                                    gap: 22px;
                                }

                                @media (max-width: 760px) {
                                    .sr-grid {
                                        grid-template-columns: 1fr;
                                    }
                                }

                                .sr-panel {
                                    background: var(--panel);
                                    border: 1px solid var(--line);
                                    border-radius: 3px;
                                    padding: 18px;
                                }

                                .sr-panel-title {
                                    font-family: 'IBM Plex Mono', monospace;
                                    font-size: 10.5px;
                                    letter-spacing: 0.1em;
                                    text-transform: uppercase;
                                    color: var(--ink-soft);
                                    margin: 0 0 16px 0;
                                    padding-bottom: 8px;
                                    border-bottom: 1px solid var(--line);
                                }

                                .sr-field {
                                    margin-bottom: 18px;
                                }

                                .sr-field:last-child {
                                    margin-bottom: 0;
                                }

                                .sr-field label {
                                    display: flex;
                                    justify-content: space-between;
                                    font-size: 12.5px;
                                    color: var(--ink);
                                    margin-bottom: 6px;
                                    font-weight: 500;
                                }

                                .sr-field label span.sr-val {
                                    font-family: 'IBM Plex Mono', monospace;
                                    color: var(--steel);
                                    font-weight: 600;
                                }

                                .sr-field input[type="range"] {
                                    width: 100%;
                                    accent-color: var(--steel);
                                    height: 4px;
                                }

                                .sr-kids {
                                    display: flex;
                                    gap: 6px;
                                }

                                .sr-kids button {
                                    flex: 1;
                                    padding: 7px 0;
                                    border: 1px solid var(--line);
                                    background: var(--paper);
                                    font-family: 'IBM Plex Mono', monospace;
                                    font-size: 13px;
                                    cursor: pointer;
                                    border-radius: 2px;
                                    color: var(--ink);
                                }

                                .sr-kids button.active {
                                    background: var(--steel);
                                    color: var(--paper);
                                    border-color: var(--steel);
                                }

                                .sr-readout {
                                    margin-top: 18px;
                                    padding-top: 16px;
                                    border-top: 1px solid var(--line);
                                }

                                .sr-readout-label {
                                    font-family: 'IBM Plex Mono', monospace;
                                    font-size: 10.5px;
                                    letter-spacing: 0.08em;
                                    text-transform: uppercase;
                                    color: var(--ink-soft);
                                }

                                .sr-readout-value {
                                    font-family: 'IBM Plex Mono', monospace;
                                    font-size: 30px;
                                    font-weight: 600;
                                    color: var(--gold);
                                    margin-top: 4px;
                                    letter-spacing: -0.01em;
                                }

                                .sr-readout-sub {
                                    font-size: 11.5px;
                                    color: var(--ink-soft);
                                    margin-top: 4px;
                                }

                                .sr-readout-pct {
                                    font-size: 16px;
                                    font-weight: 500;
                                    color: var(--ink-soft);
                                }

                                .sr-mini-table {
                                    width: 100%;
                                    margin-top: 14px;
                                    border-collapse: collapse;
                                    font-family: 'IBM Plex Mono', monospace;
                                    font-size: 11.5px;
                                }

                                .sr-mini-table th {
                                    text-align: right;
                                    font-weight: 500;
                                    padding: 3px 0 5px 0;
                                    color: var(--ink-soft);
                                    font-size: 10px;
                                    border-bottom: 1px solid var(--line);
                                }

                                .sr-mini-table th:first-child {
                                    text-align: left;
                                }

                                .sr-mini-table td {
                                    text-align: right;
                                    padding: 5px 0;
                                    border-bottom: 1px solid var(--line);
                                    color: var(--ink);
                                }

                                .sr-mini-table tr:last-child td {
                                    border-bottom: none;
                                }

                                .sr-mini-table td:first-child {
                                    text-align: left;
                                    font-family: 'IBM Plex Sans', sans-serif;
                                    color: var(--ink-soft);
                                    font-size: 11px;
                                }

                                .sr-chart-wrap {
                                    background: var(--panel);
                                    border: 1px solid var(--line);
                                    border-radius: 3px;
                                    padding: 16px 16px 6px 6px;
                                    min-width: 0;
                                }

                                .sr-legend {
                                    display: flex;
                                    gap: 16px;
                                    flex-wrap: wrap;
                                    font-size: 11.5px;
                                    padding: 0 10px 12px 10px;
                                    color: var(--ink-soft);
                                }

                                .sr-legend-item {
                                    display: flex;
                                    align-items: center;
                                    gap: 6px;
                                }

                                .sr-legend-swatch {
                                    width: 14px;
                                    height: 3px;
                                    display: inline-block;
                                    border-radius: 1px;
                                }

                                .sr-chart-note {
                                    font-size: 11px;
                                    color: var(--ink-soft);
                                    padding: 8px 10px 2px 10px;
                                    font-style: italic;
                                }

                                .sr-table {
                                    margin-top: 18px;
                                    width: 100%;
                                    border-collapse: collapse;
                                    font-family: 'IBM Plex Mono', monospace;
                                    font-size: 12px;
                                }

                                .sr-table th {
                                    text-align: right;
                                    font-weight: 500;
                                    padding: 6px 8px;
                                    color: var(--ink-soft);
                                    border-bottom: 1px solid var(--ink);
                                    font-family: 'IBM Plex Sans', sans-serif;
                                    font-size: 11px;
                                    text-transform: uppercase;
                                    letter-spacing: 0.06em;
                                }

                                .sr-table th:first-child {
                                    text-align: left;
                                }

                                .sr-table td {
                                    text-align: right;
                                    padding: 7px 8px;
                                    border-bottom: 1px solid var(--line);
                                }

                                .sr-table td:first-child {
                                    text-align: left;
                                    font-family: 'IBM Plex Sans', sans-serif;
                                    color: var(--ink);
                                }

                                .sr-table tr.sr-highlight td {
                                    color: var(--gold);
                                    font-weight: 600;
                                }

                                .sr-foot {
                                    margin-top: 20px;
                                    padding-top: 14px;
                                    border-top: 1px solid var(--line);
                                    font-size: 11px;
                                    color: var(--ink-soft);
                                    line-height: 1.6;
                                }

                                .sr-foot b {
                                    color: var(--ink);
                                    font-weight: 600;
                                }

                                .sr-foot-title {
                                    font-family: 'IBM Plex Mono', monospace;
                                    font-size: 10.5px;
                                    letter-spacing: 0.08em;
                                    text-transform: uppercase;
                                    color: var(--ink-soft);
                                    margin: 0 0 10px 0;
                                }

                                .sr-foot-list {
                                    margin: 0 0 12px 0;
                                    padding-left: 18px;
                                }

                                .sr-foot-list li {
                                    margin-bottom: 6px;
                                }

                                .sr-foot-list li:last-child {
                                    margin-bottom: 0;
                                }

                                .sr-foot-disclaimer {
                                    margin: 0;
                                    font-style: italic;
                                }

                                `
                            }
                        </style>

                        <div className="sr-header">
                            <div>
                                <p className="sr-eyebrow">Entlastungsrechner · §32a EStG, Grund-/Splittingtarif</p>
                                <h1 className="sr-title sr-display">Steuerreform 2027/28 gegen geltendes Recht 2026</h1>
                            </div>
                            <p className="sr-subtitle">
                                Modell mit korrigierter Entfernungspauschale (0,38&nbsp;€/km einheitlich seit 2026) und
                                den Eckwerten der Koalitionseinigung vom 2.7.2026, volle Wirkung ab 2028.
                            </p>
                        </div>

                        <div className="sr-grid">
                            <div className="sr-panel">
                                <p className="sr-panel-title">Eigene Eingaben</p>

                                <div className="sr-field">
                                    <label>Familienstand</label>
                                    <div className="sr-kids">
                                        <button className={verheiratet ? "active" : "" } onClick={()=>
                                            setFamilienstand("verheiratet")}>Verheiratet</button>
                                        <button className={!verheiratet ? "active" : "" } onClick={()=>
                                            setFamilienstand("single")}>Single</button>
                                    </div>
                                </div>

                                <div className="sr-field">
                                    <label>Brutto Partner 1 <span className="sr-val">{eur0(brutto1)}</span></label>
                                    <input type="range" min="0" max="150000" step="500" value={brutto1} onChange={(e)=>
                                    setBrutto1(Number(e.target.value))}
                                    />
                                </div>

                                {verheiratet && (
                                <div className="sr-field">
                                    <label>Brutto Partner 2 <span className="sr-val">{eur0(brutto2)}</span></label>
                                    <input type="range" min="0" max="150000" step="500" value={brutto2} onChange={(e)=>
                                    setBrutto2(Number(e.target.value))}
                                    />
                                </div>
                                )}

                                <div className="sr-field">
                                    <label>Pendelstrecke {verheiratet ? "Partner 1" : ""} <span className="sr-val">{km1}
                                            km</span></label>
                                    <input type="range" min="0" max="60" step="1" value={km1} onChange={(e)=>
                                    setKm1(Number(e.target.value))}
                                    />
                                </div>

                                {verheiratet && (
                                <div className="sr-field">
                                    <label>Pendelstrecke Partner 2 <span className="sr-val">{km2} km</span></label>
                                    <input type="range" min="0" max="60" step="1" value={km2} onChange={(e)=>
                                    setKm2(Number(e.target.value))}
                                    />
                                </div>
                                )}

                                <div className="sr-field">
                                    <label>Kinder</label>
                                    <div className="sr-kids">
                                        {[0, 1, 2, 3, 4].map((n) => (
                                        <button key={n} className={n===kids ? "active" : "" } onClick={()=> setKids(n)}
                                            >
                                            {n}
                                        </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="sr-readout">
                                    <div className="sr-readout-label">Entlastung pro Jahr</div>
                                    <div className="sr-readout-value">
                                        {eur0(current.entlastung)}
                                        {current.effT0 > 0 && (current.entlastung / current.effT0) * 100 <= 150 && (
                                            <span className="sr-readout-pct"> ({((current.entlastung / current.effT0) *
                                            100).toFixed(1)}%)</span>
                                            )}
                                    </div>
                                    <div className="sr-readout-sub">
                                        Haushaltsbrutto {eur0(current.bruttoGesamt)} · Günstiger 2026:
                                        {current.guenstigerT0} · Günstiger 2028: {current.guenstigerT1}
                                    </div>

                                    <table className="sr-mini-table">
                                        <thead>
                                            <tr>
                                                <th></th>
                                                <th>2026</th>
                                                <th>2028</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td>SV-Beiträge (AN, unverändert)</td>
                                                <td>{eur0(current.sa)}</td>
                                                <td>{eur0(current.sa)}</td>
                                            </tr>
                                            <tr>
                                                <td>Netto-Transferbilanz</td>
                                                <td>{eur0(current.effT0)}</td>
                                                <td>{eur0(current.effT1)}</td>
                                            </tr>
                                            <tr>
                                                <td>Ø-Steuersatz</td>
                                                <td>{current.avgT0.toFixed(1)}%</td>
                                                <td>{current.avgT1.toFixed(1)}%</td>
                                            </tr>
                                            <tr>
                                                <td>Grenzsteuersatz</td>
                                                <td>{current.grenzT0.toFixed(1)}%</td>
                                                <td>{current.grenzT1.toFixed(1)}%</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <div className="sr-chart-wrap">
                                    <div className="sr-legend">
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--c-stadt)" }} /> Städter (Referenz, 2 Kinder)</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--c-vorstadt)" }} /> Vorstadt (Referenz, 2
                                            Kinder)</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--c-land)" }} /> Land (Referenz, 2 Kinder)</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--gold)" , height: "3px" }} /> Eigene Berechnung,
                                            absolut € ({kids} Kind{kids === 1 ? "" : "er"})</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--brick)" , height: "2px" ,
                                                borderTop: "2px dashed var(--brick)" }} /> Eigene Berechnung, relativ %
                                            (rechte Achse)</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--gold)" , opacity: 0.3, height: "10px" , borderRadius:
                                                0 }} /> Kindergeld-Erhöhung ({eur0(Math.max(0, current.kgT1 -
                                            current.kgT0))}, unabhängig vom Einkommen)</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height={360}>
                                        <LineChart data={chartData} margin={{ top: 6, right: 18, bottom: 6, left: 0 }}>
                                            <CartesianGrid stroke="var(--line)" strokeDasharray="2 3" />
                                            <XAxis dataKey="brutto" tickFormatter={(v)=> `${v / 1000}k`}
                                                stroke="var(--ink-soft)"
                                                tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }}
                                                label={{ value: "Haushaltsbrutto (€)", position: "insideBottom", offset:
                                                -4, fontSize: 11, fill: "var(--ink-soft)" }}
                                                />
                                                <YAxis yAxisId="left" stroke="var(--ink-soft)" tick={{
                                                    fontFamily: "IBM Plex Mono" , fontSize: 11 }}
                                                    tickFormatter={axisEuro} width={56} />
                                                <YAxis yAxisId="right" orientation="right" stroke="var(--brick)" tick={{
                                                    fontFamily: "IBM Plex Mono" , fontSize: 11 }} tickFormatter={(v)=>
                                                    `${v}%`}
                                                    width={44}
                                                    domain={[0, 100]}
                                                    />
                                                    <Tooltip labelFormatter={(v)=> eur0(v)}
                                                        contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12,
                                                        border: "1px solid var(--line)" }}
                                                        formatter={(v, name) => [name === "Eigene Berechnung, relativ %"
                                                        ? `${v}%` : eur0(v), name]}
                                                        filterNull={false}
                                                        itemSorter={() => 0}
                                                        content={({ active, payload, label }) => {
                                                        if (!active || !payload) return null;
                                                        const rows = payload.filter((p) => p.dataKey === "eigen" ||
                                                        p.dataKey === "eigenPct");
                                                        if (rows.length === 0) return null;
                                                        return (
                                                        <div style={{ fontFamily: "IBM Plex Mono" , fontSize: 12,
                                                            border: "1px solid var(--line)" , background: "var(--paper)"
                                                            , padding: "8px 10px" }}>
                                                            <div style={{ marginBottom: 4 }}>{eur0(label)}</div>
                                                            {rows.map((r) => (
                                                            <div key={r.dataKey} style={{ color: r.color }}>
                                                                {r.dataKey === "eigenPct" ? "Eigene Berechnung, relativ"
                                                                : "Eigene Berechnung, absolut"}: {r.dataKey ===
                                                                "eigenPct" ? `${r.value}%` : eur0(r.value)}
                                                            </div>
                                                            ))}
                                                        </div>
                                                        );
                                                        }}
                                                        />
                                                        <ReferenceLine yAxisId="left" x={bruttoAktuell}
                                                            stroke="var(--brick)" strokeDasharray="3 3"
                                                            strokeWidth={1} />
                                                        <ReferenceArea yAxisId="left" y1={0} y2={Math.max(0,
                                                            current.kgT1 - current.kgT0)} fill="var(--gold)"
                                                            fillOpacity={0.12} stroke="var(--gold)" strokeOpacity={0.4}
                                                            strokeDasharray="2 2" ifOverflow="extendDomain" />
                                                        <Line yAxisId="left" type="monotone" dataKey="stadt"
                                                            name="Städter (Referenz)" stroke="var(--c-stadt)"
                                                            strokeWidth={1.5} dot={false} strokeDasharray="4 3"
                                                            isAnimationActive={false} />
                                                        <Line yAxisId="left" type="monotone" dataKey="vorstadt"
                                                            name="Vorstadt (Referenz)" stroke="var(--c-vorstadt)"
                                                            strokeWidth={1.5} dot={false} strokeDasharray="4 3"
                                                            isAnimationActive={false} />
                                                        <Line yAxisId="left" type="monotone" dataKey="land"
                                                            name="Land (Referenz)" stroke="var(--c-land)"
                                                            strokeWidth={1.5} dot={false} strokeDasharray="4 3"
                                                            isAnimationActive={false} />
                                                        <Line yAxisId="left" type="monotone" dataKey="eigen"
                                                            name="Eigene Berechnung, absolut" stroke="var(--gold)"
                                                            strokeWidth={2.5} dot={false} isAnimationActive={false} />
                                                        <Line yAxisId="right" type="monotone" dataKey="eigenPct"
                                                            name="Eigene Berechnung, relativ" stroke="var(--brick)"
                                                            strokeWidth={1.75} dot={false} strokeDasharray="2 2"
                                                            connectNulls={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="sr-chart-wrap" style={{ marginTop: 18 }}>
                                    <div className="sr-legend">
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--steel)" }} /> Netto-Transferbilanz 2026 (Steuer ./.
                                            Kindergeld/KFB)</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--gold)" }} /> Netto-Transferbilanz 2028</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--brick)" , height: "2px" ,
                                                borderTop: "2px dashed var(--brick)" }} /> Ø-Steuersatz auf real
                                            gezahlte Steuer (rechte Achse)</span>
                                        <span className="sr-legend-item" style={{ color: "var(--ink-soft)" }}>Eigenes
                                            Profil: {km1}{verheiratet ? ` km / ${km2} km` : " km"}, {kids} Kind{kids ===
                                            1 ? "" : "er"} · negativer Bereich = Kindergeld übersteigt die Steuer</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height={320}>
                                        <LineChart data={chartData} margin={{ top: 6, right: 18, bottom: 6, left: 0 }}>
                                            <CartesianGrid stroke="var(--line)" strokeDasharray="2 3" />
                                            <XAxis dataKey="brutto" tickFormatter={(v)=> `${v / 1000}k`}
                                                stroke="var(--ink-soft)"
                                                tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }}
                                                label={{ value: "Haushaltsbrutto (€)", position: "insideBottom", offset:
                                                -4, fontSize: 11, fill: "var(--ink-soft)" }}
                                                />
                                                <YAxis yAxisId="left" stroke="var(--ink-soft)" tick={{
                                                    fontFamily: "IBM Plex Mono" , fontSize: 11 }}
                                                    tickFormatter={axisEuro} width={56} domain={[-14000, 52000]}
                                                    ticks={[-14000, 0, 13000, 26000, 39000, 52000]} />
                                                <YAxis yAxisId="right" orientation="right" stroke="var(--brick)" tick={{
                                                    fontFamily: "IBM Plex Mono" , fontSize: 11 }} tickFormatter={(v)=>
                                                    `${v}%`}
                                                    width={44}
                                                    domain={[0, 30]}
                                                    ticks={[0, 7.5, 15, 22.5, 30]}
                                                    />
                                                    <Tooltip labelFormatter={(v)=> eur0(v)}
                                                        formatter={(v, name) => [name && name.startsWith("Ø-Steuersatz")
                                                        ? `${v}%` : eur0(v), name]}
                                                        contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12,
                                                        border: "1px solid var(--line)" }}
                                                        />
                                                        <ReferenceLine yAxisId="left" x={bruttoAktuell}
                                                            stroke="var(--brick)" strokeDasharray="3 3"
                                                            strokeWidth={1} />
                                                        <ReferenceLine yAxisId="left" y={0} stroke="var(--ink)"
                                                            strokeWidth={1} />
                                                        <ReferenceArea yAxisId="left" x1={0} x2={kgGrenzeT0} y1={-14000}
                                                            y2={0} fill="var(--steel)" fillOpacity={0.12} stroke="none"
                                                            ifOverflow="extendDomain">
                                                            <Label value="Kindergeld 2026" position="insideBottomLeft"
                                                                fill="var(--steel)" fontFamily="IBM Plex Mono"
                                                                fontSize={10} />
                                                        </ReferenceArea>
                                                        <ReferenceArea yAxisId="left" x1={0} x2={kgGrenzeT1} y1={-14000}
                                                            y2={0} fill="var(--gold)" fillOpacity={0.12} stroke="none"
                                                            ifOverflow="extendDomain">
                                                            <Label value="Kindergeld 2028" position="insideTopLeft"
                                                                fill="var(--gold)" fontFamily="IBM Plex Mono"
                                                                fontSize={10} />
                                                        </ReferenceArea>
                                                        <Line yAxisId="left" type="monotone" dataKey="effT0"
                                                            name="Netto-Transferbilanz 2026" stroke="var(--steel)"
                                                            strokeWidth={2} dot={false} isAnimationActive={false} />
                                                        <Line yAxisId="left" type="monotone" dataKey="effT1"
                                                            name="Netto-Transferbilanz 2028" stroke="var(--gold)"
                                                            strokeWidth={2} dot={false} isAnimationActive={false} />
                                                        <Line yAxisId="right" type="monotone" dataKey="avgT0"
                                                            name="Ø-Steuersatz 2026" stroke="var(--steel)"
                                                            strokeWidth={1.5} dot={false} strokeDasharray="2 2"
                                                            isAnimationActive={false} />
                                                        <Line yAxisId="right" type="monotone" dataKey="avgT1"
                                                            name="Ø-Steuersatz 2028" stroke="var(--gold)"
                                                            strokeWidth={1.5} dot={false} strokeDasharray="2 2"
                                                            isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                    <div className="sr-chart-note">
                                        Unterhalb der Nulllinie übersteigt das Kindergeld die tarifliche Steuer – die
                                        Familie erhält per saldo mehr, als sie zahlt (markiert als „Kindergeld"-Bereich,
                                        keine negative Steuer). Der Ø-Steuersatz (rechte Achse) bezieht sich weiterhin
                                        auf die real gezahlte bzw. veranlagte Steuer, nicht auf diese Transferbilanz.
                                    </div>
                                </div>

                                <table className="sr-table">
                                    <thead>
                                        <tr>
                                            <th></th>
                                            <th>2026 · geltendes Recht</th>
                                            <th>2028 · nach Reform</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td>Werbungskosten</td>
                                            <td>{eur0(current.wkT0)}</td>
                                            <td>{eur0(current.wkT1)}</td>
                                        </tr>
                                        <tr>
                                            <td>Sozialversicherung (AN, abzugsfähig, unverändert)</td>
                                            <td>{eur0(current.sa)}</td>
                                            <td>{eur0(current.sa)}</td>
                                        </tr>
                                        <tr>
                                            <td>zu versteuerndes Einkommen</td>
                                            <td>{eur0(current.zveT0)}</td>
                                            <td>{eur0(current.zveT1)}</td>
                                        </tr>
                                        <tr>
                                            <td>Einkommensteuer (Tarif)</td>
                                            <td>{eur0(current.estT0)}</td>
                                            <td>{eur0(current.estT1)}</td>
                                        </tr>
                                        <tr>
                                            <td>Kindergeld / KFB-Vorteil</td>
                                            <td>{eur0(current.vorteilT0)}</td>
                                            <td>{eur0(current.vorteilT1)}</td>
                                        </tr>
                                        <tr>
                                            <td>Netto-Transferbilanz (Steuer ./. Kindergeld/KFB)</td>
                                            <td>{eur0(current.effT0)}</td>
                                            <td>{eur0(current.effT1)}</td>
                                        </tr>
                                        <tr className="sr-highlight">
                                            <td>Entlastung ./. Jahr</td>
                                            <td colSpan={2}>{eur0(current.entlastung)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="sr-foot">
                            <p className="sr-foot-title">Steuerliche Vereinfachungen in diesem Modell</p>
                            <ul className="sr-foot-list">
                                <li><b>Steuertarif:</b> genäherte Formel für den Einkommensteuertarif; Splittingtarif
                                    bei „Verheiratet", Grundtarif bei „Single". Kein Spitzensteuersatz von 45&nbsp;% für
                                    sehr hohe Einkommen ab 250.000&nbsp;€.</li>
                                <li><b>Fahrtkosten:</b> einheitlich 0,38&nbsp;€ pro Kilometer und Arbeitstag (220
                                    Tage/Jahr), wie seit 2026 gesetzlich vorgesehen.</li>
                                <li><b>Kinderfreibetrag 2028:</b> noch nicht gesetzlich festgelegt. Angenommen wird eine
                                    vorsichtige Anhebung um 85&nbsp;% der Kindergeld-Erhöhung. Bei „Single" nur der
                                    hälftige Freibetrag, wie gesetzlich vorgesehen.</li>
                                <li><b>Sozialversicherung:</b> reale Beiträge zu Renten-, Arbeitslosen-, Kranken- und
                                    Pflegeversicherung, getrennt für jede Person und jeweils bis zur eigenen
                                    Beitragsbemessungsgrenze gedeckelt (69.750&nbsp;€ KV/PV, 101.400&nbsp;€ RV/ALV,
                                    2026). Der Pflegeversicherungsbeitrag berücksichtigt die Kinderzahl. Als
                                    Sonderausgaben angesetzt: Renten- und Pflegebeitrag voll,
                                    Krankenversicherungsbeitrag zu 96&nbsp;%.</li>
                            </ul>
                            <p className="sr-foot-disclaimer">Alle Werte sind eine Modellrechnung zur groben Einordnung,
                                keine Steuerberatung.</p>
                        </div>
                    </div>
                    );
                    }