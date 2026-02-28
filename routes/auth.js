const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const router = express.Router();

const strongPwd =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

// SIGNUP
router.post("/signup", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }
    if (!strongPwd.test(password)) {
      return res
        .status(400)
        .json({ message: "Weak password (not meeting rules)" });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [
      email,
    ]);
    if (existing.rows.length) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name,email,phone,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,name,email,phone,avatar",
      [name, email, phone || null, hash]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query(
      "SELECT id,name,email,phone,avatar,password_hash FROM users WHERE email=$1",
      [email]
    );
    if (!result.rows.length) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    delete user.password_hash;
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ message: "Email and new password required" });
    }

    // User find karo
    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const userId = userResult.rows[0].id;

    // New password hash
    const hashed = await bcrypt.hash(newPassword, 10);

    // DB me update
    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [hashed, userId]
    );

    return res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});



// AUTH MIDDLEWARE - current user nikalne ke liye
const authMiddleware = (req, res, next) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: "No token provided" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.userId };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// GET CURRENT USER (for refresh persistence)
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,name,email,phone,avatar FROM users WHERE id=$1",
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Auth me error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// PROFILE UPDATE
router.put("/profile", authMiddleware, async (req, res) => {
  try {
    const { name, phone, avatar, password } = req.body;
    const userId = req.user.id;

    // Purana user lao, YAHAN SIRF password_hash lo
    const existing = await pool.query(
      "SELECT id,name,email,phone,avatar,password_hash FROM users WHERE id=$1",
      [userId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const current = existing.rows[0];

    const newName = name ?? current.name;
    const newPhone = phone ?? current.phone;
    const newAvatar = avatar ?? current.avatar;

    // default old hash
    let newPasswordHash = current.password_hash;

    // agar password bheja hai to validate + hash
    if (password) {
      if (!strongPwd.test(password)) {
        return res
          .status(400)
          .json({ message: "Weak password (not meeting rules)" });
      }
      newPasswordHash = await bcrypt.hash(password, 10);
    }

    const result = await pool.query(
      "UPDATE users SET name=$1, phone=$2, avatar=$3, password_hash=$4 WHERE id=$5 RETURNING id,name,email,phone,avatar",
      [newName, newPhone, newAvatar, newPasswordHash, userId]
    );

    const updatedUser = result.rows[0];
    res.json({ user: updatedUser });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});



module.exports = router;
