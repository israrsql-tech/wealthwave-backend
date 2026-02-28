const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");
const Groq = require("groq-sdk");

const router = express.Router();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ---------------- Utility Functions ----------------

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toYM(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function resolvePeriod(period) {
  const now = new Date();
  const thisYM = toYM(now);

  const p = period && typeof period === "object" ? period : { type: "thisMonth" };
  const type = p.type || "thisMonth";

  if (type === "all") {
    return { type: "all", label: "All time", from: null, to: null, ym: null };
  }

  if (type === "month") {
    const ym = typeof p.ym === "string" ? p.ym : thisYM;
    const [yStr, mStr] = ym.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    if (!y || !m || m < 1 || m > 12) return resolvePeriod({ type: "thisMonth" });

    const fromD = new Date(y, m - 1, 1);
    const toD = new Date(y, m, 1);
    return { type: "month", label: ym, from: toYMD(fromD), to: toYMD(toD), ym };
  }

  const fromD = new Date(now.getFullYear(), now.getMonth(), 1);
  const toD = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { type: "thisMonth", label: thisYM, from: toYMD(fromD), to: toYMD(toD), ym: thisYM };
}

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// ---------------- MAIN ROUTE ----------------

router.post("/finance-chat", auth, async (req, res) => {
  try {
    const { text, history = [], period, lang } = req.body;
    const userId = req.user.id;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ message: "text required" });
    }

    const resolved = resolvePeriod(period);

    const txRes = await pool.query(
      `SELECT id, title, amount, type, category, date
       FROM transactions
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT 200`,
      [userId]
    );

    const tx = txRes.rows || [];

    let income = 0;
    let expense = 0;

    for (const t of tx) {
      const amt = safeNumber(t.amount);
      if (t.type === "income") income += amt;
      if (t.type === "expense") expense += amt;
    }

    const context = {
      currency: "INR",
      period: resolved,
      totals: {
        income: Number(income.toFixed(2)),
        expense: Number(expense.toFixed(2)),
        net: Number((income - expense).toFixed(2)),
      },
      recentTransactions: tx.slice(0, 10),
    };

    const systemPrompt =
      `You are WealthWave Finance Assistant.\n` +
      `Reply in same language as user.\n` +
      `Use ONLY the numbers from Context JSON.\n` +
      `Keep answers short and clear.\n`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-6),
      {
        role: "user",
        content:
          `User message: ${text}\n\n` +
          `Context JSON:\n${JSON.stringify(context)}`,
      },
    ];

    // 🔥 GROQ CALL (Production Safe)
    const completion = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      messages,
      temperature: 0.2,
    });

    return res.json({
      reply: completion.choices[0]?.message?.content || "",
    });

  } catch (err) {
    console.error("AI route error:", err);
    return res.status(500).json({ message: "AI server error" });
  }
});

module.exports = router;