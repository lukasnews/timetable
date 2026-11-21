/**
 * Gerätetest für sehr alte Android-Versionen (Android 10): deren System-WebView kann Playwright nicht steuern,
 * daher nur über die Bedienungshilfen-Ansicht (uiautomator) – liest Texte vom Bildschirm und tippt wie ein Mensch.
 * Prüft: Kalender erscheint (JavaScript läuft), Test-Benachrichtigung kommt bei geschlossener App, Teilen-Menü öffnet sich.
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
const find = async (re, secs = 20) => {
  for (let i = 0; i < secs; i++) {
    const all = nodes().filter((x) => re.test(x.text) || re.test(x.desc));
    if (all.length) return all.find((x) => /Button/.test(x.cls)) || all[0];
    await sleep(1000);
  }
  throw new Error('nicht gefunden: ' + re + ' | sichtbar: ' + nodes().map((x) => x.text || x.desc).filter(Boolean).slice(0, 30).join(' | '));
};
const tap = async (re, secs) => { const n = await find(re, secs); sh(`input tap ${n.x} ${n.y}`); await sleep(1500); return n; };
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
  await step('Einstellungen → Erinnerungen am Gerät einschalten', async () => {
    await tap(/^Einstellungen$/);
    await tap(/^Erinn\.?$|^Erinnerungen$/);
    await tap(/Erinnerungen auf diesem Gerät/);
    await find(/Test-Benachrichtigung in 1 Minute/, 15);
    snap('erinnerungen');
  });
  await step('Test-Benachrichtigung kommt bei geschlossener App an', async () => {
    await tap(/Test-Benachrichtigung in 1 Minute/);
    sh('input keyevent KEYCODE_HOME');
    for (let i = 0; i < 60; i++) { if (delivered(/Test vom Familienkalender/)) { snap('benachrichtigung'); return `nach ~${i * 3} s im Hintergrund`; } await sleep(3000); }
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
