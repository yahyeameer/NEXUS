// Desktop-only HTML: the emulator's voice window. It shows the same voice state as the headset's voice panel (idle,
// listening with your live mic level, an agent speaking) and holds the typed stand-in for speech. Conventional web UI
// lives in src/web, apart from the spatial design system in src/ui/spatial; nothing here is ever shown in a headset.

export type VoiceBoxMode = "idle" | "listening" | "speaking";

export interface VoiceBox {
  /** The typed words, taken once on push-to-talk release. */
  take(): string | undefined;
  /** Voice state and, while speaking, who. */
  state(mode: VoiceBoxMode, speaker?: string): void;
  /** Where the live mic level (0..1) comes from while listening. */
  levelSource(fn: () => number): void;
}

const BARS = 14;

const STATE_TEXT: Record<VoiceBoxMode, string> = {
  idle: "Hold Space or the wrist button to talk",
  listening: "Listening… release to send",
  speaking: "Speaking",
};

/** A desktop voice window with the typed "speech" box, clearly labelled as simulated (AGENTS.md rule 7 spirit). */
export function simulatedSpeechBox(): VoiceBox {
  const box = document.createElement("form");
  box.className = "sim-speech";
  box.dataset.mode = "idle";
  box.innerHTML = `
    <div class="voice-head" aria-live="polite">
      <div class="voice-orb" aria-hidden="true"><i></i><i></i><i></i><b></b></div>
      <div class="voice-text">
        <p class="voice-title">Voice</p>
        <p class="voice-state">${STATE_TEXT.idle}</p>
      </div>
      <div class="voice-bars" aria-hidden="true">${Array.from({ length: BARS }, (_, i) => `<span style="--k:${(0.45 + 0.55 * Math.abs(Math.sin(i * 1.7))).toFixed(2)};--d:${(i * 70) % 490}ms"></span>`).join("")}</div>
    </div>
    <label for="sim-speech">Simulated speech <span>(emulator only)</span></label>
    <input id="sim-speech" name="speech" autocomplete="off" placeholder="e.g. investigate this" maxlength="500" />
    <small>On release this text is sent as your words. Your desktop mic still streams while held.</small>`;
  box.addEventListener("submit", (e) => e.preventDefault());
  document.body.append(box);
  const input = box.querySelector("input");
  const stateEl = box.querySelector<HTMLElement>(".voice-state");
  let level: () => number = () => 0;
  let raf = 0;
  const pump = () => {
    // Eased so the bars rise fast and fall gently; a desktop helper, so a rAF loop only while listening is fine.
    const now = Number(box.style.getPropertyValue("--level") || 0);
    const target = Math.min(1, level());
    box.style.setProperty("--level", (now + (target - now) * (target > now ? 0.5 : 0.15)).toFixed(3));
    raf = requestAnimationFrame(pump);
  };
  return {
    take: () => {
      const text = input?.value.trim();
      if (input) input.value = "";
      return text || undefined;
    },
    state: (mode, speaker) => {
      if (box.dataset.mode === mode && (mode !== "speaking" || stateEl?.dataset.speaker === speaker)) return;
      box.dataset.mode = mode;
      if (stateEl) {
        stateEl.textContent = mode === "speaking" && speaker ? `${speaker} is speaking` : STATE_TEXT[mode];
        stateEl.dataset.speaker = speaker ?? "";
      }
      cancelAnimationFrame(raf);
      box.style.setProperty("--level", "0");
      if (mode === "listening") raf = requestAnimationFrame(pump);
    },
    levelSource: (fn) => {
      level = fn;
    },
  };
}
