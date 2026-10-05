// Track chooser (S003-T7): one native button that switches between the test lot and the shipped tracks.
// A native <button> is reachable with Tab and turns Enter and Space into a click, so the keyboard alone works.

export interface TrackOption {
  readonly id: string;
  readonly name: string;
}

// The option list itself is TRACK_CHOICES in src/run.ts (test lot first, then every shipped track).

/** The option after `id`, wrapping round; an unknown id gives the first option. */
export function nextTrack(options: readonly TrackOption[], id: string): TrackOption {
  const i = options.findIndex((o) => o.id === id);
  return options[i < 0 ? 0 : (i + 1) % options.length]!;
}

/** The part of a button the chooser uses; an HTMLButtonElement satisfies it. */
export interface ButtonLike {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: 'click', listener: () => void): void;
}

/** Wires the button: it names the current track, and each activation picks the next one and calls `onChange`. */
export function bindTrackChooser(
  button: ButtonLike,
  options: readonly TrackOption[],
  initial: string,
  onChange: (id: string) => void,
): { current(): string } {
  if (options.length === 0) throw new Error('track chooser needs at least one option');
  let current = options.find((o) => o.id === initial) ?? options[0]!;
  const show = () => {
    const label = 'Pista: ' + current.name;
    button.textContent = label;
    // The accessible name starts with the visible text and says what activation does.
    button.setAttribute('aria-label', label + '. Trocar para ' + nextTrack(options, current.id).name + ' e reiniciar.');
  };
  show();
  button.addEventListener('click', () => {
    current = nextTrack(options, current.id);
    show();
    onChange(current.id);
  });
  return { current: () => current.id };
}
