// S003-AC-14 (chooser): the track chooser is a real button, reachable with Tab and activated with Enter or
// Space (native buttons turn both into a click), and it switches between the test lot and Interlagos.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOT_TRACK_ID as LOT_ID, TRACK_CHOICES } from '../../src/run.ts';
import { bindTrackChooser, nextTrack, type ButtonLike } from '../../src/ui/track-chooser.ts';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function fakeButton(): ButtonLike & { attrs: Record<string, string>; click(): void } {
  const listeners: (() => void)[] = [];
  const b = {
    textContent: '' as string | null,
    attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) {
      b.attrs[k] = v;
    },
    addEventListener(type: 'click', fn: () => void) {
      if (type === 'click') listeners.push(fn);
    },
    click: () => listeners.forEach((fn) => fn()),
  };
  return b;
}

describe('track options', () => {
  it('offers the test lot first, then every shipped track', () => {
    expect(TRACK_CHOICES).toEqual([
      { id: LOT_ID, name: 'Pátio de testes' },
      { id: 'interlagos', name: 'Interlagos' },
    ]);
  });

  it('cycles through the options and wraps round', () => {
    const opts = TRACK_CHOICES;
    expect(nextTrack(opts, LOT_ID).id).toBe('interlagos');
    expect(nextTrack(opts, 'interlagos').id).toBe(LOT_ID);
    expect(nextTrack(opts, 'unknown').id).toBe(LOT_ID);
  });
});

describe('track chooser button', () => {
  it('names the current track and the next one, and switches on activation', () => {
    const button = fakeButton(), chosen: string[] = [];
    const chooser = bindTrackChooser(button, TRACK_CHOICES, LOT_ID, (id) => chosen.push(id));
    expect(button.textContent).toBe('Pista: Pátio de testes');
    expect(button.attrs['aria-label']).toBe('Pista: Pátio de testes. Trocar para Interlagos e reiniciar.');
    button.click();
    expect(chosen).toEqual(['interlagos']);
    expect(chooser.current()).toBe('interlagos');
    expect(button.textContent).toBe('Pista: Interlagos');
    button.click();
    expect(chosen).toEqual(['interlagos', LOT_ID]);
    expect(button.textContent).toBe('Pista: Pátio de testes');
  });

  it('starts on a known option even when given an unknown id', () => {
    const button = fakeButton();
    expect(bindTrackChooser(button, TRACK_CHOICES, 'nope', () => {}).current()).toBe(LOT_ID);
  });

  it('is a native, enabled button in the page tab order', () => {
    const tag = html.match(/<button[^>]*id="tk"[^>]*>/)?.[0];
    expect(tag, 'index.html has <button id="tk">').toBeDefined();
    expect(tag).toMatch(/type="button"/);
    expect(tag).not.toMatch(/disabled|tabindex="-/);
  });
});
