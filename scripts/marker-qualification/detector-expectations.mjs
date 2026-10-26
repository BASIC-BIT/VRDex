// Complete construction/authority DATA; the whole original is charged.
export function createMinimumEpisodeVectors() {
  return {"1439": [0,1439,1919,0,2],"1440": [0,1440,1920,0,2],"1441": [0,1440,1441,0,1]};
}
export const MINIMUM_OBSERVATION_RULES = Object.freeze({
  quietSamples: 480,
  metadataRows: 2,
  insufficientNominal: 1439,
  tailNominal: 1441,
  ordinaryBlocks: 4,
  tailBlocks: 5,
});
