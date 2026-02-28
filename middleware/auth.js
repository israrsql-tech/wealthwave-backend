// backend/middleware/auth.js
const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) {
      console.error("JWT verify error:", err);
      return res.status(403).json({ message: "Invalid token" });
    }

    // payload = { userId: ... } from routes/auth.js
    req.user = { id: payload.userId };
    next();
  });
}

module.exports = authenticateToken;
