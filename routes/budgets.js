const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth'); // JWT middleware (transactions.js se same)
const router = express.Router();

// GET all budgets for user
router.get('/', auth, async (req, res) => {
 console.log('GET /api/budgets hit, user:', req.user.id); 
  try {
    const budgets = await pool.query(
      'SELECT * FROM budgets WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(budgets.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST new budget
router.post('/', auth, async (req, res) => {
  try {
    const { name, category_id, limit, active } = req.body;

    const newBudget = await pool.query(
      'INSERT INTO budgets (user_id, name, category_id, "limit", active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, name, category_id, limit, active ?? true]
    );

    res.status(201).json(newBudget.rows[0]);
  } catch (err) {
    console.error('Budget insert error:', err);
    res.status(400).json({ error: 'Invalid data' });
  }
});


// DELETE budget
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM budgets WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ message: 'Budget deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// UPDATE budget
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id, limit, active } = req.body;

    const updatedBudget = await pool.query(
      'UPDATE budgets SET name = $1, category_id = $2, "limit" = $3, active = $4 WHERE id = $5 AND user_id = $6 RETURNING *',
      [name, category_id, limit, active, id, req.user.id]
    );

    if (updatedBudget.rowCount === 0) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json(updatedBudget.rows[0]);
  } catch (err) {
    console.error('Budget update error:', err);
    res.status(400).json({ error: 'Invalid data' });
  }
});



module.exports = router;
