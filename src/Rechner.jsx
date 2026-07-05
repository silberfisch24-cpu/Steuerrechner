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

const BMF_FAMILIES = [
  { id: "1", name: "Pflegekraft & Busfahrer (je 2.800 €)", familienstand: "verheiratet", brutto1: 33600, brutto2: 33600, kids: 2, km1: 0, km2: 0 },
  { id: "2", name: "Erzieher & Elektrikerin (je 3.200 €)", familienstand: "verheiratet", brutto1: 38400, brutto2: 38400, kids: 2, km1: 0, km2: 0 },
  { id: "3", name: "Lehrerin & Ingenieur (je 5.000 €)", familienstand: "verheiratet", brutto1: 60000, brutto2: 60000, kids: 2, km1: 0, km2: 0 },
  { id: "4", name: "Alleinerziehende Pflegekraft (2.800 €)", familienstand: "single", brutto1: 33600, brutto2: 0, kids: 2, km1: 0, km2: 0 },
  { id: "5", name: "Alleinerziehende Erzieherin (3.200 €)", familienstand: "single", brutto1: 38400, brutto2: 0, kids: 2, km1: 0, km2: 0 },
  { id: "6", name: "Alleinerziehender Lehrer (5.000 €)", familienstand: "single", brutto1: 60000, brutto2: 0, kids: 2, km1: 0, km2: 0 }
];

