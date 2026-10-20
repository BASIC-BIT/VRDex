/** Test deployment bindings are explicit; ordinary event ownership is not a secret grant. */
export function bindVrcdnTestAccount(ownerCommunityProfileId: string, credentialRef: string) {
  process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = JSON.stringify([{ key: 'test-owned', label: 'Test output', credentialRef, ownerCommunityProfileId, playbackLinks: [] }]);
}
