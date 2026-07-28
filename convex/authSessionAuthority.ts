import { query } from "./_generated/server";
import {
  activeBrowserSessionOrNull,
  browserSessionState,
} from "./_browserSessionAuthority";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const activeSession = await activeBrowserSessionOrNull(ctx);

    if (activeSession === null) {
      return null;
    }

    return {
      sessionId: activeSession.sessionId,
      user: {
        id: activeSession.user._id,
        name: activeSession.user.name,
        email: activeSession.user.email,
        emailVerified:
          activeSession.user.emailVerificationTime !== undefined,
        image: activeSession.user.image,
      },
    };
  },
});

export const status = query({
  args: {},
  handler: browserSessionState,
});
