import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../../config/database.config";
import { signAccessToken } from "../../core/middleware/jwt";

// -------------------------------
// LOGIN
// -------------------------------
export async function login(req: Request, res: Response) {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ message: "Email/Username and password required" });
    }
    // console.log("\n\n\nreq.body:", req.body);
    
    // find user by username or email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { account: { contactEmail: identifier } },
        ],
      },
      include: {
        account: true,
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // compare password
    const validPassword = await bcrypt.compare(password, user.passwordHash!);
    if (!validPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // check admin approval
    if (!user.account?.isActive) {
      return res.status(403).json({ message: "Account not approved yet" });
    }

    // gather user roles & permission keys
    const roles = user.roles.map((ur) => ur.role.name);
    const permissions = user.roles.flatMap((ur) =>
      ur.role.permissions.map((rp) => rp.permission.key)
    );
    

    // create token payload without sensitive ID
    const tokenPayload = {
      id: user.id,
      email: user.account.contactEmail,
      roles,
      permissions,
    };

    const accessToken = signAccessToken(tokenPayload);



    // set secure cookies
    res.cookie("access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 15 * 60 * 1000, // 15m
    });

    // const NewavatarUrl = buildFileUrl(req, user.id, user.account.avatar);


    // response data
    return res.json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        firstName: user.account.firstName,
        lastName: user.account.lastName,
        email: user.account.contactEmail,
        avatar: user.account.avatar || null,
        roles,
        permissions,
        token: accessToken,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// -------------------------------
// LOGOUT
// -------------------------------
export function logout(req: Request, res: Response) {
  res.clearCookie("access_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  return res.json({ message: "Logged out successfully" });
}
