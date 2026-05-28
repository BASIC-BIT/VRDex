import Discord from "@auth/core/providers/discord";
import Google from "@auth/core/providers/google";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { Email } from "@convex-dev/auth/providers/Email";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured before sending auth email.`);
  }

  return value;
}

async function sendSesVerificationCode(email: string, token: string) {
  const region = requiredEnv("AWS_SES_REGION");
  const fromEmail = requiredEnv("AWS_SES_FROM_EMAIL");
  const appName = process.env.VRDEX_APP_NAME?.trim() || "VRDex";
  const client = new SESClient({ region });

  await client.send(
    new SendEmailCommand({
      Source: fromEmail,
      Destination: {
        ToAddresses: [email],
      },
      Message: {
        Subject: {
          Charset: "UTF-8",
          Data: `Your ${appName} verification code`,
        },
        Body: {
          Text: {
            Charset: "UTF-8",
            Data: [
              `Your ${appName} verification code is ${token}.`,
              "",
              "If you did not request this code, you can ignore this email.",
            ].join("\n"),
          },
        },
      },
    }),
  );
}

const SesOtp = Email({
  async sendVerificationRequest({ identifier, token }) {
    await sendSesVerificationCode(identifier, token);
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Discord({
      authorization: {
        params: {
          scope: "identify email",
        },
      },
      profile(profile) {
        const avatar = profile.avatar
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
          : undefined;

        return {
          id: profile.id,
          name: profile.global_name ?? profile.username,
          email: profile.email ?? undefined,
          emailVerified: Boolean(profile.verified && profile.email),
          image: avatar,
        };
      },
    }),
    Google({
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          emailVerified: Boolean(profile.email_verified && profile.email),
          image: profile.picture,
        };
      },
    }),
    Password({
      verify: SesOtp,
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();

        if (!email) {
          throw new Error("Email is required.");
        }

        return { email };
      },
      validatePasswordRequirements(password) {
        if (password.length < 12) {
          throw new Error("Password must be at least 12 characters.");
        }
      },
    }),
  ],
  callbacks: {
    async redirect({ redirectTo }) {
      if (redirectTo.startsWith("/") && !redirectTo.startsWith("//")) {
        return redirectTo;
      }

      throw new Error("Only relative redirects are allowed.");
    },
  },
});
