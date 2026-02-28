const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// GET all pots for user
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pots WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get pots error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// CREATE pot
router.post('/', auth, async (req, res) => {
  try {
    const { name, target, current } = req.body;
    const result = await pool.query(
      'INSERT INTO pots (user_id, name, target, current) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, name, target, current ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create pot error:', err);
    res.status(400).json({ error: 'Invalid data' });
  }
});

// DELETE pot
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      'DELETE FROM pots WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    res.json({ message: 'Pot deleted' });
  } catch (err) {
    console.error('Delete pot error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
