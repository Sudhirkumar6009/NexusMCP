import { Router, Request, Response, NextFunction } from "express";
import passport from "passport";
import { User, IUser } from "../models/User.js";
import { generateToken, verifyToken } from "../config/jwt.js";
import { dataStore } from "../data/store.js";

const router = Router();

const DEFAULT_CLIENT_URL = "http://localhost:5000";
const GOOGLE_BASE_AUTH_SCOPES = ["profile", "email"] as const;
const GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

type AuthenticatedRequest = Request & { userId?: string };

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function getPrimaryClientUrl(): string {
  const clientUrl = process.env.CLIENT_URL?.trim();
  if (clientUrl) {
    return normalizeUrl(clientUrl);
  }

  const clientUrls = (process.env.CLIENT_URLS ?? "")
    .split(",")
    .map((url) => normalizeUrl(url.trim()))
    .filter(Boolean);

  return clientUrls[0] ?? DEFAULT_CLIENT_URL;
}

function base64UrlEncode(content: string): string {
  return Buffer.from(content, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildGmailRawMessage(args: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}): string {
  const contentType = args.html
    ? "text/html; charset=UTF-8"
    : "text/plain; charset=UTF-8";
  const body = args.html || args.text || "";

  const rawMessage = [
    "MIME-Version: 1.0",
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    `Content-Type: ${contentType}`,
    "",
    body,
  ].join("\r\n");

  return base64UrlEncode(rawMessage);
}

async function refreshGoogleAccessToken(user: IUser): Promise<IUser> {
  if (!user.googleRefreshToken) {
    throw new Error(
      "No Google refresh token available. Please sign in with Google again.",
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials are not configured");
  }

  const tokenResponse = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: user.googleRefreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  const tokenText = await tokenResponse.text();
  let tokenPayload: Record<string, unknown> = {};
  try {
    tokenPayload = JSON.parse(tokenText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Google token refresh failed (${tokenResponse.status}): ${tokenText}`,
    );
  }

  if (!tokenResponse.ok) {
    throw new Error(
      `Google token refresh failed (${tokenResponse.status}): ${String(tokenPayload.error_description || tokenPayload.error || tokenResponse.statusText)}`,
    );
  }

  const accessToken =
    typeof tokenPayload.access_token === "string"
      ? tokenPayload.access_token
      : undefined;

  if (!accessToken) {
    throw new Error("Google token refresh did not return access_token");
  }

  const expiresInSeconds =
    typeof tokenPayload.expires_in === "number"
      ? tokenPayload.expires_in
      : 3600;

  user.googleAccessToken = accessToken;
  user.googleAccessTokenExpiresAt = new Date(
    Date.now() + (expiresInSeconds - 60) * 1000,
  );
  await user.save();

  return user;
}

// Auth middleware
export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1] || req.cookies?.auth_token;

  if (!token) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ success: false, error: "Invalid or expired token" });
    return;
  }

  // Attach userId to request
  (req as Request & { userId?: string }).userId = payload.userId;
  next();
}

// POST /api/auth/register - Register with email/password
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({
        success: false,
        error: "Email, password, and name are required",
      });
      return;
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: "An account with this email already exists",
      });
      return;
    }

    // Create new user
    const user = new User({
      email: email.toLowerCase(),
      password,
      name,
      role: "viewer",
      lastLogin: new Date(),
    });

    await user.save();

    // Generate JWT token
    const token = generateToken(user);

    // Log the registration
    dataStore.addLog({
      level: "info",
      service: "system",
      action: "user_registered",
      message: `New user registered: ${user.email}`,
      userId: user._id.toString(),
    });

    res.status(201).json({
      success: true,
      data: {
        user: user.toJSON(),
        token,
      },
      message: "Account created successfully",
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create account",
    });
  }
});

// POST /api/auth/login - Login with email/password
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: "Email and password are required",
      });
      return;
    }

    // Find user with password field
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password",
    );

    if (!user) {
      res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
      return;
    }

    // Check if user has a password (might be Google-only account)
    if (!user.password) {
      res.status(401).json({
        success: false,
        error: "This account uses Google sign-in. Please use Google to log in.",
      });
      return;
    }

    // Verify password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
      return;
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = generateToken(user);

    // Log the login
    dataStore.addLog({
      level: "info",
      service: "system",
      action: "user_login",
      message: `User logged in: ${user.email}`,
      userId: user._id.toString(),
    });

    res.json({
      success: true,
      data: {
        user: user.toJSON(),
        token,
      },
      message: "Login successful",
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to log in",
    });
  }
});

// GET /api/auth/me - Get current user
router.get("/me", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({
        success: false,
        error: "User not found",
      });
      return;
    }

    res.json({
      success: true,
      data: user.toJSON(),
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get user",
    });
  }
});

// PUT /api/auth/me - Update current user
router.put("/me", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, avatar } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({
        success: false,
        error: "User not found",
      });
      return;
    }

    // Update allowed fields
    if (name) user.name = name;
    if (avatar) user.avatar = avatar;

    await user.save();

    res.json({
      success: true,
      data: user.toJSON(),
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update profile",
    });
  }
});

// POST /api/auth/logout - Logout
router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("auth_token");
  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

// GET /api/auth/sessions - Get user sessions (placeholder)
router.get(
  "/sessions",
  authenticateToken,
  async (req: Request, res: Response) => {
    // For now, return a mock session list
    res.json({
      success: true,
      data: [
        {
          id: "current-session",
          device: "Current Device",
          browser: req.headers["user-agent"] || "Unknown",
          ipAddress: req.ip || "127.0.0.1",
          location: "Unknown",
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          isCurrent: true,
        },
      ],
    });
  },
);

// POST /api/auth/gmail/send - Send email via Gmail API using Google OAuth token
router.post(
  "/gmail/send",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const { to, subject, text, html } = req.body as {
        to?: string;
        subject?: string;
        text?: string;
        html?: string;
      };

      if (!to || !subject || (!text && !html)) {
        return res.status(400).json({
          success: false,
          error: "Fields to, subject, and text or html are required",
        });
      }

      const user = (await User.findById(userId).select(
        "+googleAccessToken +googleRefreshToken +googleAccessTokenExpiresAt",
      )) as IUser | null;

      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      let oauthUser: IUser = user;

      if (!oauthUser.googleAccessToken && !oauthUser.googleRefreshToken) {
        return res.status(400).json({
          success: false,
          error:
            "Google OAuth token not available. Please connect Gmail via /auth/google/gmail.",
        });
      }

      const tokenExpired =
        !!oauthUser.googleAccessTokenExpiresAt &&
        oauthUser.googleAccessTokenExpiresAt.getTime() <= Date.now();
      if (!oauthUser.googleAccessToken || tokenExpired) {
        oauthUser = await refreshGoogleAccessToken(oauthUser);
      }

      if (!oauthUser.googleAccessToken) {
        return res.status(400).json({
          success: false,
          error:
            "Google access token is unavailable. Please reconnect Gmail via /auth/google/gmail.",
        });
      }

      const sendRequest = async (accessToken: string) =>
        fetch(GOOGLE_GMAIL_SEND_URL, {
          method: "POST",
          headers: {
            // Gmail API must be authenticated with Google OAuth token, never app JWT.
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            raw: buildGmailRawMessage({ to, subject, text, html }),
          }),
        });

      let gmailResponse = await sendRequest(oauthUser.googleAccessToken);
      if (gmailResponse.status === 401 && oauthUser.googleRefreshToken) {
        oauthUser = await refreshGoogleAccessToken(oauthUser);

        if (!oauthUser.googleAccessToken) {
          return res.status(401).json({
            success: false,
            error:
              "Google access token refresh failed. Please sign in with Google again.",
          });
        }

        gmailResponse = await sendRequest(oauthUser.googleAccessToken);
      }

      const gmailText = await gmailResponse.text();
      let gmailPayload: Record<string, unknown> = {};
      try {
        gmailPayload = JSON.parse(gmailText) as Record<string, unknown>;
      } catch {
        gmailPayload = { raw: gmailText };
      }

      if (!gmailResponse.ok) {
        return res.status(gmailResponse.status).json({
          success: false,
          error:
            (typeof gmailPayload.error === "string" && gmailPayload.error) ||
            (typeof gmailPayload.message === "string" &&
              gmailPayload.message) ||
            `Gmail API send failed (${gmailResponse.status})`,
          details: gmailPayload,
        });
      }

      dataStore.addLog({
        level: "info",
        service: "system",
        action: "gmail_send_message",
        message: `Gmail message sent to ${to}`,
        userId: oauthUser._id.toString(),
        details: {
          gmailMessageId: gmailPayload.id,
          threadId: gmailPayload.threadId,
          to,
          subject,
        },
      });

      return res.json({
        success: true,
        data: {
          id: gmailPayload.id,
          threadId: gmailPayload.threadId,
          labelIds: gmailPayload.labelIds,
        },
      });
    } catch (error) {
      console.error("Gmail send error:", error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to send email",
      });
    }
  },
);

export default router;

// Export Google OAuth routes separately
export const googleAuthRoutes = Router();

// GET /auth/google - Initiate Google OAuth
googleAuthRoutes.get(
  "/google",
  passport.authenticate("google", {
    scope: [...GOOGLE_BASE_AUTH_SCOPES],
    session: false,
  }),
);

// GET /auth/google/gmail - Re-consent with Gmail send scope
googleAuthRoutes.get(
  "/google/gmail",
  passport.authenticate("google", {
    scope: [...GOOGLE_BASE_AUTH_SCOPES, GOOGLE_GMAIL_SEND_SCOPE],
    accessType: "offline",
    prompt: "consent",
    includeGrantedScopes: true,
    session: false,
  }),
);

// GET /auth/google/callback - Google OAuth callback
googleAuthRoutes.get(
  "/google/callback",
  (req: Request, res: Response, next: NextFunction) => {
    const failureRedirect = `${getPrimaryClientUrl()}/login?error=Authentication%20failed`;
    passport.authenticate("google", {
      session: false,
      failureRedirect,
    })(req, res, next);
  },
  (req: Request, res: Response) => {
    try {
      const clientUrl = getPrimaryClientUrl();
      const user = req.user as IUser;

      if (!user) {
        res.redirect(`${clientUrl}/login?error=Authentication%20failed`);
        return;
      }

      // Generate JWT token
      const token = generateToken(user);

      // Log the login
      dataStore.addLog({
        level: "info",
        service: "system",
        action: "user_google_login",
        message: `User logged in via Google: ${user.email}`,
        userId: user._id.toString(),
      });

      // Redirect to client with token
      res.redirect(`${clientUrl}/auth/callback?token=${token}`);
    } catch (error) {
      console.error("Google callback error:", error);
      res.redirect(
        `${getPrimaryClientUrl()}/login?error=Authentication%20failed`,
      );
    }
  },
);
