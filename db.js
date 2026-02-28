// backend/db.js
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || 171982,
  database: process.env.PG_DB || "wealthwave",
});

module.exports = pool;
