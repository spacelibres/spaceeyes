import type { CameraObservationOptions } from "../../platform/camera-contract.ts";

// Reviewed display framing only: this does not define a sensor optical axis.
const skyMissions = new Set([
  "sc_chandra",
  "sc_euclid",
  "sc_hubble_space_telescope",
  "sc_ixpe",
  "sc_jwst",
  "sc_kepler_space_telescope",
  "sc_nustar",
  "sc_roman_space_telescope",
  "sc_spherex",
  "sc_spitzer",
  "sc_tess",
]);
const solarObservers = new Set([
  "sc_sdo",
  "sc_soho",
  "sc_stereo_ahead",
  "sc_stereo_behind",
  "sc_parker_solar_probe",
]);

export function missionInitialLook(
  id: string,
  parent: string | null,
): CameraObservationOptions["initialLook"] {
  if (!id.startsWith("sc_")) return undefined;
  if (skyMissions.has(id))
    return parent ? { kind: "sky", referenceId: parent } : undefined;
  if (solarObservers.has(id)) return { kind: "target", referenceId: "sun" };
  // Current planetary orbit gives a useful host-facing external composition.
  // Heliocentric cruise has no implied planetary science target.
  if (parent && parent !== "sun")
    return { kind: "target", referenceId: parent };
  return undefined;
}
