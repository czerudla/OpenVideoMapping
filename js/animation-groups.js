// Skupiny animací v pořadí, v jakém se zobrazí v editoru.
// Animace si skupinu určuje polem `group` ve svém souboru. Nová skupina je vědomé rozhodnutí.
export const ANIMATION_GROUPS = [
  { id: 'basic', name: 'Základní' },
  { id: 'outline', name: 'Obrysy a hrany' },
  { id: 'nature', name: 'Příroda a živly' },
  { id: 'show', name: 'Show a oslavy' },
  { id: 'retro', name: 'Retro a popkultura' },
  { id: 'games', name: 'Hry' },
  { id: 'sim', name: 'Simulace' },
  { id: 'automata', name: 'Buněčné automaty' },
];

// Záložní skupina pro animace bez platné skupiny (není v ANIMATION_GROUPS, zobrazí se na konci).
export const FALLBACK_GROUP = { id: 'other', name: 'Ostatní' };
