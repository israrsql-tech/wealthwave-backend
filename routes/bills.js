const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// GET all bills for user
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bills WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get bills error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// CREATE bill
router.post('/', auth, async (req, res) => {
  try {
    const {
      name,
      amount,
      due_day,
      frequency,
      auto_pay,
      active,
      category_id,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO bills
       (user_id, name, amount, due_day, frequency, auto_pay, active, category_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.user.id,
        name,
        amount,
        due_day,
        frequency,
        auto_pay ?? false,
        active ?? true,
        category_id || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create bill error:', err);
    res.status(400).json({ error: 'Invalid data' });
  }
});

// UPDATE bill
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      amount,
      due_day,
      frequency,
      auto_pay,
      active,
      category_id,
    } = req.body;

    const result = await pool.query(
      `UPDATE bills
       SET name=$1, amount=$2, due_day=$3, frequency=$4,
           auto_pay=$5, active=$6, category_id=$7
       WHERE id=$8 AND user_id=$9
       RETURNING *`,
      [
        name,
        amount,
        due_day,
        frequency,
        auto_pay,
        active,
        category_id || null,
        id,
        req.user.id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update bill error:', err);
    res.status(400).json({ error: 'Invalid data' });
  }
});

// DELETE bill
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      'DELETE FROM bills WHERE id=$1 AND user_id=$2',
      [id, req.user.id]
    );
    res.json({ message: 'Bill deleted' });
  } catch (err) {
    console.error('Delete bill error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
