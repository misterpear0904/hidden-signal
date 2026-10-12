// Single source of truth for the client↔server contract version.
// Bump this integer whenever the socket protocol or shared state shape
// changes (new events, renamed/added state fields, new lobby options).
// The client embeds it at build time (see client/scripts/gen-build-info.mjs)
// and prompts for refresh when the server reports a different one.
export const PROTOCOL_VERSION = 1;
