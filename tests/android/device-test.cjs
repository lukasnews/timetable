/**
 * Gerätetest der Android-App im Emulator (läuft in GitHub Actions, siehe .github/workflows/android-device-test.yml).
 * Prüft echte Android-Funktionen: Benachrichtigung kommt bei geschlossener App zur richtigen Uhrzeit,
 * Erinnerung + Tages-/Wochenübersicht werden eingeplant, „Sicherung speichern“ öffnet das Teilen-Menü,
 * das Widget lässt sich hinzufügen und zeigt die Termine.
 */
const { _android: android } = require('playwright');
const fs = require('fs');
const PKG = 'com.javuno.timetable';
const OUT = process.env.OUT || 'android-test';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Notbremse: nie länger als 25 Minuten hängen
setTimeout(() => {
  const md = '# Android-Gerätetest ❌\n\n- ❌ Abbruch: Zeitüberschreitung (25 min)\n';
  try { fs.writeFileSync(`${OUT}/bericht.md`, md); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); } catch { /* egal */ }
  console.error('Zeitüberschreitung'); process.exit(1);
}, 25 * 60 * 1000).unref();

(async () => {
  const [dev] = await android.devices();
  if (!dev) throw new Error('kein Emulator gefunden');
  // adb-Verbindung zum Emulator reißt gelegentlich kurz ab → bis zu 3 Versuche
  const sh = async (c) => { for (let i = 0; ; i++) { try { return String(await dev.shell(c)); } catch (e) { if (i >= 2) throw e; await sleep(2000); } } };
  let shot = 0;
  const snap = async (name) => { try { fs.writeFileSync(`${OUT}/${String(++shot).padStart(2, '0')}-${name}.png`, await dev.screenshot()); } catch { /* egal */ } };
  const step = async (name, fn) => {
    try { const info = await fn(); results.push({ name, ok: true, info: info || '' }); console.log('✓', name, info || ''); }
    catch (e) { results.push({ name, ok: false, info: String(e && e.message || e).split('\n')[0] }); console.log('✗', name, String(e)); await snap('fehler'); }
  };
  /** Sichtbare Bedienelemente des Systems (uiautomator) */
  const nodes = async () => {
    await sh('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1');
    const xml = await sh('cat /sdcard/ui.xml');
    return [...xml.matchAll(/<node [^>]*>/g)].map((m) => {
      const a = (k) => (m[0].match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] || '';
      const b = a('bounds').match(/\d+/g)?.map(Number) || [0, 0, 0, 0];
      return { text: a('text'), desc: a('content-desc'), pkg: a('package'), cls: a('class'), x: (b[0] + b[2]) >> 1, y: (b[1] + b[3]) >> 1 };
    });
  };
  const tapNode = async (re) => {
    for (let i = 0; i < 10; i++) {
      const all = (await nodes()).filter((x) => re.test(x.text) || re.test(x.desc));
      const n = all.find((x) => /Button/.test(x.cls)) || all[0]; // Schaltfläche vor gleichlautender Überschrift
      if (n) { await sh(`input tap ${n.x} ${n.y}`); return n; }
      await sleep(1000);
    }
    throw new Error('nicht gefunden: ' + re);
  };

  // Rechte wie nach „Erlauben“ durch den Nutzer
  await sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`).catch(() => {});
  await sh(`appops set ${PKG} SCHEDULE_EXACT_ALARM allow`).catch(() => {});
  console.log('System-WebView:', (await sh('dumpsys package com.google.android.webview | grep versionName | head -1')).trim());
  console.log('Zeitzone Gerät:', (await sh('getprop persist.sys.timezone')).trim(), '·', (await sh('date')).trim());

  console.log('starte App …');
  await sh(`am start -n ${PKG}/.MainActivity`);
  console.log('App gestartet, verbinde mit WebView …');
  // Beim allerersten Start lädt sich die App nach dem Einrichten des Offline-Speichers ggf. einmal neu –
  // dabei geht die Verbindung zur WebView verloren, also neu verbinden, bis der Kalender sichtbar ist.
  const errors = [];
  const startErrors = [];
  let page;
  const deadline = Date.now() + 180000;
  for (;;) {
    try {
      const wv = await dev.webView({ pkg: PKG }, { timeout: 60000 });
      page = await wv.page();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) => startErrors.push(String(e).slice(0, 200)));
      page.on('console', (m) => { if (m.type() === 'error') startErrors.push('console: ' + m.text().slice(0, 200)); });
      await page.waitForSelector('.fc', { state: 'visible', timeout: 30000 });
      await sleep(4000);
      if (!page.isClosed() && (await page.locator('.fc').isVisible())) break;
    } catch (e) {
      if (Date.now() > deadline) {
        let diag = '';
        try {
          diag = await page.evaluate(() => {
            const info = (sel) => { const e = document.querySelector(sel); if (!e) return `${sel}:–`; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
              return `${sel}:${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)} d=${cs.display} h=${cs.height} rows=${cs.gridTemplateRows || ''}`; };
            return [navigator.userAgent, `${innerWidth}x${innerHeight}`, ...['.app', '.hints', '.toolbar', '.main', '.cal-inner', '.fc', '.fc-view-harness'].map(info),
              'errs=' + (window.__errs || []).join(' ; ')].join(' | ');
          });
        } catch (e2) { diag = 'diag-fehler ' + e2; }
        await snap('start-fehler');
        throw new Error('Kalender erscheint nicht: ' + String(e).split('\n')[0] + ' | ' + diag + ' | Fehler: ' + startErrors.join(' ; '));
      }
      await sleep(3000);
    }
  }
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  console.log('WebView:', await page.evaluate(() => navigator.userAgent));

  const native = await page.evaluate(() => !!window.Capacitor?.isNativePlatform?.());
  await step('App startet als native Android-App', async () => { if (!native) throw new Error('Capacitor nicht nativ'); return await page.title(); });
  await snap('start');

  const openSettings = async (tab) => {
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('button[aria-label="Einstellungen"]').first().click();
    await page.locator('.modal nav.tabs button', { hasText: tab }).first().click();
    await sleep(800);
  };
  const toggle = async (label, on = true) => {
    const box = page.locator('label.toggle-row', { hasText: label }).first().locator('input.switch');
    if ((await box.isChecked()) !== on) await box.click();
    await sleep(800);
  };
  const closeModal = async () => { for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) { await page.keyboard.press('Escape'); await sleep(400); } };

  // Uhrzeit am Gerät in ein paar Minuten (5-Minuten-Raster wie im Termin-Dialog)
  const local = async () => page.evaluate(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), min: d.getMinutes(), s: d.getSeconds() }; });
  const t0 = await local();
  let mins = t0.h * 60 + t0.min + 4;
  mins = Math.ceil(mins / 5) * 5;
  if (mins >= 24 * 60 - 10) mins = 24 * 60 - 10; // knapp vor Mitternacht
  const hhmm = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  const soon = hhmm(mins);

  await step('Erinnerungen am Gerät einschalten', async () => {
    await openSettings('Erinn');
    await toggle('Erinnerungen auf diesem Gerät');
    await toggle('Tagesübersicht');
    await toggle('Wochenübersicht');
    await snap('erinnerungen');
    await closeModal();
  });

  await step(`Termin heute ${soon} mit Erinnerung „Zum Beginn“ anlegen`, async () => {
    await page.getByLabel('Neuer Termin').first().click();
    await page.locator('.title-input').fill('Gerätetest jetzt');
    await page.locator('.modal input[type=time]').first().fill(soon);
    await page.locator('.modal input[type=time]').nth(1).fill(hhmm(Math.min(mins + 30, 24 * 60 - 5)));
    await page.getByRole('button', { name: 'Erinnerung hinzufügen' }).click();
    await page.getByRole('button', { name: 'Zum Beginn', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Speichern' }).click();
    await sleep(1500);
    if (!(await page.locator('body').innerText()).includes('Gerätetest jetzt')) throw new Error('nicht im Kalender');
  });

  await step('Wöchentlichen Termin ab morgen 10:00 mit Erinnerungen 1 Stunde und 15 Minuten vorher anlegen', async () => {
    await page.getByLabel('Neuer Termin').first().click();
    await page.locator('.title-input').fill('Morgen 10 Uhr Gerätetest');
    await sleep(500);
    await page.getByRole('button', { name: 'Wöchentl.' }).click();
    // Zwei Erinnerungen: 15 Minuten und 1 Stunde vorher
    await page.getByRole('button', { name: 'Erinnerung hinzufügen' }).click();
    await page.getByRole('button', { name: '15 Minuten vorher', exact: true }).click();
    await page.getByRole('button', { name: 'Erinnerung hinzufügen' }).click();
    await page.getByRole('button', { name: '1 Stunde vorher', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Speichern' }).click();
    await sleep(3000);
  });

  let planned = '';
  await step('Erinnerungen und Übersichten sind am Gerät eingeplant (richtige Uhrzeit)', async () => {
    await openSettings('Erinn');
    await sleep(6000); // Liste aktualisiert sich alle 5 s
    const sum = page.locator('summary', { hasText: 'Eingeplante anzeigen' });
    await sum.click();
    planned = await page.locator('details.tips', { has: sum }).innerText();
    await snap('eingeplant');
    const need = [[soon, 'Gerätetest jetzt'], ['09:00', 'Gerätetest'], ['09:45', 'Gerätetest'], ['06:30', 'Heute:']];
    const miss = need.filter(([t, s]) => !planned.split('\n').some((l) => l.includes(t) && l.includes(s)));
    if (miss.length) throw new Error('fehlt: ' + miss.map((x) => x.join(' ')).join('; ') + ' | Liste: ' + planned.replace(/\n/g, ' / ').slice(0, 400));
    return planned.split('\n').length - 2 + ' Einträge';
  });
  await step('Wochenübersicht eingeplant (Sonntag 18:00)', async () => {
    if (!/18:00 – Nächste Woche: /.test(planned)) throw new Error('keine Wochenübersicht: ' + planned.replace(/\n/g, ' / ').slice(0, 300));
  });

  await step('Test-Benachrichtigung planen', async () => {
    await page.getByRole('button', { name: /Test-Benachrichtigung/ }).click();
    await sleep(800);
  });

  await step('„Sicherung speichern“ öffnet das Android-Teilen-Menü', async () => {
    await page.locator('.modal nav.tabs button', { hasText: 'Daten' }).first().click();
    await sleep(800);
    await page.getByRole('button', { name: /Sicherung speichern/ }).click();
    for (let i = 0; i < 15; i++) {
      const top = await sh('dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity|ResumedActivity" | head -3');
      if (/Chooser|Resolver|intentresolver/i.test(top)) { await snap('teilen'); await sh('input keyevent KEYCODE_BACK'); await sleep(1500); return top.trim().split('\n')[0].trim(); }
      await sleep(1000);
    }
    throw new Error('kein Teilen-Menü: ' + (await sh('dumpsys activity activities | grep -E "ResumedActivity" | head -2')).trim());
  });

  await step('Widget über die Einstellungen zum Startbildschirm hinzufügen', async () => {
    await openSettings('Erinn');
    const btn = page.getByRole('button', { name: 'Zum Startbildschirm hinzufügen' });
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await sleep(2500);
    await snap('widget-dialog');
    const n = await tapNode(/^(add automatically|add to home screen|add|hinzufügen|automatisch hinzufügen)$/i);
    await sleep(2500);
    return 'bestätigt: ' + n.text;
  });

  // App in den Hintergrund: ab jetzt muss alles ohne offene App funktionieren
  await sh('input keyevent KEYCODE_HOME');
  await sleep(4000);

  await step('Widget am Startbildschirm zeigt die Termine', async () => {
    for (let i = 0; i < 10; i++) {
      const texts = (await nodes()).map((x) => x.text).filter(Boolean);
      if (texts.some((t) => t.includes('Gerätetest'))) { await snap('widget'); return texts.filter((t) => /Gerätetest|Heute|Morgen/.test(t)).slice(0, 6).join(' | '); }
      await sleep(1500);
    }
    await snap('startbildschirm');
    const all = (await nodes()).map((x) => `${x.text || x.desc}`).filter(Boolean).slice(0, 40).join(' | ');
    const aw = (await sh('dumpsys appwidget | grep -A3 -i "com.javuno.timetable" | head -20')).replace(/\s+/g, ' ').slice(0, 600);
    throw new Error('Termin nicht im Widget. Bildschirm: ' + all + ' || appwidget: ' + aw);
  });

  const delivered = async (re) => {
    const d = await sh('dumpsys notification --noredact');
    return d.split(/\n\s*NotificationRecord/).filter((b) => b.includes(`pkg=${PKG}`)).some((b) => re.test(b));
  };
  await step('Test-Benachrichtigung kommt bei geschlossener App an', async () => {
    for (let i = 0; i < 60; i++) { if (await delivered(/Test vom Familienkalender/)) { await snap('test-benachrichtigung'); return `nach ~${i * 3 + 10} s im Hintergrund`; } await sleep(3000); }
    throw new Error('nicht angekommen');
  });

  await step(`Erinnerung „Gerätetest jetzt“ kommt pünktlich um ${soon}`, async () => {
    const until = Date.now() + 12 * 60 * 1000;
    while (Date.now() < until) {
      if (await delivered(/Gerätetest jetzt/)) {
        const t = (await sh('date +%H:%M:%S')).trim();
        await sh('cmd statusbar expand-notifications').catch(() => {}); await sleep(1500); await snap('erinnerung'); await sh('cmd statusbar collapse').catch(() => {});
        const [h, m] = t.split(':').map(Number); const diff = h * 60 + m - mins;
        if (diff < 0 || diff > 2) throw new Error(`zur falschen Zeit angekommen: ${t} statt ${soon}`);
        return `angekommen um ${t}`;
      }
      await sleep(5000);
    }
    throw new Error('nicht angekommen');
  });

  await step('Keine Fehler in der App', async () => { if (errors.length) throw new Error(errors.join(' | ')); });

  const ok = results.every((r) => r.ok);
  const md = [`# Android-Gerätetest ${ok ? '✅' : '❌'}`, '', `Gerät: ${(await sh('getprop ro.product.model')).trim()}, Android ${(await sh('getprop ro.build.version.release')).trim()}, Zeitzone ${(await sh('getprop persist.sys.timezone')).trim()}`, '',
    ...results.map((r) => `- ${r.ok ? '✅' : '❌'} ${r.name}${r.info ? ` — ${r.info}` : ''}`)].join('\n');
  fs.writeFileSync(`${OUT}/bericht.md`, md + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log(md);
  await dev.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  const md = `# Android-Gerätetest ❌\n\n- ❌ Abbruch: ${String(e && e.message || e).split('\n')[0]}\n`;
  try { fs.writeFileSync(`${OUT}/bericht.md`, md); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); } catch { /* egal */ }
  process.exit(1);
});
