import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Only allow David's email
const ALLOWED_EMAILS = ["david@davideberle.com", "davideberle@gmail.com"];

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Only allow specific emails
      if (user.email && ALLOWED_EMAILS.includes(user.email)) {
        return true;
      }
      return false;
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
