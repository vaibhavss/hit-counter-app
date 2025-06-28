const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;

// Database configuration
const DB_TYPE = process.env.DB_TYPE || 'cosmos'; // 'cosmos' or 'sql'
const CONNECTION_STRING = process.env.CONNECTION_STRING;

app.use(cors());
app.use(express.json());

// Initialize database connection based on type
let dbClient;

async function initializeDatabase() {
  if (DB_TYPE === 'cosmos') {
    // Azure Cosmos DB setup
    const { CosmosClient } = require('@azure/cosmos');
    
    if (!CONNECTION_STRING) {
      console.log('Using in-memory storage (no CONNECTION_STRING provided)');
      return;
    }

    try {
      const client = new CosmosClient(CONNECTION_STRING);
      const { database } = await client.databases.createIfNotExists({ id: 'HitCounterDB' });
      const { container } = await database.containers.createIfNotExists({ 
        id: 'Hits',
        partitionKey: { paths: ['/id'] }
      });
      
      dbClient = { database, container };
      console.log('Connected to Azure Cosmos DB');
    } catch (error) {
      console.error('Failed to connect to Cosmos DB:', error);
      console.log('Falling back to in-memory storage');
    }
  } else if (DB_TYPE === 'sql') {
    // Azure SQL Database setup
    const sql = require('mssql');
    
    if (!CONNECTION_STRING) {
      console.log('Using in-memory storage (no CONNECTION_STRING provided)');
      return;
    }

    try {
      dbClient = await sql.connect(CONNECTION_STRING);
      console.log('Connected to Azure SQL Database');
    } catch (error) {
      console.error('Failed to connect to SQL Database:', error);
      console.log('Falling back to in-memory storage');
    }
  }
}

// In-memory storage fallback (shared across services in this demo)
let inMemoryHitCount = 0;

// API endpoint to get hit count
app.get('/api/hits', async (req, res) => {
  try {
    let count = 0;
    let hits = [];

    if (dbClient && DB_TYPE === 'cosmos') {
      // Query Cosmos DB
      const { resources } = await dbClient.container.items
        .query('SELECT * FROM c')
        .fetchAll();
      
      count = resources.length;
      hits = resources.slice(-10); // Last 10 hits
      
    } else if (dbClient && DB_TYPE === 'sql') {
      // Query SQL Database
      const countResult = await dbClient.request()
        .query('SELECT COUNT(*) as count FROM Hits');
      
      const hitsResult = await dbClient.request()
        .query('SELECT TOP 10 * FROM Hits ORDER BY timestamp DESC');
      
      count = countResult.recordset[0].count;
      hits = hitsResult.recordset;
      
    } else {
      // Use in-memory storage
      // In a real application, this would be shared via Redis or similar
      count = inMemoryHitCount;
      hits = [{ message: 'Using in-memory storage', count }];
    }

    res.json({ 
      success: true, 
      count, 
      recentHits: hits,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching hits:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch hits', count: 0 });
  }
});

// API endpoint to get hit statistics
app.get('/api/hits/stats', async (req, res) => {
  try {
    let stats = {
      totalHits: 0,
      hitsToday: 0,
      hitsThisWeek: 0,
      hitsThisMonth: 0
    };

    if (dbClient && DB_TYPE === 'cosmos') {
      // Get stats from Cosmos DB
      const { resources } = await dbClient.container.items
        .query('SELECT * FROM c')
        .fetchAll();
      
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      stats.totalHits = resources.length;
      stats.hitsToday = resources.filter(hit => new Date(hit.timestamp) >= today).length;
      stats.hitsThisWeek = resources.filter(hit => new Date(hit.timestamp) >= weekAgo).length;
      stats.hitsThisMonth = resources.filter(hit => new Date(hit.timestamp) >= monthAgo).length;

    } else if (dbClient && DB_TYPE === 'sql') {
      // Get stats from SQL Database
      const result = await dbClient.request().query(`
        SELECT 
          COUNT(*) as totalHits,
          SUM(CASE WHEN timestamp >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) as hitsToday,
          SUM(CASE WHEN timestamp >= DATEADD(week, -1, GETDATE()) THEN 1 ELSE 0 END) as hitsThisWeek,
          SUM(CASE WHEN timestamp >= DATEADD(month, -1, GETDATE()) THEN 1 ELSE 0 END) as hitsThisMonth
        FROM Hits
      `);
      
      stats = result.recordset[0];
    } else {
      stats.totalHits = inMemoryHitCount;
    }

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching hit stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch hit statistics' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'hit-counter',
    database: dbClient ? DB_TYPE : 'in-memory',
    timestamp: new Date().toISOString()
  });
});

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Hit Counter service running on port ${PORT}`);
    console.log(`Database type: ${dbClient ? DB_TYPE : 'in-memory'}`);
  });
});