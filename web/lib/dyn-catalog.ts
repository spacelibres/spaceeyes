export const dynCatalog = {
  "earth-orb": {
    source: "https://eyes.nasa.gov/assets/dynamic/dynamo/earth/sun/orb/def.dyn",
    bytes: 30916,
    sha256: "5c31b43bcd091f63c314da053595f67ea4277f9a71584e2a901983cf8041a580",
  },
  "earth-ori": {
    source: "https://eyes.nasa.gov/assets/dynamic/dynamo/earth/ori/def.dyn",
    bytes: 204,
    sha256: "bb6b0384b9b0c17f2ed49b1b458758dbd731e1b3e27477afdc6a11fe9d0bd877",
  },
} as const;
export type DynId = keyof typeof dynCatalog;
