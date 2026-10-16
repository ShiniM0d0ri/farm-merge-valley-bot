// The game's Nakama credentials and the player's Discord id - all from the environment.
//
// Nothing is hardcoded here: see `.env.example` for the keys and the README's "Secrets" section for
// how each value is obtained. `FMV_KEY` and `FMV_APP_ID` are game-wide (the client ships them);
// `FMV_DISCORD_ID` identifies *your* account and is the one value that is personal.
import { requireEnv } from './env.js';

/** Nakama server key (`Authorization: Basic base64("<key>:")`). */
export const SERVER_KEY = process.env.FMV_KEY || '';
/** Your Discord user id - which account the bot drives. */
export const DISCORD_ID = process.env.FMV_DISCORD_ID || '';
/** The Activity's Discord application id (also the `*.discordsays.com` subdomain). */
export const APP_ID = process.env.FMV_APP_ID || '';

/** Throw with instructions when the live paths are used without credentials. */
export function requireCreds() {
  requireEnv(['FMV_KEY', 'FMV_DISCORD_ID'], 'see README "Secrets"');
}
