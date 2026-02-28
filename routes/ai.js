const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toYM(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// period can be:
// { type: "thisMonth" }
// { type: "month", ym: "2026-02" }
// { type: "lastN", n: 3 }   // last 3 months incl current
// { type: "all" }
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

  if (type === "lastN") {
    let n = Number(p.n || 3);
    if (!Number.isFinite(n)) n = 3;
    n = Math.max(1, Math.min(24, n));

    const fromD = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
    const toD = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      type: "lastN",
      label: `Last ${n} months`,
      from: toYMD(fromD),
      to: toYMD(toD),
      ym: null,
      n,
    };
  }

  // default: thisMonth
  const fromD = new Date(now.getFullYear(), now.getMonth(), 1);
  const toD = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { type: "thisMonth", label: thisYM, from: toYMD(fromD), to: toYMD(toD), ym: thisYM };
}

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// Your current transaction create flow sends category: String(categoryid) [file:119]
function getTxCategoryId(t) {
  const raw = t?.category;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function lastNMonthsYM(n, endDate = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(endDate.getFullYear(), endDate.getMonth() - i, 1);
    out.push(toYM(d));
  }
  return out;
}

router.post("/finance-chat", auth, async (req, res) => {
  try {
    const { text, history = [], period, lang } = req.body;
    const userId = req.user.id;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ message: "text required" });
    }

    const resolved = resolvePeriod(period);

    // For comparisons we keep a sane window even if "all"
    let compareFrom = resolved.from;
    let compareTo = resolved.to;

    if (resolved.type === "all") {
      const now = new Date();
      const fromD = new Date(now.getFullYear(), now.getMonth() - 11, 1); // last 12 months
      const toD = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      compareFrom = toYMD(fromD);
      compareTo = toYMD(toD);
    }

    const fromYM = compareFrom.slice(0, 7); // "YYYY-MM"
    const toYMExclusive = compareTo.slice(0, 7); // next month

    // =========================
    // 1) Transactions (selected period)
    // =========================
    let txQuery = `
      SELECT id, title, amount, type, category, date
      FROM transactions
      WHERE user_id = $1
    `;
    const txParams = [userId];

    if (resolved.type !== "all") {
      txQuery += ` AND date >= $2 AND date < $3`;
      txParams.push(resolved.from, resolved.to);
    }

    txQuery += ` ORDER BY date DESC, created_at DESC LIMIT 500`;

    const txRes = await pool.query(txQuery, txParams);
    const tx = txRes.rows || [];

    // =========================
    // 2) Month-wise transactions (compare window)
    // =========================
    const monthlyTxRes = await pool.query(
      `
      SELECT
        to_char(date_trunc('month', date::timestamp), 'YYYY-MM') AS ym,
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
      FROM transactions
      WHERE user_id = $1
        AND date >= $2 AND date < $3
      GROUP BY 1
      ORDER BY 1;
      `,
      [userId, compareFrom, compareTo]
    );

    const monthlyTx = (monthlyTxRes.rows || []).map((r) => {
      const income = safeNumber(r.income);
      const expense = safeNumber(r.expense);
      return {
        ym: r.ym,
        income: Number(income.toFixed(2)),
        expense: Number(expense.toFixed(2)),
        net: Number((income - expense).toFixed(2)),
      };
    });

    // =========================
    // 3) Budgets / Pots / Bills (live)
    // =========================
    const budgetsRes = await pool.query(
      `SELECT id, name, category_id, "limit", active
       FROM budgets
       WHERE user_id = $1`,
      [userId]
    );

    const potsRes = await pool.query(
      `SELECT id, name, target, current
       FROM pots
       WHERE user_id = $1`,
      [userId]
    );

    const billsRes = await pool.query(
      `SELECT id, name, amount, due_day, frequency, auto_pay, active, category_id
       FROM bills
       WHERE user_id = $1`,
      [userId]
    );

    const budgets = budgetsRes.rows || [];
    const pots = potsRes.rows || [];
    const bills = billsRes.rows || [];

    // =========================
    // 4) Bill payments (month-wise compare)
    // Your table: bill_payments(user_id, bill_id, month, status, paid_on)
    // =========================
    const billPaidMonthlyRes = await pool.query(
      `
      SELECT
        bp.month AS ym,
        COUNT(*) AS paid_count,
        SUM(b.amount) AS paid_total
      FROM bill_payments bp
      JOIN bills b ON b.id = bp.bill_id
      WHERE bp.user_id = $1
        AND b.user_id = $1
        AND LOWER(bp.status) = 'paid'
        AND bp.month >= $2
        AND bp.month <  $3
      GROUP BY bp.month
      ORDER BY bp.month;
      `,
      [userId, fromYM, toYMExclusive]
    );

    // Fill missing months with zeros (so comparison looks consistent)
    const compareMonths = lastNMonthsYM(12, new Date(compareTo));
    const paidMap = new Map(
      (billPaidMonthlyRes.rows || []).map((r) => [
        r.ym,
        {
          paidCount: Number(r.paid_count || 0),
          paidTotal: safeNumber(r.paid_total),
        },
      ])
    );

    const billsPaidMonthly = compareMonths.map((ym) => {
      const v = paidMap.get(ym) || { paidCount: 0, paidTotal: 0 };
      return {
        ym,
        paidCount: v.paidCount,
        paidTotal: Number(v.paidTotal.toFixed(2)),
      };
    });

    // =========================
    // 5) Summaries for selected period
    // =========================
    let income = 0;
    let expense = 0;

    // Category totals for selected period (key is categoryId string)
    const byCategory = {};

    for (const t of tx) {
      const amt = safeNumber(t.amount);
      if (t.type === "income") income += amt;
      if (t.type === "expense") expense += amt;

      if (t.type === "expense") {
        const catId = getTxCategoryId(t);
        const key = catId != null ? String(catId) : "unknown";
        byCategory[key] = (byCategory[key] || 0) + amt;
      }
    }

    const topCategories = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, total]) => ({ key, total: Number(safeNumber(total).toFixed(2)) }));

    const potTotal = pots.reduce((s, p) => s + safeNumber(p.current), 0);

    // Budget utilization (selected period tx vs budgets.category_id)
    const budgetStatus = budgets
      .filter((b) => b.active)
      .map((b) => {
        const catId = Number(b.category_id);

        const spent = tx
          .filter((t) => t.type === "expense" && getTxCategoryId(t) === catId)
          .reduce((s, t) => s + safeNumber(t.amount), 0);

        const limit = safeNumber(b.limit);
        const pct = limit ? (spent / limit) * 100 : 0;

        return {
          id: b.id,
          name: b.name,
          category_id: catId,
          limit: Number(limit.toFixed(2)),
          spent: Number(spent.toFixed(2)),
          pct: Number(pct.toFixed(1)),
        };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 12);

    const activeBills = bills.filter((b) => b.active);

    const context = {
      currency: "INR",
      period: resolved,
      compareWindow: { from: compareFrom, to: compareTo }, // what monthlyTx/billsPaidMonthly used

      totals: {
        income: Number(income.toFixed(2)),
        expense: Number(expense.toFixed(2)),
        net: Number((income - expense).toFixed(2)),
      },

      monthlyTx, // month-wise income/expense/net
      billsPaidMonthly, // month-wise bills paid total/count

      topCategories,
      budgetStatus,

      pots: {
        count: pots.length,
        totalSaved: Number(potTotal.toFixed(2)),
      },

      bills: {
        count: bills.length,
        activeCount: activeBills.length,
        activeBills: activeBills.slice(0, 50).map((b) => ({
          id: b.id,
          name: b.name,
          amount: b.amount,
          due_day: b.due_day,
          frequency: b.frequency,
          auto_pay: b.auto_pay,
          category_id: b.category_id,
          active: b.active,
        })),
      },

      recentTransactions: tx.slice(0, 20),
    };

    // =========================
    // 6) Prompt + Ollama call
    // =========================
    const langHint = typeof lang === "string" && lang.trim() ? lang.trim() : "auto";

    const systemPrompt =
      `You are WealthWave Finance Assistant.\n` +
      `Reply in the same language as the user's last message. If user mixes Hindi+English, reply in Hinglish.\n` +
      `If lang is provided, strictly reply in that language: ${langHint}.\n` +
      `Use ONLY the numbers and facts from the provided Context JSON.\n` +
      `When user asks to compare months, use Context JSON monthlyTx and quote exact month-wise numbers.\n` +
      `When user asks bill comparison, use Context JSON billsPaidMonthly and quote month-wise paidTotal/paidCount.\n` +
      `If user asks for a different month/period than Context JSON, ask which month (YYYY-MM) or last N months.\n` +
      `Keep it concise and actionable.\n`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-8),
      {
        role: "user",
        content:
          `User message: ${text}\n\n` +
          `Context JSON (read-only):\n${JSON.stringify(context)}`,
      },
    ];

    const ollamaUrl = `${process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"}/api/chat`;

    const payload = {
      model: process.env.LOCAL_LLM_MODEL || "llama3:8b",
      messages,
      stream: false, // non-stream response [web:4][web:16]
      options: { temperature: 0.2 },
    };

    if (typeof fetch !== "function") {
      return res.status(500).json({ message: "Server fetch() not available. Use Node 18+ or install node-fetch." });
    }

    const r = await fetch(ollamaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("Ollama error:", r.status, errText);
      return res.status(500).json({ message: "Ollama error" });
    }

    const data = await r.json();
    return res.json({ reply: data?.message?.content || "" });
  } catch (err) {
    console.error("AI route error:", err);
    return res.status(500).json({ message: "AI server error" });
  }
});

module.exports = router;
