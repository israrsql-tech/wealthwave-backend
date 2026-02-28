const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const router = express.Router();

// GET /api/transactions - Fetch user's transactions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const transactions = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC, created_at DESC',
      [userId]
    );
    res.json(transactions.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper: raw date (string ya Date) -> IST timestamp string
function toIst(raw) {
  const src = raw ? new Date(raw) : new Date(); // IMPORTANT: no .toISOString()
  return src.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// POST /api/transactions - Add new transaction
// POST /api/transactions - Add new transaction
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, amount, type, category, date, description } = req.body;
    const userId = req.user.id;

    // agar frontend date bhejta hai to use karo, warna abhi ka system time
    const src = date ? new Date(date) : new Date();
    const iso = src.toISOString();  // direct ISO save karte hain

    const newTransaction = await pool.query(
      `INSERT INTO transactions
       (user_id, title, amount, type, category, date, description)
       VALUES ($1, $2, $3, $4, $5, $6::timestamp, $7)
       RETURNING *`,
      [userId, title, amount, type, category, iso, description]
    );

    res.status(201).json(newTransaction.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add transaction' });
  }
});


// PUT /api/transactions/:id - Update transaction
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, amount, type, category, date, description } = req.body;
    const userId = req.user.id;

    // agar frontend date bhejta hai to use karo, warna abhi ka system time
    const src = date ? new Date(date) : new Date();
    const iso = src.toISOString();

    const result = await pool.query(
      `UPDATE transactions
       SET title=$1,
           amount=$2,
           type=$3,
           category=$4,
           date=$5::timestamp,
           description=$6
       WHERE id=$7 AND user_id=$8
       RETURNING *`,
      [title, amount, type, category, iso, description, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});


// DELETE /api/transactions/:id - Delete transaction
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      'DELETE FROM transactions WHERE id=$1 AND user_id=$2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

module.exports = router;
