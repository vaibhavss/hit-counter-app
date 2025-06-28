const express = require("express");
const axios = require("axios");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const HIT_LOGGER_SERVICE_URL =
  process.env.HIT_LOGGER_SERVICE_URL || "http://localhost:3001";
const HIT_COUNTER_SERVICE_URL =
  process.env.HIT_COUNTER_SERVICE_URL || "http://localhost:3002";

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API endpoint to handle hit button clicks
app.post("/api/hit", async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    const userAgent = req.headers["user-agent"];
    const ip = req.ip || req.connection.remoteAddress;

    // Call hit logger service
    await axios.post(`${HIT_LOGGER_SERVICE_URL}/api/log-hit`, {
      timestamp,
      userAgent,
      ip,
    });

    res.json({ success: true, message: "Hit logged successfully" });
  } catch (error) {
    console.error("Error logging hit:", error.message);
    res.status(500).json({ success: false, message: "Failed to log hit" });
  }
});

// API endpoint to get current hit count
app.get("/api/hits", async (req, res) => {
  try {
    const response = await axios.get(`${HIT_COUNTER_SERVICE_URL}/api/hits`);
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching hits:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch hits", count: 0 });
  }
});

app.listen(PORT, () => {
  console.log(`Frontend service running on port ${PORT}`);
});
