// Complete construction/authority DATA; the whole original is charged.
export const PROGRAM_SOURCE_CONTRACT = Object.freeze({
  design: "7463c898c2104ce5897830dafabb1e7b0ec88242f54bdfb45771ce6aa703c6c1",
  guards: "54130902985c22ddef115437afe033d4347e66901c17a211295b0e529ad7ef12",
  pins: "f5d04c68d66494a2aaa16056a06a15eea907f6254cafe4e567e97c2964e50417",
  resultSizing: "0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c",
  authorityRebaseline: "42b3ad94be9a551b1f8a97e84ebff0ce65aaac4f6e367a323d1db2f442f014c5",
});

// Ordered whole-body references. No runtime reader belongs in this DATA leaf.
export const PROGRAM_AUTHORITY_REFS = Object.freeze([
  Object.freeze({"key":"design","kind":"audit","id":"program-source-design-rebaseline-v1","bytes":17953,"sha256":"7463c898c2104ce5897830dafabb1e7b0ec88242f54bdfb45771ce6aa703c6c1"}),
  Object.freeze({"key":"guards","kind":"audit","id":"program-source-guards-rebaseline-v1","bytes":21732,"sha256":"54130902985c22ddef115437afe033d4347e66901c17a211295b0e529ad7ef12"}),
  Object.freeze({"key":"pins","kind":"audit","id":"program-native-pins-rebaseline-v1","bytes":15483,"sha256":"f5d04c68d66494a2aaa16056a06a15eea907f6254cafe4e567e97c2964e50417"}),
  Object.freeze({"key":"resultSizing","kind":"audit","id":"program-result-sizing-r94-v1","bytes":41830,"sha256":"0a7214700021178996f717487ce09b513fa8ebfcb70dca6a2bed863abb7a5c3c"}),
  Object.freeze({"key":"authorityRebaseline","kind":"audit","id":"program-authority-rebaseline-v1","bytes":16626,"sha256":"42b3ad94be9a551b1f8a97e84ebff0ce65aaac4f6e367a323d1db2f442f014c5"}),
]);
