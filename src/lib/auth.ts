import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // M2: email verification is off until an email provider is wired (M6).
    requireEmailVerification: false,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      // M2: no Resend key is available, so the reset link is logged
      // server-side for now. TODO(M6 deploy): send this URL to user.email
      // via Resend instead of logging it.
      console.log(`[alco-os/auth] password-reset link for ${user.email}: ${url}`);
    },
    onPasswordReset: async ({ user }) => {
      console.log(`[alco-os/auth] password was reset for ${user.email}`);
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh session daily while active
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
