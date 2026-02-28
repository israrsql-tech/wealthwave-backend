const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// GET movements for current user (optional: filter by pot)
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pot_movements WHERE user_id = $1 ORDER BY date DESC, id DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get pot movements error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// CREATE movement (deposit / withdraw)
router.post('/', auth, async (req, res) => {
  try {
    const { pot_id, type, amount, note } = req.body;

    // 1) movement row insert
    const movementResult = await pool.query(
      'INSERT INTO pot_movements (user_id, pot_id, type, amount, note) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, pot_id, type, amount, note]
    );

    // 2) pots.current update
    const sign = type === 'withdraw' ? -1 : 1;
    const potResult = await pool.query(
      'UPDATE pots SET current = current + $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [sign * amount, pot_id, req.user.id]
    );

    res.status(201).json({
      movement: movementResult.rows[0],
      pot: potResult.rows[0],
    });
  } catch (err) {
    console.error('Create pot movement error:', err);
    res.status(400).json({ error: 'Invalid data' });
  }
});

module.exports = router;
