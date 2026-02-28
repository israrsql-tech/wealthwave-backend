const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bill_payments WHERE user_id = $1 ORDER BY month DESC, id DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get bill payments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// MARK bill as paid + create expense transaction
router.post('/mark-paid', auth, async (req, res) => {
  try {
    const { bill_id, month } = req.body; // 'YYYY-MM'
    const userId = req.user.id;

    // 1) Bill details lao
    const billRes = await pool.query(
      'SELECT * FROM bills WHERE id = $1 AND user_id = $2',
      [bill_id, userId]
    );
    if (billRes.rowCount === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    const bill = billRes.rows[0];

 // 2) bill_payments me row daalo  — IST time
const istNow = new Date();

// IST string → 'YYYY-MM-DD HH:MM:SS'
const paid_on = istNow.toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

    // yahi string TIMESTAMP me cast ho jayegi
    await pool.query(
      `INSERT INTO bill_payments (user_id, bill_id, month, status, paid_on)
      VALUES ($1, $2, $3, 'paid', $4::timestamp)`,
      [userId, bill_id, month, paid_on]
    );

    // 3) transactions me expense insert karo + RETURNING *
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

    const txRes = await pool.query(
      `INSERT INTO transactions
       (user_id, title, amount, type, category, date, description)
       VALUES ($1, $2, $3, 'expense', $4, $5, $6)
       RETURNING *`,
      [
        userId,
        bill.name,                         // title
        bill.amount,                       // amount
        bill.category_id ? String(bill.category_id) : 'Bills', // category text
        today,                             // date
        'Bill payment',                    // description
      ]
    );
    const newTransaction = txRes.rows[0];

    // 4) Latest payments list
    const paymentsRes = await pool.query(
      'SELECT * FROM bill_payments WHERE user_id = $1 ORDER BY month DESC, id DESC',
      [userId]
    );

    res.status(201).json({
      payments: paymentsRes.rows,
      transaction: newTransaction,
    });
  } catch (err) {
    console.error('Mark bill paid error:', err);
    res.status(400).json({ error: 'Invalid data' });
  }
});

module.exports = router;








































