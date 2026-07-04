/**
 * Steuerrechner Test Runner (test_engine.js)
 * 
 * Dieses Skript ermöglicht es, die Berechnungs-Engine in src/Rechner.jsx lokal zu testen,
 * ohne dass ein React-Build-System oder Babel eingerichtet werden muss.
 * Es liest src/Rechner.jsx ein, extrahiert die mathematische Logik (vor der React-Komponente),
 * entfernt die ES6-Imports und führt automatisierte Testfälle aus.
 * 
 * Ausführen mit: node test_engine.js
 */

const fs = require('fs');
const path = require('path');

function runTests() {
    const htmlPath = path.join(__dirname, 'src', 'Rechner.jsx');
    if (!fs.existsSync(htmlPath)) {
        console.error(`Fehler: Rechner.jsx wurde nicht unter ${htmlPath} gefunden.`);
        process.exit(1);
    }

    const code = fs.readFileSync(htmlPath, 'utf8');

    // 1. Suche den Start der React-Komponente, um die Engine abzutrennen
    const componentIndex = code.indexOf('export default function SteuerreformRechner');
    if (componentIndex === -1) {
        console.error("Fehler: Der Einstiegspunkt 'export default function SteuerreformRechner' wurde in src/Rechner.jsx nicht gefunden.");
        process.exit(1);
    }

    let engineCode = code.substring(0, componentIndex);

    // 2. Entferne ES6-Import-Statements (da Node diese standardmäßig ohne ESM-Konfiguration nicht mag)
    engineCode = engineCode.replace(/import\s+[\s\S]*?from\s+['"].*?['"];?/g, '');

    // 3. Füge Node.js Modul-Exports hinzu, damit wir die Funktionen testen können
    engineCode += `
module.exports = {
    calcPendlerkosten,
    calcTarif,
    PARAMS,
    KFB_PRO_KIND_T0,
    KFB_PRO_KIND_T1,
    marginalRate,
    incomeTax,
    incomeMarginalRate,
    pvSatzAN,
    calcSVBeitrag,
    calculateNetRelief
};
`;

    // 4. Schreibe temporäre JS-Datei
    const tempPath = path.join(__dirname, '.temp_engine.cjs');
    fs.writeFileSync(tempPath, engineCode, 'utf8');

    let engine;
    try {
        engine = require(tempPath);
    } catch (err) {
        console.error("Fehler beim Laden der Engine. Wahrscheinlich liegt ein Syntaxfehler in src/Rechner.jsx vor:");
        console.error(err);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        process.exit(1);
    }

    // 5. Aufräumen der temporären Datei
    fs.unlinkSync(tempPath);

    console.log("====================================================");
    console.log("🧪 STARTE ENGINE-TESTS FÜR RECHNER.JSX");
    console.log("====================================================");

    let passed = 0;
    let failed = 0;

    function assert(name, condition, message = "") {
        if (condition) {
            console.log(`✅ TEST BESTANDEN: ${name}`);
            passed++;
        } else {
            console.error(`❌ TEST FEHLGESCHLAGEN: ${name}`);
            if (message) console.error(`   Grund: ${message}`);
            failed++;
        }
    }

    // --- TESTFALL 1: PENDLERKOSTEN ---
    try {
        const cost0 = engine.calcPendlerkosten(0);
        const cost10 = engine.calcPendlerkosten(10, 220);
        assert("Pendlerkosten (0 km)", cost0 === 0, `Erwartet 0, erhalten ${cost0}`);
        assert("Pendlerkosten (10 km, 220 Tage)", cost10 === 10 * 220 * 0.38, `Erwartet ${10 * 220 * 0.38}, erhalten ${cost10}`);
    } catch (e) {
        console.error("Fehler in Testfall 1:", e);
        failed++;
    }

    // --- TESTFALL 2: SOZIALVERSICHERUNGSBEITRÄGE & CAPS ---
    try {
        const svLow = engine.calcSVBeitrag(30000, 2);
        const svHigh = engine.calcSVBeitrag(120000, 2); // Über beiden Beitragsbemessungsgrenzen

        assert("SV-Beitrag (30.000 €) berechnet", svLow.total > 0);
        
        // BBG Krankenversicherung Check (69.750 €)
        // RV/ALV Check (101.400 €)
        const expectedMaxRV = 101400 * 0.093;
        const expectedMaxKV = 69750 * 0.0875;
        assert("Rentenbeitrag gedeckelt an BBG", Math.abs(svHigh.rv - expectedMaxRV) < 0.01, `Erwartet ${expectedMaxRV}, erhalten ${svHigh.rv}`);
        assert("Krankenbeitrag gedeckelt an BBG", Math.abs(svHigh.kv - expectedMaxKV) < 0.01, `Erwartet ${expectedMaxKV}, erhalten ${svHigh.kv}`);
    } catch (e) {
        console.error("Fehler in Testfall 2:", e);
        failed++;
    }

    // --- TESTFALL 3: GÜNSTIGERPRÜFUNG FÜR EHEPAAR (NORMALES EINKOMMEN) ---
    try {
        // 75.000 € Haushaltseinkommen, 2 Kinder, verheiratet, 25km/5km Pendeln
        const res = engine.calculateNetRelief(50000, 25000, 25, 5, 2, "verheiratet");
        assert("Günstigerprüfung Ehepaar 75k (t0 = Kindergeld)", res.guenstigerT0 === "Kindergeld");
        assert("Günstigerprüfung Ehepaar 75k (t1 = Kindergeld)", res.guenstigerT1 === "Kindergeld");
        assert("Entlastung Ehepaar 75k > 312 € (Steuersenkung greift)", res.entlastung > 312, `Erwartet > 312 €, erhalten ${res.entlastung.toFixed(2)} €`);
    } catch (e) {
        console.error("Fehler in Testfall 3:", e);
        failed++;
    }

    // --- TESTFALL 4: GÜNSTIGERPRÜFUNG FÜR ALLEINERZIEHENDE (SINGLE) ---
    try {
        // 60.000 € Brutto, 1 Kind, Single.
        // Der Freibetrag (4.878 €) spart bei ca. 27% Steuersatz rund 1.300 € Steuer.
        // Das halbe Kindergeld beträgt 1.554 €. 
        // Der Freibetrag sollte günstiger sein!
        const res = engine.calculateNetRelief(60000, 0, 0, 0, 1, "single");
        assert("Günstigerprüfung Single 60k (t0 = Kinderfreibetrag)", res.guenstigerT0 === "Kinderfreibetrag", `Erwartet Kinderfreibetrag, erhalten ${res.guenstigerT0}`);
        assert("Vorteil Single 60k (t0) berücksichtigt verbleibendes Kindergeld", res.vorteilT0 > 3100, `Vorteil sollte > 3100 € sein (Steuersenkung + halbes Kindergeld), erhalten ${res.vorteilT0.toFixed(2)} €`);
    } catch (e) {
        console.error("Fehler in Testfall 4:", e);
        failed++;
    }

    // --- TESTFALL 5: SOZIALVERSICHERUNGS-ANPASSUNG 2027 ---
    try {
        const sv2027High = engine.calcSVBeitrag(120000, 2, true);
        const expectedMaxRV2027 = 104400 * 0.093;
        const expectedMaxKV2027 = 76800 * 0.0875;
        
        assert("2027 Rentenbeitrag gedeckelt an BBG (104.400 €)", Math.abs(sv2027High.rv - expectedMaxRV2027) < 0.01, `Erwartet ${expectedMaxRV2027}, erhalten ${sv2027High.rv}`);
        assert("2027 Krankenbeitrag gedeckelt an BBG (76.800 €)", Math.abs(sv2027High.kv - expectedMaxKV2027) < 0.01, `Erwartet ${expectedMaxKV2027}, erhalten ${sv2027High.kv}`);

        // Vergleiche Entlastung für Single mit 100k Brutto mit und ohne SV-Anpassung
        const resNoSV = engine.calculateNetRelief(100000, 0, 0, 0, 0, "single", false);
        const resWithSV = engine.calculateNetRelief(100000, 0, 0, 0, 0, "single", true);
        
        assert("SV-Anpassung mindert Netto-Entlastung bei 100k Brutto", resWithSV.entlastung < resNoSV.entlastung, `Entlastung ohne SV: ${resNoSV.entlastung.toFixed(2)} €, mit SV: ${resWithSV.entlastung.toFixed(2)} €`);
        assert("SV-Gesamtabgaben 2028 sind höher bei adjustSV", resWithSV.svTotalT1 > resWithSV.svTotalT0, `SV 2026: ${resWithSV.svTotalT0.toFixed(2)} €, SV 2028: ${resWithSV.svTotalT1.toFixed(2)} €`);
    } catch (e) {
        console.error("Fehler in Testfall 5:", e);
        failed++;
    }

    console.log("====================================================");
    if (failed === 0) {
        console.log(`🎉 ALLE ${passed} TESTS ERFOLGREICH BESTANDEN!`);
    } else {
        console.error(`🚨 TESTS BEENDET MIT FEHLERN: ${passed} bestanden, ${failed} fehlgeschlagen.`);
    }
    console.log("====================================================");
}

runTests();
