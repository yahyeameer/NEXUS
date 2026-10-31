// Desktop-only HTML: the emulator's typed stand-in for speech. Conventional web UI lives in src/web, apart from the
// spatial design system in src/ui/spatial; nothing here is ever shown in a headset.

/** A small desktop box for typed "speech", clearly labelled as simulated (AGENTS.md rule 7 spirit). */
export function simulatedSpeechBox(): () => string | undefined {
  const box = document.createElement("form");
  box.className = "sim-speech";
  box.innerHTML = `
    <label for="sim-speech">Simulated speech <span>(emulator only)</span></label>
    <input id="sim-speech" name="speech" autocomplete="off" placeholder="e.g. investigate this" maxlength="500" />
    <small>Hold “Hold to talk” on the wrist menu; on release this text is sent as your words. Your desktop mic still streams while held.</small>`;
  box.addEventListener("submit", (e) => e.preventDefault());
  document.body.append(box);
  const input = box.querySelector("input");
  return () => {
    const text = input?.value.trim();
    if (input) input.value = "";
    return text || undefined;
  };
}
