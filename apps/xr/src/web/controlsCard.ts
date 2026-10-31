// Desktop-only HTML: mouse and keyboard controls for the 3D viewer (src/input/desktop.ts), folded away by default
// so no instructions sit permanently over the model.

const KEYS: { keys: string; does: string }[] = [
  { keys: "Click", does: "press a button, pick a feature" },
  { keys: "Drag model", does: "turn it" },
  { keys: "Wheel", does: "zoom" },
  { keys: "0–9 · ⌫", does: "pairing code" },
  { keys: "Enter", does: "pair · start · investigate" },
  { keys: "Hold Space", does: "talk" },
  { keys: "Q / E · + / −", does: "turn · zoom" },
  { keys: "R", does: "reset view" },
];

export function controlsCard(): HTMLElement {
  const card = document.createElement("details");
  card.className = "controls";
  card.innerHTML = `<summary>Controls</summary><dl>${KEYS.map((k) => `<dt>${k.keys}</dt><dd>${k.does}</dd>`).join("")}</dl>`;
  return card;
}