export default function SteuerreformRechner() {
  const [familienstand, setFamilienstand] = useState("verheiratet");
  const [brutto1, setBrutto1] = useState(34000);
  const [brutto2, setBrutto2] = useState(18000);
  const [km1, setKm1] = useState(20);
  const [km2, setKm2] = useState(8);
  const [kids, setKids] = useState(2);
  const [adjustSV, setAdjustSV] = useState(false);
  const [viewMode, setViewMode] = useState("einfach"); // "einfach" | "detailliert"

  const isSimple = viewMode === "einfach";
  const SIMPLE_MAX = 130000;
  const SIMPLE_PER = 100000;

  useEffect(() => {
    if (isSimple) {
      const verheiratet = familienstand === "verheiratet";
      const sum = brutto1 + (verheiratet ? brutto2 : 0);
      if (sum > SIMPLE_MAX) {
        const factor = SIMPLE_MAX / sum;
        const newB1 = Math.min(SIMPLE_PER, Math.round(brutto1 * factor / 500) * 500);
        const newB2 = Math.min(SIMPLE_PER, SIMPLE_MAX - newB1);
        setBrutto1(newB1);
        if (verheiratet) setBrutto2(newB2);
      } else {
        if (brutto1 > SIMPLE_PER) {
          setBrutto1(SIMPLE_PER);
        }
        if (verheiratet && brutto2 > SIMPLE_PER) {
          setBrutto2(SIMPLE_PER);
        }
      }
    }
  }, [isSimple, familienstand, brutto1, brutto2]);

  const activeFamilyId = useMemo(() => {
    const match = BMF_FAMILIES.find(f => 
      f.familienstand === familienstand &&
      f.brutto1 === brutto1 &&
      (familienstand === "single" || f.brutto2 === brutto2) &&
      f.kids === kids &&
      f.km1 === km1 &&
      (familienstand === "single" || f.km2 === km2)
    );
    return match ? match.id : "";
  }, [familienstand, brutto1, brutto2, kids, km1, km2]);

  const handleFamilyChange = (e) => {
    const val = e.target.value;
    if (!val) return;
    const fam = BMF_FAMILIES.find(f => f.id === val);
    if (fam) {
      setFamilienstand(fam.familienstand);
      setBrutto1(fam.brutto1);
      setBrutto2(fam.brutto2);
      setKids(fam.kids);
      setKm1(fam.km1);
      setKm2(fam.km2);
    }
  };

  // ResponsiveContainer misst seine Breite beim allerersten Rendern in
  // Grid-Layouts manchmal falsch (0px) und zeichnet die Linien erst nach
  // einem echten Resize-Event neu – z.B. auswertbar durch das Ziehen eines
  // Reglers. Ein einmaliges, kurz verzögertes Resize-Event nach dem Mount
  // erzwingt die korrekte Neuvermessung, ohne dass man interagieren muss.
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    // Einmaliges verzögertes Resize-Event nach dem Mount erzwingt korrekte Responsive-Messung
    const t = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      setWindowWidth(window.innerWidth);
    }, 80);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(t);
    };
  }, []);

  const verheiratet = familienstand === "verheiratet";

  const xAxisTicks = useMemo(() => {
    if (isSimple) {
      return verheiratet
        ? [20000, 40000, 60000, 80000, 100000, 120000, 130000]
        : [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000];
    }
    if (windowWidth > 1000) {
      return [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 110000, 120000, 130000, 140000, 150000, 160000, 170000, 180000, 190000, 200000];
    } else if (windowWidth > 600) {
      return [25000, 50000, 75000, 100000, 125000, 150000, 175000, 200000];
    } else {
      return [50000, 100000, 150000, 200000];
    }
  }, [windowWidth, isSimple, verheiratet]);

  const sliderMax1 = isSimple ? SIMPLE_PER : 150000;
  const sliderMax2 = isSimple ? SIMPLE_PER : 150000;

  const handleBrutto1Change = (val) => {
    setBrutto1(val);
    if (isSimple && verheiratet && val + brutto2 > SIMPLE_MAX) {
      setBrutto2(SIMPLE_MAX - val);
    }
  };

  const handleBrutto2Change = (val) => {
    setBrutto2(val);
    if (isSimple && val + brutto1 > SIMPLE_MAX) {
      setBrutto1(SIMPLE_MAX - val);
    }
  };

  const xDomain = useMemo(() => {
    if (isSimple) {
      return verheiratet ? [0, 130000] : [0, 100000];
    }
    return [0, 200000];
  }, [isSimple, verheiratet]);

  const bruttoAktuell = brutto1 + (verheiratet ? brutto2 : 0);
  const bruttoAktuellKey = Math.min(200000, Math.max(2000, Math.round(bruttoAktuell / 2000) * 2000));
  const splitRatio = bruttoAktuell > 0 ? brutto1 / bruttoAktuell : 1;

  const rawChartData = useMemo(() => {
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

  const chartData = useMemo(() => {
    return rawChartData.filter(d => d.brutto <= xDomain[1]);
  }, [rawChartData, xDomain]);


  // Steuerliche Freibeträge (Bausteine) für 2026
  const adultBase = (familienstand === "verheiratet")
    ? (2 * (11784 + 1230 + 36))
    : (11784 + 1230 + 36);

  const aeEntlastung = (familienstand === "single" && kids > 0)
    ? (4260 + (kids - 1) * 240)
    : 0;



  // Umrechnung von zvE-Freibeträgen in ungefähre Brutto-Grenzwerte
  // unter Berücksichtigung von ca. 20% abzugsfähigen Sozialabgaben (Vorsorgeaufwendungen)
  const limit2 = (adultBase + aeEntlastung) / 0.80;

  // Recharts Kategorie-Schlüssel (müssen exakt in den Chart-Daten enthalten sein)
  const limit2Key = chartData.find(d => d.brutto >= limit2)?.brutto ?? limit2;
  const yPoint = kids > 0 ? (chartData.find(d => d.effT0 > 0)?.brutto ?? limit2Key) : limit2Key;

  // 2028 Freibeträge zur Ermittlung des Steuerbeginns und der Nettozahler-Schwelle 2028
  const adultBase2028 = (familienstand === "verheiratet")
    ? (2 * (12828 + 1430 + 36))
    : (12828 + 1430 + 36);

  const aeEntlastung2028 = (familienstand === "single" && kids > 0)
    ? (4260 + (kids - 1) * 240)
    : 0;

  const taxFreeLimit2028 = (adultBase2028 + aeEntlastung2028) / 0.80;
  const onset2028Key = chartData.find(d => d.brutto >= taxFreeLimit2028)?.brutto ?? 2000;
  const netTaxOnset2028 = kids > 0 ? (chartData.find(d => d.effT1 > 0)?.brutto ?? 200000) : onset2028Key;

  // Y-Achsen-Dynamisierung
  const rawMin = kids === 0 ? -2000 : -(kids * 3180 + 2000);
  const minYDomain = Math.round(rawMin / 1000) * 1000;
  const maxEff = Math.max(...chartData.map(d => Math.max(d.effT0, d.effT1)));
  const maxYDomain = Math.ceil(maxEff / 10000) * 10000;

  const leftTicks = [minYDomain, 0];
  const leftStepSize = maxYDomain > 50000 ? 20000 : 10000;
  for (let t = leftStepSize; t <= maxYDomain; t += leftStepSize) {
    leftTicks.push(t);
  }

  const maxAvg = Math.max(...chartData.map(d => Math.max(d.avgT0, d.avgT1)));
  const maxRate = Math.max(25, Math.ceil(maxAvg / 5) * 5);
  const rightTicks = [];
  const rightStepSize = maxRate > 30 ? 10 : 5;
  for (let i = 0; i <= maxRate; i += rightStepSize) {
    rightTicks.push(i);
  }
  if (rightTicks[rightTicks.length - 1] !== maxRate) {
    rightTicks.push(maxRate);
  }


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
                                     padding-top: max(40px, env(safe-area-inset-top));
                                     padding-bottom: max(40px, env(safe-area-inset-bottom));
                                     padding-left: max(0px, env(safe-area-inset-left));
                                     padding-right: max(0px, env(safe-area-inset-right));
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
                                     max-width: 1400px;
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
                                     grid-template-columns: 300px minmax(0, 1fr);
                                     gap: 22px;
                                 }

                                @media (max-width: 760px) {
                                    .sr-grid {
                                        grid-template-columns: 1fr;
                                    }
                                    .sr-root {
                                        padding: 16px 12px;
                                        border-radius: 0;
                                        border-left: none;
                                        border-right: none;
                                        box-shadow: none;
                                    }
                                    .sr-chart-wrap {
                                        padding: 12px 4px 6px 4px;
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

                                 .sr-select {
                                     width: 100%;
                                     padding: 8px 12px;
                                     border: 1px solid var(--line);
                                     background: var(--paper);
                                     font-family: 'IBM Plex Serif', serif;
                                     font-size: 13px;
                                     color: var(--ink);
                                     border-radius: 2px;
                                     outline: none;
                                     cursor: pointer;
                                 }

                                 .sr-select option {
                                     font-family: 'IBM Plex Serif', serif;
                                     font-size: 13px;
                                 }

                                 .sr-select:focus {
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
                                <p className="sr-eyebrow">Angaben gemäß Koalitionsausschuss vom 02.07.2026</p>
                                <h1 className="sr-title sr-display">Modellrechner Steuerreform 2027/28</h1>
                            </div>
                        </div>

                        <div className="sr-grid">
                            <div className="sr-panel">
                                <p className="sr-panel-title">Eigene Eingaben</p>

                                <div className="sr-field">
                                    <label htmlFor="bmf-select">BMF-Beispielfamilie laden</label>
                                    <select
                                        id="bmf-select"
                                        className="sr-select"
                                        value={activeFamilyId}
                                        onChange={handleFamilyChange}
                                    >
                                        <option value="">-- Eigene Werte (Freie Eingabe) --</option>
                                        {BMF_FAMILIES.map(f => (
                                            <option key={f.id} value={f.id}>
                                                {f.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

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
                                    <input type="range" min="0" max={sliderMax1} step="500" value={brutto1} onChange={(e)=>
                                    handleBrutto1Change(Number(e.target.value))}
                                    />
                                </div>

                                {verheiratet && (
                                <div className="sr-field">
                                    <label>Brutto Partner 2 <span className="sr-val">{eur0(brutto2)}</span></label>
                                    <input type="range" min="0" max={sliderMax2} step="500" value={brutto2} onChange={(e)=>
                                    handleBrutto2Change(Number(e.target.value))}
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
                                    <label>Ansicht</label>
                                    <div className="sr-kids">
                                        <button className={isSimple ? "active" : ""} onClick={() => setViewMode("einfach")}>
                                            Einfach
                                        </button>
                                        <button className={!isSimple ? "active" : ""} onClick={() => setViewMode("detailliert")}>
                                            Detailliert
                                        </button>
                                    </div>
                                </div>

                                 {!isSimple && (
                                     <div className="sr-field">
                                         <div className="sr-toggle-container" onClick={() => setAdjustSV(!adjustSV)}>
                                             <div className={`sr-toggle-switch ${adjustSV ? "active" : ""}`}>
                                                 <div className="sr-toggle-handle" />
                                             </div>
                                             <span className="sr-toggle-label">Sozialabgaben 2027 anpassen</span>
                                         </div>
                                     </div>
                                 )}
                                 <div className="sr-readout">
                                     <div className="sr-readout-label">Entlastung 2028</div>
                                     <div className="sr-readout-value">
                                         {eur0(current.entlastung)}
                                         {!isSimple && current.effT0 > 0 && (current.entlastung / current.effT0) * 100 <= 150 && (
                                             <span className="sr-readout-pct"> ({((current.entlastung / current.effT0) *
                                             100).toFixed(1)}%)</span>
                                             )}
                                     </div>
                                     {!isSimple && (
                                         <div className="sr-readout-sub">
                                             Haushaltsbrutto {eur0(current.bruttoGesamt)} · Günstiger 2026:
                                             {current.guenstigerT0} · Günstiger 2028: {current.guenstigerT1}
                                         </div>
                                     )}
                                     {isSimple && (
                                         <div className="sr-readout-sub">
                                             Haushaltsbrutto {eur0(current.bruttoGesamt)}
                                         </div>
                                     )}

                                      {!isSimple && (
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
                                      )}
                                </div>
                            </div>

                            <div>
                                <div className="sr-chart-wrap">
                                    <div className="sr-legend">
                                         {!isSimple && (
                                             <>
                                                 <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                         background: "var(--c-stadt)" }} /> Stadt</span>
                                                 <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                         background: "var(--c-vorstadt)" }} /> Vorstadt</span>
                                                 <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                         background: "var(--c-land)" }} /> Land</span>
                                             </>
                                         )}
                                         <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                 background: "var(--gold)" , height: "3px" }} /> Deine Daten (absolut)</span>
                                         <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                 background: "var(--turkis)" , opacity: 0.3, height: "10px" , borderRadius:
                                                 0 }} /> Kindergeld-Erhöhung ({eur0(Math.max(0, current.kgT1 - current.kgT0))})</span>
                                     </div>
                                     <ResponsiveContainer width="100%" height={windowWidth <= 760 ? undefined : 360} aspect={windowWidth <= 760 ? 1.0 : undefined}>
                                         <LineChart data={chartData} margin={{ top: 6, right: 18, bottom: windowWidth <= 760 ? 20 : 6, left: 0 }}>
                                             <CartesianGrid stroke="var(--grid-color)" strokeDasharray="2 3" />
                                             <XAxis dataKey="brutto" type="number" domain={xDomain} tickFormatter={(v)=> `${v / 1000}`}
                                                 stroke="var(--ink-soft)"
                                                 tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }}
                                                 ticks={xAxisTicks}
                                                 label={{ value: "Haushaltsbrutto (in Tsd. €)", position: "insideBottom", offset:
                                                 -4, fontSize: 11, fill: "var(--ink-soft)" }}
                                                 />
                                                 <YAxis yAxisId="left" stroke="var(--ink-soft)" tick={{
                                                     fontFamily: "IBM Plex Mono" , fontSize: 11 }}
                                                     tickFormatter={axisEuro} width={56} />
                                                 <YAxis yAxisId="right" orientation="right" width={44} stroke="transparent" tick={false} />
                                                     <Tooltip labelFormatter={(v)=> eur0(v)}
                                                         contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12,
                                                         border: "1px solid var(--line)" }}
                                                         formatter={(v, name) => [eur0(v), name]}
                                                         filterNull={false}
                                                         itemSorter={() => 0}
                                                         content={({ active, payload, label }) => {
                                                         if (!active || !payload) return null;
                                                         const rows = payload.filter((p) => p.dataKey === "eigen");
                                                         if (rows.length === 0) return null;
                                                         return (
                                                         <div style={{ fontFamily: "IBM Plex Mono" , fontSize: 12,
                                                             border: "1px solid var(--line)" , background: "var(--paper)"
                                                             , padding: "8px 10px" }}>
                                                             <div style={{ marginBottom: 4 }}>Brutto: {eur0(label)}</div>
                                                             {rows.map((r) => (
                                                             <div key={r.dataKey} style={{ color: r.color }}>
                                                                 Deine Entlastung: {eur0(r.value)}
                                                             </div>
                                                             ))}
                                                         </div>
                                                         );
                                                         }}
                                                         />
                                                         <ReferenceLine yAxisId="left" x={bruttoAktuellKey}
                                                             stroke="var(--gold)" strokeDasharray="3 3"
                                                             strokeWidth={1.5} />
                                                         <ReferenceArea yAxisId="left" y1={0} y2={Math.max(0,
                                                             current.kgT1 - current.kgT0)} fill="var(--turkis)"
                                                             fillOpacity={0.12} stroke="var(--turkis)" strokeOpacity={0.4}
                                                             strokeDasharray="2 2" ifOverflow="extendDomain" />
                                                         {!isSimple && (
                                                             <>
                                                                 <Line yAxisId="left" type="monotone" dataKey="stadt"
                                                                     name="Stadt" stroke="var(--c-stadt)"
                                                                     strokeWidth={1.5} dot={false} strokeDasharray="4 3"
                                                                     isAnimationActive={false} />
                                                                 <Line yAxisId="left" type="monotone" dataKey="vorstadt"
                                                                     name="Vorstadt" stroke="var(--c-vorstadt)"
                                                                     strokeWidth={1.5} dot={false} strokeDasharray="4 3"
                                                                     isAnimationActive={false} />
                                                                 <Line yAxisId="left" type="monotone" dataKey="land"
                                                                     name="Land" stroke="var(--c-land)"
                                                                     strokeWidth={1.5} dot={false} strokeDasharray="4 3"
                                                                     isAnimationActive={false} />
                                                             </>
                                                         )}
                                                         <Line yAxisId="left" type="monotone" dataKey="eigen"
                                                             name="Deine Daten, absolut" stroke="var(--gold)"
                                                             strokeWidth={2.5} dot={false} isAnimationActive={false} />
                                         </LineChart>
                                     </ResponsiveContainer>
                                     {!isSimple && (
                                         <div className="sr-chart-note" style={{ marginTop: "12px", borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
                                             <strong>Erklärung der Referenz-Modellkurven (je 2 Kinder):</strong><br />
                                             • <strong>Stadt:</strong> Kurze Arbeitswege (je 5 km). Die Fahrtkosten liegen unter dem Werbungskosten-Pauschbetrag – diese Familien profitieren voll von dessen Erhöhung.<br />
                                             • <strong>Vorstadt:</strong> Ein Partner pendelt weit (30 km), ein Partner kurz (5 km).<br />
                                             • <strong>Land:</strong> Beide Partner pendeln weit (je 25 km). Die tatsächlichen Fahrtkosten liegen über dem Pauschbetrag – die Erhöhung des Pauschbetrags greift hier nicht (keine zusätzliche Entlastung).
                                         </div>
                                     )}
                                </div>


                                <div className="sr-chart-wrap" style={{ marginTop: 18 }}>
                                    <div className="sr-legend">
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--steel)" }} /> {adjustSV ? "Netto-Abgabenlast 2026 (Steuer + SV ./. Kindergeld)" : "Netto-Transferbilanz 2026 (Steuer ./. Kindergeld/KFB)"}</span>
                                        <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                background: "var(--gold)" }} /> {adjustSV ? "Netto-Abgabenlast 2028" : "Netto-Transferbilanz 2028"}</span>
                                        {!isSimple && (
                                            <span className="sr-legend-item"><span className="sr-legend-swatch" style={{
                                                    background: "var(--turkis)" , height: "2px" ,
                                                    borderTop: "2px dashed var(--turkis)" }} /> Ø-Steuersatz auf real
                                                gezahlte Steuer (rechte Achse)</span>
                                        )}
                                        <span className="sr-legend-item" style={{ color: "var(--ink-soft)" }}>Eigenes
                                            Profil: {km1}{verheiratet ? ` km / ${km2} km` : " km"}, {kids} Kind{kids ===
                                            1 ? "" : "er"}{!isSimple && ` · ${adjustSV ? "negativer Bereich = Kindergeld übersteigt Steuer + SV" : "negativer Bereich = Kindergeld übersteigt die Steuer"}`}</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height={windowWidth <= 760 ? undefined : 320} aspect={windowWidth <= 760 ? 1.0 : undefined}>
                                        <LineChart data={chartData} margin={{ top: 6, right: 18, bottom: windowWidth <= 760 ? 20 : 6, left: 0 }}>
                                            <CartesianGrid stroke="var(--grid-color)" strokeDasharray="2 3" />
                                            <XAxis dataKey="brutto" type="number" domain={xDomain} tickFormatter={(v)=> `${v / 1000}`} ticks={xAxisTicks}
                                                stroke="var(--ink-soft)"
                                                tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }}
                                                label={{ value: "Haushaltsbrutto (in Tsd. €)", position: "insideBottom", offset:
                                                -4, fontSize: 11, fill: "var(--ink-soft)" }}
                                                />
                                                <YAxis yAxisId="left" stroke="var(--ink-soft)" tick={{
                                                    fontFamily: "IBM Plex Mono" , fontSize: 11 }}
                                                    tickFormatter={axisEuro} width={56} 
                                                    domain={[minYDomain, maxYDomain]}
                                                    ticks={leftTicks} />
                                                {!isSimple && (
                                                    <YAxis yAxisId="right" orientation="right" stroke="var(--ink-soft)" tick={{
                                                        fontFamily: "IBM Plex Mono" , fontSize: 11 }} tickFormatter={(v)=>
                                                        `${v}%`}
                                                        width={44}
                                                        domain={[0, maxRate]}
                                                        ticks={rightTicks}
                                                        />
                                                )}
                                                {isSimple && (
                                                    <YAxis yAxisId="right" orientation="right" width={44} stroke="transparent" tick={false} />
                                                )}
                                                    <Tooltip labelFormatter={(v)=> eur0(v)}
                                                        formatter={(v, name) => [name && name.startsWith("Ø-Steuersatz")
                                                        ? `${v}%` : eur0(v), name]}
                                                        contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12,
                                                        border: "1px solid var(--line)" }}
                                                        />
                                                        <ReferenceLine yAxisId="left" x={bruttoAktuellKey}
                                                            stroke="var(--gold)" strokeDasharray="3 3"
                                                            strokeWidth={1.5} />
                                                        <ReferenceArea yAxisId="left" x2={Math.min(limit2Key, xDomain[1])} y1={minYDomain} y2={maxYDomain}
                                                             fill="rgba(45, 60, 75, 0.16)" stroke="none"
                                                             ifOverflow="extendDomain">
                                                             <Label value="Steuerfrei" position="insideTopLeft"
                                                                 fill="rgba(45, 60, 75, 0.85)" fontFamily="IBM Plex Mono"
                                                                 fontSize={9} />
                                                         </ReferenceArea>
                                                         {kids > 0 && Math.min(limit2Key, xDomain[1]) < Math.min(yPoint, xDomain[1]) && (
                                                             <ReferenceArea yAxisId="left" x1={Math.min(limit2Key, xDomain[1])} x2={Math.min(yPoint, xDomain[1])} y1={minYDomain} y2={maxYDomain}
                                                                 fill="rgba(45, 60, 75, 0.05)" stroke="none"
                                                                 ifOverflow="extendDomain">
                                                                 <Label value="Nettoempfänger" position="insideTopLeft"
                                                                     fill="rgba(45, 60, 75, 0.65)" fontFamily="IBM Plex Mono"
                                                                     fontSize={9} />
                                                             </ReferenceArea>
                                                         )}
                                                         {Math.min(yPoint, xDomain[1]) < xDomain[1] && (
                                                             <ReferenceArea yAxisId="left" x1={Math.min(yPoint, xDomain[1])} x2={xDomain[1]} y1={minYDomain} y2={maxYDomain}
                                                                 fill="transparent" stroke="none"
                                                                 ifOverflow="extendDomain">
                                                                 <Label value="Nettozahler" position="insideTopLeft"
                                                                     fill="rgba(45, 60, 75, 0.65)" fontFamily="IBM Plex Mono"
                                                                     fontSize={9} />
                                                             </ReferenceArea>
                                                         )}
                                                         <ReferenceLine yAxisId="left" y={0} stroke="var(--ink)" strokeWidth={1} />
                                                         <Line yAxisId="left" type="monotone" dataKey="effT0"
                                                             name={adjustSV ? "Netto-Abgabenlast 2026" : "Netto-Transferbilanz 2026"} stroke="var(--steel)"
                                                             strokeWidth={2} dot={false} isAnimationActive={false} />
                                                         <Line yAxisId="left" type="monotone" dataKey="effT1"
                                                             name={adjustSV ? "Netto-Abgabenlast 2028" : "Netto-Transferbilanz 2028"} stroke="var(--gold)"
                                                             strokeWidth={2} dot={false} isAnimationActive={false} />
                                                         {!isSimple && (
                                                             <>
                                                                 <Line yAxisId="right" type="monotone" dataKey="avgT0"
                                                                     name="Ø-Steuersatz 2026" stroke="var(--steel)"
                                                                     strokeWidth={1.5} dot={false} strokeDasharray="2 2"
                                                                     isAnimationActive={false} />
                                                                 <Line yAxisId="right" type="monotone" dataKey="avgT1"
                                                                     name="Ø-Steuersatz 2028" stroke="var(--turkis)"
                                                                     strokeWidth={1.5} dot={false} strokeDasharray="2 2"
                                                                     isAnimationActive={false} />
                                                             </>
                                                         )}
                                        </LineChart>
                                    </ResponsiveContainer>
                                    {!isSimple && (
                                        <div className="sr-chart-note">
                                            <div>
                                                {adjustSV ? 
                                                    "Unterhalb der Nulllinie übersteigt das Kindergeld die Abgaben (Steuer + SV) – die Familie erhält per saldo mehr, als sie zahlt. Der Ø-Steuersatz (rechte Achse) bezieht sich weiterhin auf die real gezahlte bzw. veranlagte Steuer, nicht auf diese Abgabenlast." :
                                                    "Unterhalb der Nulllinie übersteigt das Kindergeld die tarifliche Steuer – die Familie erhält per saldo mehr, als sie zahlt (markiert als „Kindergeld\"-Bereich, keine negative Steuer). Der Ø-Steuersatz (rechte Achse) bezieht sich weiterhin auf die real gezahlte bzw. veranlagte Steuer, nicht auf diese Transferbilanz."
                                                }
                                            </div>
                                            <div style={{ marginTop: "6px", borderTop: "1px dashed var(--line)", paddingTop: "6px" }}>
                                                <strong>Hintergrund-Zonen (2026):</strong>{" "}
                                                <span><b>Steuerfrei:</b> bis {eur0(limit2)}</span>
                                                {kids > 0 ? (
                                                    <>
                                                        {" "}· <span><b>Nettoempfänger:</b> bis {eur0(yPoint)}</span>
                                                        {" "}· <span><b>Nettozahler:</b> ab {eur0(yPoint)}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        {" "}· <span><b>Nettozahler:</b> ab {eur0(limit2)}</span>
                                                    </>
                                                )}
                                                .
                                            </div>
                                            <div style={{ marginTop: "4px" }}>
                                                <strong>Entwicklung im Reformjahr 2028:</strong>{" "}
                                                <span><b>Steuerbeginn 2028:</b> erst ab {eur0(onset2028Key)} (+{eur0(Math.max(0, onset2028Key - limit2))} steuerfrei)</span>
                                                {kids > 0 ? (
                                                    <>
                                                        {" "}· <span><b>Nettozahler 2028:</b> ab {eur0(netTaxOnset2028)}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        {" "}· <span><b>Nettozahler 2028:</b> ab {eur0(onset2028Key)}</span>
                                                    </>
                                                )}
                                                .
                                            </div>
                                        </div>
                                    )}
                                    {!isSimple && (
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
                                    )}

                                    {!isSimple && current.guenstigerT1 === "Kinderfreibetrag" && (
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
                                    )}
                                </div>
                            </div>
                        </div>

                        {!isSimple && (
                            <div className="sr-foot">
                                <p className="sr-foot-title">Steuerliche Parameter und Modellannahmen</p>
                                <ul className="sr-foot-list">
                                    <li><b>Steuertarif & Grundfreibetrag (GFB):</b> Genäherte Tarifformel nach EStG § 32a. Der Grundfreibetrag steigt für 2027 auf 12.084&nbsp;€ (+300&nbsp;€) und für 2028 auf 12.828&nbsp;€ (+744&nbsp;€ gegenüber 2026). Splittingtarif bei „Verheiratet“, Grundtarif bei „Single“. Ein Spitzensteuersatz von 45&nbsp;% ab 250.000&nbsp;€ zu versteuerndem Einkommen ist im Modell vereinfacht nicht abgebildet.</li>
                                    <li><b>Werbungskosten & Fahrtkosten:</b> Der Arbeitnehmer-Pauschbetrag steigt für 2027 auf 1.330&nbsp;€ (+100&nbsp;€) und für 2028 auf 1.430&nbsp;€ (+200&nbsp;€ gegenüber 2026). Die Entfernungspauschale beträgt einheitlich 0,38&nbsp;€ pro Kilometer und Arbeitstag (220 Tage/Jahr), wie seit 2026 gesetzlich verankert.</li>
                                    <li><b>Kindergeld & Freibeträge:</b> Das Kindergeld steigt ab 2028 von 250&nbsp;€ auf 265&nbsp;€ pro Kind und Monat (2027 bleibt es bei 250&nbsp;€). Der Kinderfreibetrag steigt für 2027 auf 10.056&nbsp;€ (+300&nbsp;€) und für 2028 auf 10.236&nbsp;€ (+480&nbsp;€ gegenüber 2026). Bei Alleinerziehenden wird der Entlastungsbetrag nach § 24b EStG (4.260&nbsp;€ für das erste Kind, +240&nbsp;€ für jedes weitere Kind) steuermindernd einbezogen.</li>
                                    <li><b>Sozialversicherung (Vorsorgeaufwendungen):</b> Reale Beiträge zur Renten-, Arbeitslosen-, Kranken- und Pflegeversicherung, getrennt berechnet je Person und gedeckelt bei der Beitragsbemessungsgrenze (BBG). {adjustSV ? "Bei aktivierter SV-Anpassung werden für 2028 die prognostizierten Grenzwerte für 2027 verwendet (76.800\u00a0€ KV/PV, 104.400\u00a0€ RV/ALV), andernfalls die Werte von 2026 (69.750\u00a0€ KV/PV, 101.400\u00a0€ RV/ALV)." : "Als Beitragsbemessungsgrenzen werden standardmäßig die Werte von 2026 verwendet (69.750\u00a0€ KV/PV, 101.400\u00a0€ RV/ALV)."} Der Pflegebeitrag berücksichtigt die Kinderzahl. Vorsorgeaufwendungen sind als Sonderausgaben abziehbar (Renten-/Pflegebeitrag voll, Krankenversicherung zu 96&nbsp;%).</li>
                                </ul>
                                <p className="sr-foot-disclaimer">Alle Werte sind eine Modellrechnung zur groben Einordnung,
                                    keine Steuerberatung. (v1.05)</p>
                            </div>
                        )}
                        {isSimple && (
                            <div className="sr-foot" style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                                <p className="sr-foot-disclaimer">Alle Werte sind eine Modellrechnung zur groben Einordnung,
                                    keine Steuerberatung. (v1.05)</p>
                            </div>
                        )}
                    </div>
                    );
                    }