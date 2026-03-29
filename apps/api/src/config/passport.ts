import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import { User, IUser } from "../models/User.js";

function getGoogleOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL ||
      "http://localhost:3000/auth/google/callback",
  };
}

export function configurePassport(): void {
  const { clientId, clientSecret, callbackUrl } = getGoogleOAuthConfig();

  // Serialize user for session
  passport.serializeUser((user: Express.User, done) => {
    done(null, (user as IUser)._id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });

  // Configure Google Strategy
  if (clientId && clientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: clientId,
          clientSecret: clientSecret,
          callbackURL: callbackUrl,
        },
        async (
          accessToken: string,
          refreshToken: string,
          profile: Profile,
          done: (error: Error | null, user?: IUser | false) => void,
        ) => {
          try {
            const tokenExpiry = new Date(Date.now() + 55 * 60 * 1000);
            const applyGoogleTokens = (target: IUser) => {
              if (refreshToken) {
                target.googleAccessToken = accessToken;
                target.googleAccessTokenExpiresAt = tokenExpiry;
                target.googleRefreshToken = refreshToken;
                return;
              }

              // Keep existing Gmail-capable tokens when Google doesn't return a new refresh token.
              if (!target.googleAccessToken) {
                target.googleAccessToken = accessToken;
                target.googleAccessTokenExpiresAt = tokenExpiry;
              }
            };

            // Check if user already exists with this Google ID
            let user = (await User.findOne({ googleId: profile.id }).select(
              "+googleAccessToken +googleRefreshToken +googleAccessTokenExpiresAt",
            )) as IUser | null;

            if (user) {
              // Update last login
              applyGoogleTokens(user);
              user.lastLogin = new Date();
              await user.save();
              return done(null, user);
            }

            // Check if user exists with the same email
            const email = profile.emails?.[0]?.value;
            if (email) {
              user = (await User.findOne({ email }).select(
                "+googleAccessToken +googleRefreshToken +googleAccessTokenExpiresAt",
              )) as IUser | null;

              if (user) {
                // Link Google account to existing user
                user.googleId = profile.id;
                applyGoogleTokens(user);
                user.isEmailVerified = true;
                user.lastLogin = new Date();
                if (!user.avatar && profile.photos?.[0]?.value) {
                  user.avatar = profile.photos[0].value;
                }
                await user.save();
                return done(null, user);
              }
            }

            // Create new user
            const newUser = new User({
              googleId: profile.id,
              googleAccessToken: accessToken,
              googleRefreshToken: refreshToken || undefined,
              googleAccessTokenExpiresAt: tokenExpiry,
              email: email || `${profile.id}@google.oauth`,
              name: profile.displayName || "Google User",
              avatar: profile.photos?.[0]?.value,
              isEmailVerified: true,
              role: "viewer",
              lastLogin: new Date(),
            });

            await newUser.save();
            done(null, newUser);
          } catch (error) {
            done(error as Error, false);
          }
        },
      ),
    );

    console.log("Google OAuth strategy configured");
  } else {
    console.warn(
      "Google OAuth credentials not configured. Google login will be disabled.",
    );
  }
}

export default passport;
