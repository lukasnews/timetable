/**
 * Gerätetest für sehr alte Android-Versionen (Android 10): deren System-WebView kann Playwright nicht steuern,
 * daher nur über die Bedienungshilfen-Ansicht (uiautomator) – liest Texte vom Bildschirm und tippt wie ein Mensch.
 * Prüft: Kalender erscheint (JavaScript läuft), Termin per Schnelleingabe anlegen, Erinnerung kommt pünktlich bei geschlossener App,
 * Test-Benachrichtigung, Widget am Startbildschirm, Teilen-Menü.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const PKG = 'com.javuno.timetable';
const OUT = process.env.OUT || 'android-test';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => { for (let i = 0; ; i++) { try { return execFileSync('adb', a, { encoding: 'utf8', timeout: 60000 }); } catch (e) { if (i >= 2) throw e; } } };
const sh = (c) => adb('shell', c);
const results = [];
let shot = 0;
const snap = (n) => { try { fs.writeFileSync(`${OUT}/${String(++shot).padStart(2, '0')}-${n}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p'])); } catch { /* egal */ } };
const nodes = () => {
  sh('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1');
  const xml = sh('cat /sdcard/ui.xml');
  return [...xml.matchAll(/<node [^>]*>/g)].map((m) => {
    const a = (k) => (m[0].match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] || '';
    const b = a('bounds').match(/\d+/g)?.map(Number) || [0, 0, 0, 0];
    return { text: a('text'), desc: a('content-desc'), cls: a('class'), x: (b[0] + b[2]) >> 1, y: (b[1] + b[3]) >> 1 };
  });
};
const find = async (re, secs = 20, scroll = false) => {
  for (let i = 0; i < secs; i++) {
    if (scroll && i > 0 && i % 2 === 0) sh('input swipe 540 1600 540 700 400');
    const all = nodes().filter((x) => re.test(x.text) || re.test(x.desc));
    if (all.length) return all.find((x) => /Button/.test(x.cls)) || all[0];
    await sleep(1000);
  }
  throw new Error('nicht gefunden: ' + re + ' | sichtbar: ' + nodes().map((x) => x.text || x.desc).filter(Boolean).slice(0, 30).join(' | '));
};
const tap = async (re, secs, scroll) => { const n = await find(re, secs, scroll); sh(`input tap ${n.x} ${n.y}`); await sleep(1500); return n; };
const step = async (name, fn) => {
  try { const info = await fn(); results.push({ name, ok: true, info: info || '' }); console.log('✓', name, info || ''); }
  catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n')[0].slice(0, 600) }); console.log('✗', name, String(e.message || e).slice(0, 600)); snap('fehler'); }
};
const delivered = (re) => sh('dumpsys notification --noredact').split(/\n\s*NotificationRecord/).filter((b) => b.includes(`pkg=${PKG}`)).some((b) => re.test(b));

