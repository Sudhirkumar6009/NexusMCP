import { Router, Request, Response, NextFunction } from "express";
import passport from "passport";
import { User, IUser } from "../models/User.js";
import { generateToken, verifyToken } from "../config/jwt.js";
import { dataStore } from "../data/store.js";

const router = Router();

const DEFAULT_CLIENT_URL = "http://localhost:5000";
const TEST_LOGIN_EMAIL = "test123@gmail.com";
const TEST_LOGIN_PASSWORD = "Test@123";
const TEST_LOGIN_USER_ID = "test-login-user";
const TEST_LOGIN_USER_ROLE: IUser["role"] = "admin";
const TEST_LOGIN_DEFAULT_NAME = "Test User";
const GOOGLE_BASE_AUTH_SCOPES = ["profile", "email"] as const;
const GOOGLE_GMAIL_READ_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_GMAIL_COMPOSE_SCOPE =
  "https://www.googleapis.com/auth/gmail.compose";
const GOOGLE_GMAIL_SCOPES = [
  GOOGLE_GMAIL_READ_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_GMAIL_COMPOSE_SCOPE,
] as const;
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

type AuthenticatedRequest = Request & { userId?: string };

type GoogleTokenExchangeGrant = "authorization_code" | "refresh_token";

interface GoogleTokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

function hasGoogleStrategy(): boolean {
  const authenticator = passport as passport.Authenticator & {
    _strategy?: (name: string) => unknown;
  };

  return (
    typeof authenticator._strategy === "function" &&
    Boolean(authenticator._strategy("google"))
  );
}

function authenticateGoogle(
  options: passport.AuthenticateOptions & Record<string, unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasGoogleStrategy()) {
      res.status(503).json({
        success: false,
        error:
          "Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in apps/api/.env, then restart the API.",
      });
      return;
    }

    passport.authenticate("google", options)(req, res, next);
  };
}

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

function buildTestLoginUser() {
  const adminUser = dataStore.getUser("user-admin");

  return {
    id: TEST_LOGIN_USER_ID,
    email: TEST_LOGIN_EMAIL,
    name: testLoginProfile.name,
    avatar: testLoginProfile.avatar,
    role: TEST_LOGIN_USER_ROLE,
    permissions: adminUser?.permissions ?? [],
    createdAt: testLoginProfile.createdAt,
    lastLogin: testLoginProfile.lastLogin,
  };
}

const testLoginProfile: {
  name: string;
  avatar?: string;
  createdAt: string;
  lastLogin: string;
} = {
  name: TEST_LOGIN_DEFAULT_NAME,
  createdAt: new Date().toISOString(),
  lastLogin: new Date().toISOString(),
};

function touchTestLoginProfile() {
  testLoginProfile.lastLogin = new Date().toISOString();
}

