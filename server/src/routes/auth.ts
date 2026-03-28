import { Router, Request, Response, NextFunction } from "express";
import passport from "passport";
import { User, IUser } from "../models/User.js";
import { generateToken, verifyToken } from "../config/jwt.js";
import { dataStore } from "../data/store.js";

const router = Router();

const DEFAULT_CLIENT_URL = "http://localhost:3000";

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
    const userId = (req as Request & { userId?: string }).userId;
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
    const userId = (req as Request & { userId?: string }).userId;
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

export default router;

// Export Google OAuth routes separately
export const googleAuthRoutes = Router();

// GET /auth/google - Initiate Google OAuth
googleAuthRoutes.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
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
