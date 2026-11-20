import { describe, expect, it } from 'vitest';
import { registryKey, suggestTopic, topicAllowed, topicPrefix } from '../familyKey';
import { ntfyFor, type Config } from '../../../reminders/core';

const cfg: Config = { apiKey: 'k', projectId: 'p', familyId: 'aaaaaaaaaaaaaaaaaa', ntfyServer: 'https://ntfy.example', ntfyToken: 'geheim', timezone: 'Europe/Vienna' };

describe('Trennung zwischen Familien', () => {
  it('Präfix und Verzeichnisschlüssel sind je Familie verschieden und stabil', async () => {
    const a = await topicPrefix('familieaaaaaaaaaaa'), b = await topicPrefix('familiebbbbbbbbbbb');
    expect(a).toMatch(/^fk-[a-z2-9]{12}$/);
    expect(a).not.toBe(b);
    expect(await topicPrefix('familieaaaaaaaaaaa')).toBe(a);
    expect(await registryKey('familieaaaaaaaaaaa')).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain('familie');
  });
  it('Topics: nur mit dem eigenen Präfix', async () => {
    const p = await topicPrefix('familieaaaaaaaaaaa');
    expect(suggestTopic(p, 'Mama Müller')).toBe(`${p}-mama-muller`);
    expect(topicAllowed(`${p}-mama`, p)).toBe(true);
    expect(topicAllowed('mama', p)).toBe(false);
    expect(topicAllowed(`${p}x-mama`, p)).toBe(false);
  });
  it('Versand: nur über den Server aus den Einstellungen, nie mit Token des Dienstes, Topics mit Präfix', () => {
    const p = { ...cfg, topicPrefix: 'fk-abc' };
    const ohne = ntfyFor(p, {});
    expect(ohne.missingServer).toBe(true);
    expect(ohne.allowed('fk-abc-mama')).toBe(false);
    expect(ohne.cfg.ntfyToken).toBeUndefined();
    expect(ntfyFor(p, { ntfyServer: 'http://unsicher.example' }).missingServer).toBe(true);
    const eigen = ntfyFor(p, { ntfyServer: 'https://ntfy.sh', ntfyToken: 'tk_fam' });
    expect(eigen.cfg.ntfyServer).toBe('https://ntfy.sh');
    expect(eigen.cfg.ntfyToken).toBe('tk_fam');
    expect(eigen.allowed('fk-abc-mama')).toBe(true);
    expect(eigen.allowed('mama')).toBe(false);
    expect(eigen.allowed('fk-abcx-mama')).toBe(false);
    expect(ntfyFor(p, { ntfyServer: 'https://ntfy.sh' }).cfg.ntfyToken).toBeUndefined(); // nie der Token des Dienstes
    // Übergang: alte Topics ohne Präfix noch erlaubt
    const ueb = ntfyFor({ ...p, allowUnprefixed: true }, { ntfyServer: 'https://ntfy.example' });
    expect(ueb.allowed('mama')).toBe(true);
    expect(ueb.allowed('fk-abc-mama')).toBe(true);
  });
});