function buildTestLoginTokenUser() {
  return {
    _id: {
      toString: () => TEST_LOGIN_USER_ID,
    },
    email: TEST_LOGIN_EMAIL,
    role: TEST_LOGIN_USER_ROLE,
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseExpiresInSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return 3600;
}

function getGoogleOAuthClientCredentials(overrides?: {
  clientId?: string;
  clientSecret?: string;
}) {
  return {
    clientId:
      normalizeOptionalString(overrides?.clientId) ||
      process.env.GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_CLIENT ||
      "",
    clientSecret:
      normalizeOptionalString(overrides?.clientSecret) ||
      process.env.GOOGLE_CLIENT_SECRET ||
      "",
  };
}

async function exchangeGoogleOAuthToken(args: {
  grantType: GoogleTokenExchangeGrant;
  clientId: string;
  clientSecret: string;
  authorizationCode?: string;
  refreshToken?: string;
  redirectUri?: string;
}): Promise<GoogleTokenExchangeResult> {
  const body = new URLSearchParams();
  body.set("client_id", args.clientId);
  body.set("client_secret", args.clientSecret);
  body.set("grant_type", args.grantType);

  if (args.grantType === "authorization_code") {
    if (!args.authorizationCode || !args.redirectUri) {
      throw new Error(
        "authorization_code and redirect_uri are required for code exchange",
      );
    }

    body.set("code", args.authorizationCode);
    body.set("redirect_uri", args.redirectUri);
  } else {
    if (!args.refreshToken) {
      throw new Error("refresh_token is required for token refresh");
    }

    body.set("refresh_token", args.refreshToken);
  }

  const tokenResponse = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const tokenText = await tokenResponse.text();
  let tokenPayload: Record<string, unknown> = {};

  try {
    tokenPayload = tokenText
      ? (JSON.parse(tokenText) as Record<string, unknown>)
      : {};
  } catch {
    throw new Error(
      `Google token exchange failed (${tokenResponse.status}): ${tokenText}`,
    );
  }

  if (!tokenResponse.ok) {
    throw new Error(
      `Google token exchange failed (${tokenResponse.status}): ${String(tokenPayload.error_description || tokenPayload.error || tokenResponse.statusText)}`,
    );
  }

  const accessToken = normalizeOptionalString(tokenPayload.access_token);
  if (!accessToken) {
    throw new Error("Google token exchange did not return access_token");
  }

  const refreshToken = normalizeOptionalString(tokenPayload.refresh_token);
  const expiresIn = parseExpiresInSeconds(tokenPayload.expires_in);

  return {
    accessToken,
    refreshToken,
    expiresIn,
  };
}

async function persistGoogleTokens(
  user: IUser,
  tokenResult: GoogleTokenExchangeResult,
  fallbackRefreshToken?: string,
): Promise<IUser> {
  const resolvedRefreshToken =
    tokenResult.refreshToken || fallbackRefreshToken || user.googleRefreshToken;

  user.googleAccessToken = tokenResult.accessToken;
  user.googleAccessTokenExpiresAt = new Date(
    Date.now() + Math.max(tokenResult.expiresIn - 60, 60) * 1000,
  );

  if (resolvedRefreshToken) {
    user.googleRefreshToken = resolvedRefreshToken;
  }

  await user.save();
  return user;
}

async function refreshGoogleAccessToken(user: IUser): Promise<IUser> {
  if (!user.googleRefreshToken) {
    throw new Error(
      "No Google refresh token available. Please sign in with Google again.",
    );
  }

  const { clientId, clientSecret } = getGoogleOAuthClientCredentials();

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials are not configured");
  }

  const tokenResult = await exchangeGoogleOAuthToken({
    grantType: "refresh_token",
    clientId,
    clientSecret,
    refreshToken: user.googleRefreshToken,
  });

  return persistGoogleTokens(user, tokenResult, user.googleRefreshToken);
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

// POST /api/auth/test-login - Test-only bypass login without DB access
router.post("/test-login", (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.toLowerCase() !== TEST_LOGIN_EMAIL ||
      password !== TEST_LOGIN_PASSWORD
    ) {
      res.status(401).json({
        success: false,
        error: "Invalid test login credentials",
      });
      return;
    }

    touchTestLoginProfile();
    const token = generateToken(buildTestLoginTokenUser());

    dataStore.addLog({
      level: "info",
      service: "system",
      action: "test_login",
      message: `Test login used: ${TEST_LOGIN_EMAIL}`,
      userId: TEST_LOGIN_USER_ID,
    });

    res.json({
      success: true,
      data: {
        user: buildTestLoginUser(),
        token,
      },
      message: "Test login successful",
    });
  } catch (error) {
    console.error("Test login error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to complete test login",
    });
  }
});

// GET /api/auth/me - Get current user
router.get("/me", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;

    if (userId === TEST_LOGIN_USER_ID) {
      res.json({
        success: true,
        data: buildTestLoginUser(),
      });
      return;
    }

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

    if (userId === TEST_LOGIN_USER_ID) {
      const trimmedName =
        typeof name === "string" ? name.trim() : undefined;

      if (trimmedName !== undefined) {
        if (!trimmedName) {
          res.status(400).json({
            success: false,
            error: "Name cannot be empty",
          });
          return;
        }

        testLoginProfile.name = trimmedName;
      }

      if (typeof avatar === "string") {
        testLoginProfile.avatar = avatar || undefined;
      }

      res.json({
        success: true,
        data: buildTestLoginUser(),
        message: "Profile updated successfully",
      });
      return;
    }

    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({
        success: false,
        error: "User not found",
      });
      return;
    }

    // Update allowed fields
    if (typeof name === "string") {
      const trimmedName = name.trim();
      if (!trimmedName) {
        res.status(400).json({
          success: false,
          error: "Name cannot be empty",
        });
        return;
      }
      user.name = trimmedName;
    }
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

