const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

// Database configuration
const DB_TYPE = process.env.DB_TYPE || "cosmos"; // 'cosmos' or 'sql'
const CONNECTION_STRING = process.env.CONNECTION_STRING;

app.use(cors());
app.use(express.json());

// Initialize database connection based on type
let dbClient;

async function initializeDatabase() {
  if (DB_TYPE === "cosmos") {
    // Azure Cosmos DB setup
    const { CosmosClient } = require("@azure/cosmos");

    if (!CONNECTION_STRING) {
      console.log("Using in-memory storage (no CONNECTION_STRING provided)");
      return;
    }

    try {
      const client = new CosmosClient(CONNECTION_STRING);
      const { database } = await client.databases.createIfNotExists({
        id: "HitCounterDB",
      });
      const { container } = await database.containers.createIfNotExists({
        id: "Hits",
        partitionKey: { paths: ["/id"] },
      });

      dbClient = { database, container };
      console.log("Connected to Azure Cosmos DB");
    } catch (error) {
      console.error("Failed to connect to Cosmos DB:", error);
      console.log("Falling back to in-memory storage");
    }
  } else if (DB_TYPE === "sql") {
    // Azure SQL Database setup
    const sql = require("mssql");

    if (!CONNECTION_STRING) {
      console.log("Using in-memory storage (no CONNECTION_STRING provided)");
      return;
    }

    try {
      dbClient = await sql.connect(CONNECTION_STRING);

      // Create table if it doesn't exist
      await dbClient.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Hits' AND xtype='U')
        CREATE TABLE Hits (
          id int IDENTITY(1,1) PRIMARY KEY,
          timestamp datetime2 NOT NULL,
          userAgent nvarchar(500),
          ip nvarchar(50)
        )
      `);

      console.log("Connected to Azure SQL Database");
    } catch (error) {
      console.error("Failed to connect to SQL Database:", error);
      console.log("Falling back to in-memory storage");
    }
  }
}

// In-memory storage fallback
let inMemoryHits = [];

// API endpoint to log a hit
app.post("/api/log-hit", async (req, res) => {
  try {
    const { timestamp, userAgent, ip } = req.body;

    if (!timestamp) {
      return res
        .status(400)
        .json({ success: false, message: "Timestamp is required" });
    }

    const hitData = {
      timestamp: new Date(timestamp),
      userAgent: userAgent || "Unknown",
      ip: ip || "Unknown",
    };

    if (dbClient && DB_TYPE === "cosmos") {
      // Store in Cosmos DB
      const hitDocument = {
        id: `hit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...hitData,
        _ts: Math.floor(Date.now() / 1000),
      };

      await dbClient.container.items.create(hitDocument);
      console.log("Hit logged to Cosmos DB:", hitDocument);
    } else if (dbClient && DB_TYPE === "sql") {
      // Store in SQL Database
      const request = dbClient.request();
      await request
        .input("timestamp", hitData.timestamp)
        .input("userAgent", hitData.userAgent)
        .input("ip", hitData.ip)
        .query(
          "INSERT INTO Hits (timestamp, userAgent, ip) VALUES (@timestamp, @userAgent, @ip)"
        );

      console.log("Hit logged to SQL Database:", hitData);
    } else {
      // Store in memory
      inMemoryHits.push({
        id: inMemoryHits.length + 1,
        ...hitData,
      });
      console.log("Hit logged to memory:", hitData);
    }

    res.json({ success: true, message: "Hit logged successfully" });
  } catch (error) {
    console.error("Error logging hit:", error);
    res.status(500).json({ success: false, message: "Failed to log hit" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "hit-logger",
    database: dbClient ? DB_TYPE : "in-memory",
    timestamp: new Date().toISOString(),
  });
});

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Hit Logger service running on port ${PORT}`);
    console.log(`Database type: ${dbClient ? DB_TYPE : "in-memory"}`);
  });
});
