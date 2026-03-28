import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import { User, IUser } from "../models/User.js";

function getGoogleOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL ||
      "http://localhost:3001/auth/google/callback",
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
          scope: ["profile", "email"],
        },
        async (
          _accessToken: string,
          _refreshToken: string,
          profile: Profile,
          done: (error: Error | null, user?: IUser | false) => void,
        ) => {
          try {
            // Check if user already exists with this Google ID
            let user = await User.findOne({ googleId: profile.id });

            if (user) {
              // Update last login
              user.lastLogin = new Date();
              await user.save();
              return done(null, user);
            }

            // Check if user exists with the same email
            const email = profile.emails?.[0]?.value;
            if (email) {
              user = await User.findOne({ email });

              if (user) {
                // Link Google account to existing user
                user.googleId = profile.id;
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
