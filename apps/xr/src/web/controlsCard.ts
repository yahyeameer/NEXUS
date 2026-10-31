// Desktop-only HTML: the card listing mouse and keyboard controls for the emulator (src/input/desktop.ts).

const KEYS: { keys: string; does: string }[] = [
  { keys: "Click", does: "press a button, pick a feature" },
  { keys: "Drag terrain", does: "turn it" },
  { keys: "Wheel", does: "zoom" },
  { keys: "0–9 · ⌫", does: "pairing code" },
  { keys: "Enter", does: "pair · start · investigate" },
  { keys: "Hold Space", does: "talk" },
  { keys: "Q / E · + / −", does: "turn · zoom" },
  { keys: "R", does: "reset view" },
];

export function controlsCard(): HTMLElement {
  const card = document.createElement("aside");
  card.className = "controls";
  card.innerHTML = `<h2>Desktop controls</h2><dl>${KEYS.map((k) => `<dt>${k.keys}</dt><dd>${k.does}</dd>`).join("")}</dl>`;
  return card;
}