(async () => {
  console.log('System-WebView:', sh('dumpsys package com.google.android.webview | grep versionName | head -1').trim());
  try { sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`); } catch { /* vor Android 13 nicht nötig */ }
  sh(`am start -n ${PKG}/.MainActivity`);

  await step('App startet, Kalender erscheint (JavaScript läuft)', async () => {
    const n = await find(/Beispiel-Daten|Familienkalender anlegen/, 120);
    await sleep(3000); snap('start');
    const texts = nodes().map((x) => x.text || x.desc);
    if (!texts.some((t) => /^Heute$/.test(t))) throw new Error('Kalender-Leiste fehlt: ' + texts.filter(Boolean).slice(0, 30).join(' | '));
    return n.text || n.desc;
  });
  // Termin in ein paar Minuten per Schnelleingabe (Tastatur über adb kennt keine Umlaute)
  const [h0, m0] = sh('date +%H:%M').trim().split(':').map(Number);
  let mins = Math.ceil((h0 * 60 + m0 + 5) / 5) * 5;
  if (mins > 23 * 60 + 45) mins = 23 * 60 + 45;
  const hhmm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  await step(`Termin „heute ${hhmm} Geraetetest“ mit Erinnerung „Zum Beginn“ anlegen`, async () => {
    await tap(/^Neuer Termin$/);
    await sleep(1000);
    await tap(/Titel/); // Titelfeld (Platzhalter)
    sh(`input text "heute%s${hhmm}%sUhr%sGeraetetest"`);
    await sleep(800);
    const sel = nodes().filter((x) => /Spinner/.test(x.cls) && /^Keine$/.test(x.text));
    if (!sel.length) await find(/^Keine$/, 10, true);
    const n = nodes().find((x) => /Spinner/.test(x.cls) && /^Keine$/.test(x.text)) || await find(/^Keine$/, 5);
    sh(`input tap ${n.x} ${n.y}`); await sleep(1500);
    await tap(/^Zum Beginn$/);
    await tap(/^Speichern$/);
    await sleep(1500);
    if (!nodes().some((x) => /Geraetetest/.test(x.text || x.desc))) throw new Error('Termin nicht im Kalender');
    snap('termin');
  });

  await step('Einstellungen → Erinnerungen am Gerät einschalten', async () => {
    await tap(/^Einstellungen$/);
    await tap(/^Erinn\.?$|^Erinnerungen$/);
    await tap(/Erinnerungen auf diesem Gerät/);
    await find(/Test-Benachrichtigung in 1 Minute/, 15);
    snap('erinnerungen');
  });
  await step('Test-Benachrichtigung planen', async () => { await tap(/Test-Benachrichtigung in 1 Minute/); });
  await step('Widget zum Startbildschirm hinzufügen', async () => {
    await tap(/Zum Startbildschirm hinzufügen/, 20, true);
    await sleep(2000); snap('widget-dialog');
    const n = await tap(/^(add automatically|add to home screen|add|hinzufügen|automatisch hinzufügen)$/i, 10);
    return 'bestätigt: ' + (n.text || n.desc);
  });
  sh('input keyevent KEYCODE_HOME');
  await sleep(4000);
  await step('Widget am Startbildschirm zeigt den Termin', async () => {
    for (let i = 0; i < 10; i++) {
      const t = nodes().map((x) => x.text).filter(Boolean);
      if (t.some((x) => /Geraetetest/.test(x))) { snap('widget'); return t.filter((x) => /Geraetetest|Heute|Morgen/.test(x)).slice(0, 6).join(' | '); }
      await sleep(1500);
    }
    throw new Error('Termin nicht im Widget: ' + nodes().map((x) => x.text || x.desc).filter(Boolean).slice(0, 30).join(' | ') + ' || ' + sh('dumpsys appwidget | grep -A3 com.javuno.timetable | head -8').replace(/\s+/g, ' '));
  });
  await step('Test-Benachrichtigung kommt bei geschlossener App an', async () => {
    for (let i = 0; i < 60; i++) { if (delivered(/Test vom Familienkalender/)) { snap('benachrichtigung'); return `nach ~${i * 3} s im Hintergrund`; } await sleep(3000); }
    throw new Error('nicht angekommen');
  });
  await step(`Erinnerung „Geraetetest“ kommt pünktlich um ${hhmm}`, async () => {
    const until = Date.now() + 15 * 60 * 1000;
    while (Date.now() < until) {
      if (delivered(/Geraetetest/)) {
        const t = sh('date +%H:%M:%S').trim(); snap('erinnerung');
        const [h, m] = t.split(':').map(Number); const diff = h * 60 + m - mins;
        if (diff < 0 || diff > 2) throw new Error(`zur falschen Zeit: ${t} statt ${hhmm}`);
        return 'angekommen um ' + t;
      }
      await sleep(5000);
    }
    throw new Error('nicht angekommen');
  });
  await step('„Sicherung speichern“ öffnet das Teilen-Menü', async () => {
    sh(`am start -n ${PKG}/.MainActivity`); await sleep(3000);
    if (!nodes().some((x) => /^Daten$/.test(x.text || x.desc))) await tap(/^Einstellungen$/);
    await tap(/^Daten$/);
    await tap(/Sicherung speichern/);
    for (let i = 0; i < 15; i++) {
      const top = sh('dumpsys activity activities | grep -E "ResumedActivity" | head -2');
      if (/Chooser|Resolver/i.test(top)) { snap('teilen'); sh('input keyevent KEYCODE_BACK'); return top.trim().split('\n')[0].trim(); }
      await sleep(1000);
    }
    throw new Error('kein Teilen-Menü');
  });

  const ok = results.every((r) => r.ok);
  const md = [`# Android-Gerätetest (Bedienungshilfen) ${ok ? '✅' : '❌'}`, '', `Android ${sh('getprop ro.build.version.release').trim()}`, '',
    ...results.map((r) => `- ${r.ok ? '✅' : '❌'} ${r.name}${r.info ? ` — ${r.info}` : ''}`)].join('\n');
  fs.writeFileSync(`${OUT}/bericht.md`, md + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(md);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
