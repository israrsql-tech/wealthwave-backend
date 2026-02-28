require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors({ origin: "http://localhost:3000", credentials: true }));

// app.use(cors({
//   origin: "*",
//   credentials: true
// }));

app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

const billPaymentsRoutes = require('./routes/billPayments');
app.use('/api/bill-payments', billPaymentsRoutes);

const billsRoutes = require('./routes/bills');
app.use('/api/bills', billsRoutes);

const potMovementsRoutes = require('./routes/potMovements');
app.use('/api/pot-movements', potMovementsRoutes);

const potsRoutes = require('./routes/pots');
app.use('/api/pots', potsRoutes);

const budgetsRoutes = require('./routes/budgets');
app.use('/api/budgets', budgetsRoutes);

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);
const transactionsRoutes = require("./routes/transactions");
app.use("/api/transactions", transactionsRoutes);

const aiRoutes = require("./routes/ai");
app.use("/api/ai", aiRoutes);

// yahan baad me /api/auth, /api/transactions etc. mount karoge
app.listen(4000, () => {
  console.log("Backend running on http://localhost:4000");
});

// app.listen(4000, "0.0.0.0", () => {
//   console.log("Backend running on http://10.113.213.87:4000");
// });