// POST /api/auth/gmail/token - Exchange auth code or refresh Gmail OAuth token
router.post(
  "/gmail/token",
  authenticateToken,
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const authorizationCode = normalizeOptionalString(body.authorization_code);
    const redirectUri = normalizeOptionalString(body.redirect_uri);
    const requestedClientId = normalizeOptionalString(body.client_id);
    const requestedClientSecret = normalizeOptionalString(body.client_secret);

    try {
      const userId = (req as AuthenticatedRequest).userId;

      if (userId === TEST_LOGIN_USER_ID) {
        return res.status(400).json({
          access_token: "",
          refresh_token: "",
          expires_in: 0,
          error: "Test login cannot persist Gmail OAuth credentials",
        });
      }

      const user = (await User.findById(userId).select(
        "+googleAccessToken +googleRefreshToken +googleAccessTokenExpiresAt",
      )) as IUser | null;

      if (!user) {
        return res.status(404).json({
          access_token: "",
          refresh_token: "",
          expires_in: 0,
          error: "User not found",
        });
      }

      const { clientId, clientSecret } = getGoogleOAuthClientCredentials({
        clientId: requestedClientId,
        clientSecret: requestedClientSecret,
      });

      if (!clientId || !clientSecret) {
        return res.status(400).json({
          access_token: "",
          refresh_token: user.googleRefreshToken || "",
          expires_in: 0,
          error: "client_id and client_secret are required",
        });
      }

      const existingRefreshToken = normalizeOptionalString(
        user.googleRefreshToken,
      );

      let tokenResult: GoogleTokenExchangeResult;

      // If we already have a refresh token, refresh silently instead of prompting again.
      if (existingRefreshToken) {
        try {
          tokenResult = await exchangeGoogleOAuthToken({
            grantType: "refresh_token",
            clientId,
            clientSecret,
            refreshToken: existingRefreshToken,
          });
        } catch (refreshError) {
          if (!authorizationCode || !redirectUri) {
            const refreshErrorMessage =
              refreshError instanceof Error
                ? refreshError.message
                : "Failed to refresh Gmail access token";

            return res.status(502).json({
              access_token: "",
              refresh_token: existingRefreshToken,
              expires_in: 0,
              error: refreshErrorMessage,
            });
          }

          tokenResult = await exchangeGoogleOAuthToken({
            grantType: "authorization_code",
            clientId,
            clientSecret,
            authorizationCode,
            redirectUri,
          });
        }
      } else {
        if (!authorizationCode) {
          return res.status(400).json({
            access_token: "",
            refresh_token: "",
            expires_in: 0,
            error:
              "authorization_code is required when no refresh_token exists",
          });
        }

        if (!redirectUri) {
          return res.status(400).json({
            access_token: "",
            refresh_token: "",
            expires_in: 0,
            error: "redirect_uri is required for authorization_code exchange",
          });
        }

        tokenResult = await exchangeGoogleOAuthToken({
          grantType: "authorization_code",
          clientId,
          clientSecret,
          authorizationCode,
          redirectUri,
        });
      }

      const resolvedRefreshToken =
        tokenResult.refreshToken || existingRefreshToken;

      if (!resolvedRefreshToken) {
        return res.status(400).json({
          access_token: tokenResult.accessToken,
          refresh_token: "",
          expires_in: tokenResult.expiresIn,
          error:
            "Google did not return refresh_token. Re-authorize with access_type=offline and prompt=consent.",
        });
      }

      const updatedUser = await persistGoogleTokens(
        user,
        tokenResult,
        resolvedRefreshToken,
      );

      return res.json({
        access_token: updatedUser.googleAccessToken || "",
        refresh_token: updatedUser.googleRefreshToken || resolvedRefreshToken,
        expires_in: tokenResult.expiresIn,
      });
    } catch (error) {
      console.error("Gmail token handler error:", error);
      return res.status(500).json({
        access_token: "",
        refresh_token: "",
        expires_in: 0,
        error:
          error instanceof Error
            ? error.message
            : "Failed to obtain Gmail access token",
      });
    }
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
  authenticateGoogle({
    scope: [...GOOGLE_BASE_AUTH_SCOPES],
    session: false,
  }),
);

// GET /auth/google/gmail - Re-consent with Gmail read/send/compose scopes
googleAuthRoutes.get(
  "/google/gmail",
  authenticateGoogle({
    scope: [...GOOGLE_BASE_AUTH_SCOPES, ...GOOGLE_GMAIL_SCOPES],
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
    authenticateGoogle({
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
