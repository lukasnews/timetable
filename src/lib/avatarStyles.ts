/**
 * Die eigentlichen Comic-Stile (groß, ~1 MB) – werden nach dem Start nachgeladen, siehe avatars.ts.
 */
export { createAvatar } from '@dicebear/core';
import * as adventurer from '@dicebear/adventurer';
import * as avataaars from '@dicebear/avataaars';
import * as bigSmile from '@dicebear/big-smile';
import * as funEmoji from '@dicebear/fun-emoji';
import * as lorelei from '@dicebear/lorelei';
import * as micah from '@dicebear/micah';
import * as openPeeps from '@dicebear/open-peeps';
import * as toonHead from '@dicebear/toon-head';
import * as bottts from '@dicebear/bottts';

export const STYLE_MODULES = { adventurer, bigSmile, toonHead, avataaars, micah, lorelei, openPeeps, funEmoji, bottts } as const;
