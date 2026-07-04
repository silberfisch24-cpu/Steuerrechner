import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
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

// t0 = geltendes Recht 2026, t2027 = Reformstufe 2027, t1 = Reformstufe 2028 (Koalitionseinigung)
const PARAMS = {
  t0: {
    pausch: 1230,
    gfb: 12348,
    eck1: 17799,
    eck2: 69879,
    kgMonat: 259,
    kfbProKind: 9756
  },
  t2027: {
    pausch: 1330,
    gfb: 12624,
    eck1: 17800,
    eck2: 70240,
    kgMonat: 265,
    kfbProKind: 10056 // 9756 + 300 €
  },
  t1: {
    pausch: 1430,
    gfb: 12900,
    eck1: 17800,
    eck2: 70600,
    kgMonat: 272,
    kfbProKind: 10236 // 9756 + 480 €
  },
};

// eslint-disable-next-line no-unused-vars
const KFB_PRO_KIND_T0 = PARAMS.t0.kfbProKind;
// eslint-disable-next-line no-unused-vars
const KFB_PRO_KIND_T1 = PARAMS.t1.kfbProKind;


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
const BBG_KV_PV_2026 = 69750;   // Beitragsbemessungsgrenze Kranken-/Pflegeversicherung, 2026
const BBG_RV_ALV_2026 = 101400; // Beitragsbemessungsgrenze Renten-/Arbeitslosenversicherung, 2026
const BBG_KV_PV_2027 = 76800;   // Beitragsbemessungsgrenze Kranken-/Pflegeversicherung, 2027 (Prognose ca. 76.500 - 77.100 €)
const BBG_RV_ALV_2027 = 104400; // Beitragsbemessungsgrenze Renten-/Arbeitslosenversicherung, 2027 (Prognose ca. 104.400 €)
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
function calcSVBeitrag(bruttoPerson, kids, use2027Limits = false) {
  if (bruttoPerson <= 0) return { rv: 0, alv: 0, kv: 0, pv: 0, sa: 0, total: 0 };
  
  const bbgKV = use2027Limits ? BBG_KV_PV_2027 : BBG_KV_PV_2026;
  const bbgRV = use2027Limits ? BBG_RV_ALV_2027 : BBG_RV_ALV_2026;
  
  const bKV = Math.min(bruttoPerson, bbgKV);
  const bRV = Math.min(bruttoPerson, bbgRV);
  
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

function calculateNetRelief(brutto1, brutto2, km1, km2, kids, familienstand, adjustSV = false) {
  const verheiratet = familienstand === "verheiratet";
  const bruttoGesamt = brutto1 + (verheiratet ? brutto2 : 0);
  
  const realWk1 = calcPendlerkosten(km1);
  const realWk2 = verheiratet ? calcPendlerkosten(km2) : 0;
  
  // Entlastungsbetrag für Alleinerziehende (§ 24b EStG)
  const entlastungsbetrag = (!verheiratet && kids > 0) ? (4260 + (kids - 1) * 240) : 0;

  function calcYear(key, use2027Limits) {
    const pausch = PARAMS[key].pausch;
    const wk = Math.max(pausch, realWk1) + (verheiratet ? Math.max(pausch, realWk2) : 0);
    
    const sv1 = calcSVBeitrag(brutto1, kids, use2027Limits);
    const sv2 = verheiratet ? calcSVBeitrag(brutto2, kids, use2027Limits) : { rv: 0, alv: 0, kv: 0, pv: 0, sa: 0, total: 0 };
    const sa = sv1.sa + sv2.sa;
    
    const zve = Math.max(0, bruttoGesamt - wk - sa - entlastungsbetrag);
    const kfb = (verheiratet ? PARAMS[key].kfbProKind : PARAMS[key].kfbProKind / 2) * kids;
    const kg = PARAMS[key].kgMonat * 12 * kids;
    
    const est = incomeTax(zve, PARAMS[key].gfb, PARAMS[key].eck1, PARAMS[key].eck2, verheiratet);
    const estKfb = incomeTax(Math.max(0, zve - kfb), PARAMS[key].gfb, PARAMS[key].eck1, PARAMS[key].eck2, verheiratet);
    
    const kgOffset = (verheiratet ? 1 : 0.5) * kg;
    const guenstiger = (est - estKfb) > kgOffset ? "Kinderfreibetrag" : "Kindergeld";
    const vorteil = guenstiger === "Kinderfreibetrag" ? (est - estKfb) + (kg - kgOffset) : kg;
    
    const eff_tax = est - vorteil;
    const svTotal = sv1.total + sv2.total;
    const eff = adjustSV ? (eff_tax + svTotal) : eff_tax;
    const netto = bruttoGesamt - svTotal - eff_tax;
    
    const realTax = guenstiger === "Kinderfreibetrag" ? estKfb : est;
    const avg = zve > 0 ? (realTax / zve) * 100 : 0;
    const grenz = incomeMarginalRate(zve, PARAMS[key].gfb, PARAMS[key].eck1, PARAMS[key].eck2, verheiratet) * 100;
    
    return {
      wk,
      sa,
      zve,
      kfb,
      kg,
      est,
      estKfb,
      guenstiger,
      vorteil,
      eff_tax,
      svTotal,
      eff,
      netto,
      realTax,
      avg,
      grenz
    };
  }

  // T0: 2026 (immer 2026 limits, d.h. false)
  const T0 = calcYear("t0", false);
  // T2027: 2027 (2027 limits wenn adjustSV aktiv, sonst 2026 limits)
  const T2027 = calcYear("t2027", adjustSV);
  // T1: 2028 (2027 limits wenn adjustSV aktiv, sonst 2026 limits)
  const T1 = calcYear("t1", adjustSV);
  
  const entlastung2027 = T0.eff - T2027.eff;
  const entlastung2028 = T0.eff - T1.eff;
  const entlastungGesamt = entlastung2027 + entlastung2028;

  // Alternativ-Berechnung für BMF 2028 (mit KFB = 10.292 € statt 10.236 €)
  const altKfbT1 = (verheiratet ? 10292 : 10292 / 2) * kids;
  const altEstKfbT1 = incomeTax(Math.max(0, T1.zve - altKfbT1), PARAMS.t1.gfb, PARAMS.t1.eck1, PARAMS.t1.eck2, verheiratet);
  const altGuenstigerT1 = (T1.est - altEstKfbT1) > ((verheiratet ? 1 : 0.5) * T1.kg) ? "Kinderfreibetrag" : "Kindergeld";
  const altVorteilT1 = altGuenstigerT1 === "Kinderfreibetrag" ? (T1.est - altEstKfbT1) + (T1.kg - ((verheiratet ? 1 : 0.5) * T1.kg)) : T1.kg;
  const altEffT1_tax = T1.est - altVorteilT1;
  const altEffT1 = adjustSV ? (altEffT1_tax + T1.svTotal) : altEffT1_tax;
  const entlastungBmf2028 = T0.eff - altEffT1;

  return {
    entlastung: entlastung2028, // Für Kompatibilität mit dem Rest der App
    entlastung2027,
    entlastung2028,
    entlastungGesamt,
    entlastungBmf2028,
    
    // T0 (2026)
    effT0: T0.eff,
    estT0: T0.est,
    realTaxT0: T0.realTax,
    zveT0: T0.zve,
    wkT0: T0.wk,
    vorteilT0: T0.vorteil,
    kgT0: T0.kg,
    saT0: T0.sa,
    svTotalT0: T0.svTotal,
    nettoT0: T0.netto,
    avgT0: T0.avg,
    grenzT0: T0.grenz,
    guenstigerT0: T0.guenstiger,
    
    // T2027 (2027)
    effT2027: T2027.eff,
    estT2027: T2027.est,
    realTaxT2027: T2027.realTax,
    zveT2027: T2027.zve,
    wkT2027: T2027.wk,
    vorteilT2027: T2027.vorteil,
    kgT2027: T2027.kg,
    saT2027: T2027.sa,
    svTotalT2027: T2027.svTotal,
    nettoT2027: T2027.netto,
    avgT2027: T2027.avg,
    grenzT2027: T2027.grenz,
    guenstigerT2027: T2027.guenstiger,

    // T1 (2028)
    effT1: T1.eff,
    estT1: T1.est,
    realTaxT1: T1.realTax,
    zveT1: T1.zve,
    wkT1: T1.wk,
    vorteilT1: T1.vorteil,
    kgT1: T1.kg,
    saT1: T1.sa,
    svTotalT1: T1.svTotal,
    nettoT1: T1.netto,
    avgT1: T1.avg,
    grenzT1: T1.grenz,
    guenstigerT1: T1.guenstiger,
    
    bruttoGesamt,
    entlastungsbetrag,
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
  const [adjustSV, setAdjustSV] = useState(false);

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
          calculateNetRelief(b * 0.5, b * 0.5, p.km1, p.km2, REF_KIDS, "verheiratet", adjustSV).entlastung
        );
      });
      const e1 = b * splitRatio;
      const e2 = b - e1;
      const eigen = calculateNetRelief(e1, e2, km1, km2, kids, familienstand, adjustSV);
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
  }, [km1, km2, kids, splitRatio, familienstand, adjustSV]);

  // Letzter Bruttowert, an dem die Netto-Transferbilanz noch negativ ist –
  // d.h. das Kindergeld übersteigt die tarifliche Steuer noch vollständig.
  // Bestimmt die Breite des "Kindergeld"-Blocks in Grafik 2.
  const kgGrenzeT0 = chartData.find((p) => p.effT0 >= 0)?.brutto ?? 200000;
  const kgGrenzeT1 = chartData.find((p) => p.effT1 >= 0)?.brutto ?? 200000;

  const current = useMemo(
    () => calculateNetRelief(brutto1, verheiratet ? brutto2 : 0, km1, km2, kids, familienstand, adjustSV),
    [brutto1, brutto2, km1, km2, kids, familienstand, verheiratet, adjustSV]
  );

                    return (
                    <div className="sr-root">
                        <style>
                            {
                                ` body {
                                     background: #f2f8fa;
                                     margin: 0;
                                     padding: 40px 0;
                                 }

                                 @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;800&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

                                 .sr-root {
                                     --paper: #ffffff;
                                     --panel: #f2f8fa;
                                     --ink: #2d3c4b;
                                     --ink-soft: #737986;
                                     --line: #ddeef1;
                                     --grid-color: #e5e5e9;
                                     
                                     --steel: #2d3c4b;      /* Status Quo 2026 (Rhöndorf-Blau) */
                                     --steel-soft: #737986; /* Status Quo 2026 Füllungen */
                                     --turkis: #52b7c1;     /* Reform 2028 (Cadenabbia-Türkis) */
                                     --turkis-soft: #a7d5dc;/* Reform 2028 Füllungen */
                                     --gold: #ffa600;       /* Eigene Berechnung / Ergebnis (Union-Gold) */
                                     
                                     --c-stadt: #737986;    /* Städter (Rhöndorf-Blau 60%) */
                                     --c-vorstadt: #bec1c7; /* Vorstadt (Rhöndorf-Blau 25% - neutralisiert!) */
                                     --c-land: #2d3c4b;     /* Land (Rhöndorf-Blau) */
                                     font-family: 'IBM Plex Serif', serif;
                                     background: var(--paper);
                                     color: var(--ink);
                                     padding: 28px;
                                     border-radius: 4px;
                                     max-width: 1180px;
                                     margin: 0 auto;
                                     box-sizing: border-box;
                                     box-shadow: 0 10px 30px rgba(45, 60, 75, 0.04);
                                     border: 1px solid var(--line);
                                 }

                                 .sr-root * {
                                     box-sizing: border-box;
                                 }

                                 .sr-mono {
                                     font-family: 'IBM Plex Mono', monospace;
                                 }

                                 .sr-display {
                                     font-family: 'Inter', sans-serif;
                                     font-weight: 800;
                                     letter-spacing: -0.02em;
                                 }

                                 .sr-root b, .sr-root strong {
                                     font-family: 'IBM Plex Serif', serif;
                                     font-weight: 700;
                                     font-style: italic;
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
                                     font-family: 'Inter', sans-serif;
                                     font-size: 26px;
                                     font-weight: 800;
                                     letter-spacing: -0.02em;
                                     margin: 0;
                                     line-height: 1.15;
                                 }

                                 .sr-subtitle {
                                     font-family: 'Inter', sans-serif;
                                     font-weight: 500;
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

                                 .sr-toggle-container {
                                     display: flex;
                                     align-items: center;
                                     gap: 10px;
                                     cursor: pointer;
                                     margin-top: 14px;
                                     user-select: none;
                                 }

                                 .sr-toggle-switch {
                                     width: 38px;
                                     height: 20px;
                                     background-color: var(--line);
                                     border-radius: 10px;
                                     position: relative;
                                     transition: background-color 0.2s ease;
                                     border: 1px solid var(--line);
                                 }

                                 .sr-toggle-switch.active {
                                     background-color: var(--turkis);
                                     border-color: var(--turkis);
                                 }

                                 .sr-toggle-handle {
                                     width: 14px;
                                     height: 14px;
                                     background-color: var(--paper);
                                     border-radius: 50%;
                                     position: absolute;
                                     top: 2px;
                                     left: 2px;
                                     transition: transform 0.2s ease;
                                     box-shadow: 0 1px 3px rgba(45, 60, 75, 0.15);
                                 }

                                 .sr-toggle-switch.active .sr-toggle-handle {
                                     transform: translateX(18px);
                                 }

                                 .sr-toggle-label {
                                     font-size: 12.5px;
                                     color: var(--ink);
                                     font-weight: 500;
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
                                     font-family: 'IBM Plex Serif', serif;
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
                                     font-family: 'IBM Plex Serif', serif;
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

                                 <div className="sr-field">
                                     <div className="sr-toggle-container" onClick={() => setAdjustSV(!adjustSV)}>
                                         <div className={`sr-toggle-switch ${adjustSV ? "active" : ""}`}>
                                             <div className="sr-toggle-handle" />
                                         </div>
                                         <span className="sr-toggle-label">Sozialabgaben 2027 anpassen</span>
                                     </div>
                                 </div>
                                 <div className="sr-readout">
                                     <div className="sr-readout-label">Entlastung 2028</div>
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
                                                  <th>2027</th>
                                                  <th>2028</th>
                                              </tr>
                                          </thead>
                                          <tbody>
                                              <tr>
                                                  <td>Ø-Steuersatz</td>
                                                  <td>{current.avgT0.toFixed(1)}%</td>
                                                  <td>{current.avgT2027.toFixed(1)}%</td>
                                                  <td>{current.avgT1.toFixed(1)}%</td>
                                              </tr>
                                              <tr>
                                                  <td>Grenzsteuersatz</td>
                                                  <td>{current.grenzT0.toFixed(1)}%</td>
                                                  <td>{current.grenzT2027.toFixed(1)}%</td>
                                                  <td>{current.grenzT1.toFixed(1)}%</td>
                                              </tr>
                                              <tr style={{ fontWeight: "bold", borderTop: "2px solid var(--line)" }}>
                                                  <td>Entlastung vs. 2026</td>
                                                  <td>-</td>
                                                  <td>{eur0(current.entlastung2027)}</td>
                                                  <td>{eur0(current.entlastung2028)}</td>
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
                                                background: "var(--turkis)" , height: "2px" ,
                                                borderTop: "2px dashed var(--turkis)" }} /> Eigene Berechnung, relativ %
                                            (rechte Achse)</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--turkis)" , opacity: 0.3, height: "10px" , borderRadius:
                                                0 }} /> Kindergeld-Erhöhung ({eur0(Math.max(0, current.kgT1 -
                                            current.kgT0))}, unabhängig vom Einkommen)</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height={360}>
                                        <LineChart data={chartData} margin={{ top: 6, right: 18, bottom: 6, left: 0 }}>
                                            <CartesianGrid stroke="var(--grid-color)" strokeDasharray="2 3" />
                                            <XAxis dataKey="brutto" tickFormatter={(v)=> `${v / 1000}k`}
                                                stroke="var(--ink-soft)"
                                                tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }}
                                                label={{ value: "Haushaltsbrutto (€)", position: "insideBottom", offset:
                                                -4, fontSize: 11, fill: "var(--ink-soft)" }}
                                                />
                                                <YAxis yAxisId="left" stroke="var(--ink-soft)" tick={{
                                                    fontFamily: "IBM Plex Mono" , fontSize: 11 }}
                                                    tickFormatter={axisEuro} width={56} />
                                                <YAxis yAxisId="right" orientation="right" stroke="var(--ink-soft)" tick={{
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
                                                            stroke="var(--ink-soft)" strokeDasharray="3 3"
                                                            strokeWidth={1} />
                                                        <ReferenceArea yAxisId="left" y1={0} y2={Math.max(0,
                                                            current.kgT1 - current.kgT0)} fill="var(--turkis)"
                                                            fillOpacity={0.12} stroke="var(--turkis)" strokeOpacity={0.4}
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
                                                            name="Eigene Berechnung, relativ" stroke="var(--turkis)"
                                                            strokeWidth={1.75} dot={false} strokeDasharray="2 2"
                                                            connectNulls={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                <div className="sr-chart-wrap" style={{ marginTop: 18 }}>
                                    <div className="sr-legend">
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--steel)" }} /> {adjustSV ? "Netto-Abgabenlast 2026 (Steuer + SV ./. Kindergeld)" : "Netto-Transferbilanz 2026 (Steuer ./. Kindergeld/KFB)"}</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--gold)" }} /> {adjustSV ? "Netto-Abgabenlast 2028" : "Netto-Transferbilanz 2028"}</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--turkis)" , height: "2px" ,
                                                borderTop: "2px dashed var(--turkis)" }} /> Ø-Steuersatz auf real
                                            gezahlte Steuer (rechte Achse)</span>
                                        <span className="sr-legend-item" style={{ color: "var(--ink-soft)" }}>Eigenes
                                            Profil: {km1}{verheiratet ? ` km / ${km2} km` : " km"}, {kids} Kind{kids ===
                                            1 ? "" : "er"} · {adjustSV ? "negativer Bereich = Kindergeld übersteigt Steuer + SV" : "negativer Bereich = Kindergeld übersteigt die Steuer"}</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height={320}>
                                        <LineChart data={chartData} margin={{ top: 6, right: 18, bottom: 6, left: 0 }}>
                                            <CartesianGrid stroke="var(--grid-color)" strokeDasharray="2 3" />
                                            <XAxis dataKey="brutto" tickFormatter={(v)=> `${v / 1000}k`}
                                                stroke="var(--ink-soft)"
                                                tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }}
                                                label={{ value: "Haushaltsbrutto (€)", position: "insideBottom", offset:
                                                -4, fontSize: 11, fill: "var(--ink-soft)" }}
                                                />
                                                <YAxis yAxisId="left" stroke="var(--ink-soft)" tick={{
                                                    fontFamily: "IBM Plex Mono" , fontSize: 11 }}
                                                    tickFormatter={axisEuro} width={56} 
                                                    domain={adjustSV ? [-7000, 80000] : [-7000, 40000]}
                                                    ticks={adjustSV ? [-7000, 0, 20000, 40000, 60000, 80000] : [-7000, 0, 10000, 20000, 30000, 40000]} />
                                                <YAxis yAxisId="right" orientation="right" stroke="var(--ink-soft)" tick={{
                                                    fontFamily: "IBM Plex Mono" , fontSize: 11 }} tickFormatter={(v)=>
                                                    `${v}%`}
                                                    width={44}
                                                    domain={[0, 25]}
                                                    ticks={[0, 5, 10, 15, 20, 25]}
                                                    />
                                                    <Tooltip labelFormatter={(v)=> eur0(v)}
                                                        formatter={(v, name) => [name && name.startsWith("Ø-Steuersatz")
                                                        ? `${v}%` : eur0(v), name]}
                                                        contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12,
                                                        border: "1px solid var(--line)" }}
                                                        />
                                                        <ReferenceLine yAxisId="left" x={bruttoAktuell}
                                                            stroke="var(--ink-soft)" strokeDasharray="3 3"
                                                            strokeWidth={1} />
                                                        <ReferenceLine yAxisId="left" y={0} stroke="var(--ink)"
                                                            strokeWidth={1} />
                                                        <ReferenceArea yAxisId="left" x1={0} x2={kgGrenzeT0} y1={-14000}
                                                            y2={0} fill="var(--steel)" fillOpacity={0.12} stroke="none"
                                                            ifOverflow="extendDomain">
                                                            <Label value={adjustSV ? "KG Überschuss 2026" : "Kindergeld 2026"} position="insideBottomLeft"
                                                                fill="var(--steel)" fontFamily="IBM Plex Mono"
                                                                fontSize={10} />
                                                        </ReferenceArea>
                                                        <ReferenceArea yAxisId="left" x1={0} x2={kgGrenzeT1} y1={-14000}
                                                            y2={0} fill="var(--turkis)" fillOpacity={0.12} stroke="none"
                                                            ifOverflow="extendDomain">
                                                            <Label value={adjustSV ? "KG Überschuss 2028" : "Kindergeld 2028"} position="insideTopLeft"
                                                                fill="var(--turkis)" fontFamily="IBM Plex Mono"
                                                                fontSize={10} />
                                                        </ReferenceArea>
                                                        <Line yAxisId="left" type="monotone" dataKey="effT0"
                                                            name={adjustSV ? "Netto-Abgabenlast 2026" : "Netto-Transferbilanz 2026"} stroke="var(--steel)"
                                                            strokeWidth={2} dot={false} isAnimationActive={false} />
                                                        <Line yAxisId="left" type="monotone" dataKey="effT1"
                                                            name={adjustSV ? "Netto-Abgabenlast 2028" : "Netto-Transferbilanz 2028"} stroke="var(--gold)"
                                                            strokeWidth={2} dot={false} isAnimationActive={false} />
                                                        <Line yAxisId="right" type="monotone" dataKey="avgT0"
                                                            name="Ø-Steuersatz 2026" stroke="var(--steel)"
                                                            strokeWidth={1.5} dot={false} strokeDasharray="2 2"
                                                            isAnimationActive={false} />
                                                        <Line yAxisId="right" type="monotone" dataKey="avgT1"
                                                            name="Ø-Steuersatz 2028" stroke="var(--turkis)"
                                                            strokeWidth={1.5} dot={false} strokeDasharray="2 2"
                                                            isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                    <div className="sr-chart-note">
                                        {adjustSV ? 
                                            "Unterhalb der Nulllinie übersteigt das Kindergeld die Abgaben (Steuer + SV) – die Familie erhält per saldo mehr, als sie zahlt. Der Ø-Steuersatz (rechte Achse) bezieht sich weiterhin auf die real gezahlte bzw. veranlagte Steuer, nicht auf diese Abgabenlast." :
                                            "Unterhalb der Nulllinie übersteigt das Kindergeld die tarifliche Steuer – die Familie erhält per saldo mehr, als sie zahlt (markiert als „Kindergeld\"-Bereich, keine negative Steuer). Der Ø-Steuersatz (rechte Achse) bezieht sich weiterhin auf die real gezahlte bzw. veranlagte Steuer, nicht auf diese Transferbilanz."
                                        }
                                    </div>
                                    <table className="sr-table">
                                        <thead>
                                            <tr>
                                                <th></th>
                                                <th>2026</th>
                                                <th>2027</th>
                                                <th>2028</th>
                                                <th>Gesamt 27/28</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td>Werbungskosten</td>
                                                <td>{eur0(current.wkT0)}</td>
                                                <td>{eur0(current.wkT2027)}</td>
                                                <td>{eur0(current.wkT1)}</td>
                                                <td>-</td>
                                            </tr>
                                            <tr>
                                                <td>Sozialversicherung (AN, abzugsfähig{adjustSV ? "" : ", unverändert"})</td>
                                                <td>{eur0(current.saT0)}</td>
                                                <td>{eur0(current.saT2027)}</td>
                                                <td>{eur0(current.saT1)}</td>
                                                <td>-</td>
                                            </tr>
                                            {current.entlastungsbetrag > 0 && (
                                                <tr>
                                                    <td>Entlastungsbetrag für Alleinerziehende (§ 24b)</td>
                                                    <td>{eur0(current.entlastungsbetrag)}</td>
                                                    <td>{eur0(current.entlastungsbetrag)}</td>
                                                    <td>{eur0(current.entlastungsbetrag)}</td>
                                                    <td>-</td>
                                                </tr>
                                            )}
                                            <tr>
                                                <td>zu versteuerndes Einkommen</td>
                                                <td>{eur0(current.zveT0)}</td>
                                                <td>{eur0(current.zveT2027)}</td>
                                                <td>{eur0(current.zveT1)}</td>
                                                <td>-</td>
                                            </tr>
                                            <tr>
                                                <td>Einkommensteuer (Tarif)</td>
                                                <td>{eur0(current.estT0)}</td>
                                                <td>{eur0(current.estT2027)}</td>
                                                <td>{eur0(current.estT1)}</td>
                                                <td>-</td>
                                            </tr>
                                            <tr>
                                                <td>Kindergeld / KFB-Vorteil</td>
                                                <td>{eur0(current.vorteilT0)}</td>
                                                <td>{eur0(current.vorteilT2027)}</td>
                                                <td>{eur0(current.vorteilT1)}</td>
                                                <td>-</td>
                                            </tr>
                                            <tr>
                                                <td>Netto-Transferbilanz (Steuer ./. Kindergeld/KFB)</td>
                                                <td>{eur0(current.effT0)}</td>
                                                <td>{eur0(current.effT2027)}</td>
                                                <td>{eur0(current.effT1)}</td>
                                                <td>-</td>
                                            </tr>
                                            {adjustSV && (
                                                <>
                                                    <tr>
                                                        <td>Sozialabgaben gesamt (Arbeitnehmer)</td>
                                                        <td>{eur0(current.svTotalT0)}</td>
                                                        <td>{eur0(current.svTotalT2027)}</td>
                                                        <td>{eur0(current.svTotalT1)}</td>
                                                        <td>{eur0(current.svTotalT2027 + current.svTotalT1)}</td>
                                                    </tr>
                                                    <tr>
                                                        <td>Reales Haushalts-Nettoeinkommen</td>
                                                        <td>{eur0(current.nettoT0)}</td>
                                                        <td>{eur0(current.nettoT2027)}</td>
                                                        <td>{eur0(current.nettoT1)}</td>
                                                        <td>-</td>
                                                    </tr>
                                                </>
                                            )}
                                            <tr className="sr-highlight">
                                                <td>{adjustSV ? "Netto-Entlastung gesamt / Jahr" : "Entlastung vs. 2026 / Jahr"}</td>
                                                <td>-</td>
                                                <td>{eur0(current.entlastung2027)}</td>
                                                <td>{eur0(current.entlastung2028)}</td>
                                                <td>{eur0(current.entlastungGesamt)}</td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    {(() => {
                                        if (current.guenstigerT1 === "Kinderfreibetrag") {
                                            return (
                                                <div style={{
                                                    marginTop: "16px",
                                                    padding: "12px",
                                                    background: "#eaf6f7",
                                                    border: "1px solid #52b7c1",
                                                    borderRadius: "3px",
                                                    fontSize: "11.5px",
                                                    color: "var(--ink)",
                                                    fontFamily: "var(--font-sans)",
                                                    lineHeight: "1.5"
                                                }}>
                                                    <strong>Vergleich der Berechnungsmodelle:</strong><br />
                                                    • Entlastung mit dem offiziellen Kinderfreibetrag (10.236 €): <strong>{eur0(current.entlastung2028)}</strong><br />
                                                    • Entlastung mit dem vom BMF unterstellten Kinderfreibetrag (10.292 €): <strong>{eur0(current.entlastungBmf2028)}</strong><br />
                                                    • Differenzbetrag: <strong>{eur0(current.entlastungBmf2028 - current.entlastung2028)}</strong>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
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
                                <li><b>Kinderfreibetrag & Alleinerziehende:</b> Der Kinderfreibetrag ist für 2027 auf 10.056&nbsp;€ (+300&nbsp;€) und für 2028 auf 10.236&nbsp;€ (+480&nbsp;€ gegenüber 2026) festgelegt, wie im Koalitionsbeschluss vom 2. Juli 2026 vorgesehen. Bei Alleinerziehenden wird der Entlastungsbetrag nach § 24b EStG (4.260&nbsp;€ für das erste Kind, +240&nbsp;€ für jedes weitere Kind) steuermindernd berücksichtigt.</li>
                                 <li><b>Sozialversicherung:</b> reale Beiträge zur Renten-, Arbeitslosen-, Kranken- und
                                     Pflegeversicherung, getrennt für jede Person und jeweils bis zur eigenen
                                    Beitragsbemessungsgrenze gedeckelt. {adjustSV ? "Bei aktivierter SV-Anpassung werden für 2028 die prognostizierten Grenzwerte für 2027 verwendet (76.800\u00a0€ KV/PV, 104.400\u00a0€ RV/ALV), andernfalls die Werte von 2026 (69.750\u00a0€ KV/PV, 101.400\u00a0€ RV/ALV)." : "Als Beitragsbemessungsgrenzen werden standardmäßig die Werte von 2026 verwendet (69.750\u00a0€ KV/PV, 101.400\u00a0€ RV/ALV)."} Der Pflegeversicherungsbeitrag berücksichtigt die Kinderzahl. Als
                                    Sonderausgaben angesetzt: Renten- und Pflegebeitrag voll,
                                    Krankenversicherungsbeitrag zu 96&nbsp;%.</li>
                            </ul>
                            <p className="sr-foot-disclaimer">Alle Werte sind eine Modellrechnung zur groben Einordnung,
                                keine Steuerberatung.</p>
                        </div>
                    </div>
                    );
                    }