// Spatial voices (VOICE.md §6, PRD §6.4): who speaks with which voice, and from where.

export type VoiceId = "narrator" | "voiceA" | "voiceB" | "voiceC" | "voiceD";
/** Where the orb sits relative to the site; the XR client turns this into a PannerNode position. */
export type OrbPlacement = "fixed_front_left" | "feature_floor" | "above_site" | "beside_site" | "opposite_side";

export interface VoiceProfile {
  voice: VoiceId;
  placement: OrbPlacement;
}

const BY_AGENT: Readonly<Record<string, VoiceProfile>> = {
  // Terrain / elevation
  lola_elevation_researcher: { voice: "voiceA", placement: "feature_floor" },
  terrain_model_analyst: { voice: "voiceA", placement: "feature_floor" },
  // Imagery
  lroc_imagery_researcher: { voice: "voiceB", placement: "above_site" },
  lunar_image_analyst: { voice: "voiceB", placement: "above_site" },
  video_frame_analyst: { voice: "voiceB", placement: "above_site" },
  visual_comparison_researcher: { voice: "voiceB", placement: "above_site" },
  // Geology / hypothesis
  lunar_geology_researcher: { voice: "voiceC", placement: "beside_site" },
  impact_crater_researcher: { voice: "voiceC", placement: "beside_site" },
  lunar_volcanism_researcher: { voice: "voiceC", placement: "beside_site" },
  historical_observation_researcher: { voice: "voiceC", placement: "beside_site" },
  hypothesis_generator: { voice: "voiceC", placement: "beside_site" },
  // Skeptic
  alternative_explanation_researcher: { voice: "voiceD", placement: "opposite_side" },
};

const NARRATOR: VoiceProfile = { voice: "narrator", placement: "fixed_front_left" };

/** `speaker` is "narrator" or "agent:<catalog id>"; unknown agents speak as the narrator. */
export function voiceFor(speaker: string): VoiceProfile {
  if (!speaker.startsWith("agent:")) return NARRATOR;
  return BY_AGENT[speaker.slice("agent:".length).replace(/^\d+_/, "")] ?? NARRATOR;
}

/** Narration ducks video and ambience by 12 dB (VOICE.md §6). */
export const DUCKING_DB = -12;
