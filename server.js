const express = require('express');
const cron = require('node-cron');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🎯 SCHEDULE CONFIGURATION - EASILY MODIFY THESE TWO LINES!
const CHECK_INTERVAL = '*/2 * * * *';      // Every 2 minutes (monitoring)
const AUTO_UPDATE_INTERVAL = '*/10 * * * *'; // Every 10 minutes (actual updates)
    
// 🕐 TESTING: Change to 10 minutes instead of 14 days
// Change back to 14 days after testing
// const fourteenDays = 14 * 24 * 60 * 60 * 1000;
const fourteenDays = 10 * 60 * 1000; // 10 minutes for testing

// CORS configuration for your domain
const corsOptions = {
  origin: [
    'https://smart-fit-ar.vercel.app',
    'http://localhost:3000',
    'http://localhost:5500'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
};

// Apply CORS middleware
app.use(cors(corsOptions));
app.use(express.json());

// Handle preflight requests
app.options('*', cors(corsOptions));

// Initialize Firebase Admin
console.log('Initializing Firebase Admin...');

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.log('Using FIREBASE_SERVICE_ACCOUNT_JSON environment variable');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://opportunity-9d3bf-default-rtdb.firebaseio.com"
  });
} else {
  console.log('No Firebase credentials found. Using default initialization (for testing only)');
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: "https://opportunity-9d3bf-default-rtdb.firebaseio.com"
  });
}

const db = admin.database();
console.log('Firebase Admin initialized successfully');

// Function to auto-confirm delivered orders after 10 minutes (for testing)
async function autoConfirmDeliveredOrders() {
  try {
    console.log('🔍 Checking for delivered orders older than 10 minutes...');
    
    const snapshot = await db.ref('smartfit_AR_Database/transactions').once('value');
    const transactions = snapshot.val();
    
    if (!transactions) {
      console.log('No transactions found');
      return { success: true, confirmedCount: 0 };
    }

    const currentTime = Date.now();

    let confirmedCount = 0;
    let checkedCount = 0;

    for (const userId in transactions) {
      for (const orderId in transactions[userId]) {
        checkedCount++;
        const order = transactions[userId][orderId];
        
        if (order.status && order.status.toLowerCase() === 'delivered') {
          if (order.statusUpdates) {
            const statusUpdates = Object.values(order.statusUpdates);
            const deliveredUpdate = statusUpdates.find(update => 
              update.status && update.status.toLowerCase() === 'delivered'
            );

            if (deliveredUpdate && deliveredUpdate.timestamp) {
              const timeSinceDelivered = currentTime - deliveredUpdate.timestamp;
              
              if (timeSinceDelivered > fourteenDays) {
                console.log(`🔄 Auto-confirming order ${orderId} for user ${userId}`);
                console.log(`⏰ Order delivered ${Math.round(timeSinceDelivered / (60 * 1000))} minutes ago`);
                
                const autoConfirmId = generateId();
                const autoConfirmTimestamp = Date.now();
                
                await db.ref(`smartfit_AR_Database/transactions/${userId}/${orderId}/statusUpdates/${autoConfirmId}`).set({
                  status: 'completed',
                  timestamp: autoConfirmTimestamp,
                  message: 'Order automatically confirmed as completed after 10 minutes of delivery (TESTING)',
                  location: 'System Auto-Confirm',
                  addedBy: 'System',
                  addedById: 'auto-confirm-system',
                  createdAt: new Date().toISOString(),
                  isAutoConfirmed: true,
                  minutesSinceDelivery: Math.round(timeSinceDelivered / (60 * 1000))
                });
                
                await db.ref(`smartfit_AR_Database/transactions/${userId}/${orderId}/status`).set('completed');
                
                console.log(`✅ Order ${orderId} auto-confirmed as completed after 10 minutes`);
                confirmedCount++;
              } else {
                const minutesRemaining = Math.ceil((fourteenDays - timeSinceDelivered) / (60 * 1000));
                console.log(`⏳ Order ${orderId} delivered ${Math.round(timeSinceDelivered / (60 * 1000))} minutes ago - ${minutesRemaining} minutes remaining`);
              }
            }
          }
        }
      }
    }
    
    console.log(`✅ Checked ${checkedCount} orders. ${confirmedCount} orders confirmed after 10 minutes.`);
    return { success: true, confirmedCount, checkedCount };
  } catch (error) {
    console.error('❌ Error in auto-confirm function:', error);
    throw error;
  }
}

// Function to get statistics about orders
async function getOrderStatistics() {
  try {
    const snapshot = await db.ref('smartfit_AR_Database/transactions').once('value');
    const transactions = snapshot.val();
    
    if (!transactions) {
      return { totalOrders: 0, deliveredOrders: 0, pendingAutoConfirm: 0 };
    }

    const currentTime = Date.now();
    
    let totalOrders = 0;
    let deliveredOrders = 0;
    let pendingAutoConfirm = 0;

    for (const userId in transactions) {
      for (const orderId in transactions[userId]) {
        totalOrders++;
        const order = transactions[userId][orderId];
        
        if (order.status && order.status.toLowerCase() === 'delivered') {
          deliveredOrders++;
          
          if (order.statusUpdates) {
            const statusUpdates = Object.values(order.statusUpdates);
            const deliveredUpdate = statusUpdates.find(update => 
              update.status && update.status.toLowerCase() === 'delivered'
            );

            if (deliveredUpdate && deliveredUpdate.timestamp) {
              const timeSinceDelivered = currentTime - deliveredUpdate.timestamp;
              if (timeSinceDelivered < fourteenDays) {
                pendingAutoConfirm++;
                const minutesRemaining = Math.ceil((fourteenDays - timeSinceDelivered) / (60 * 1000));
                console.log(`⏳ Order ${orderId}: ${Math.round(timeSinceDelivered / (60 * 1000))} minutes delivered, ${minutesRemaining} minutes remaining`);
              }
            }
          }
        }
      }
    }

    return { totalOrders, deliveredOrders, pendingAutoConfirm };
  } catch (error) {
    console.error('Error getting order statistics:', error);
    return { totalOrders: 0, deliveredOrders: 0, pendingAutoConfirm: 0 };
  }
}

// Helper function to generate ID
function generateId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

console.log('📅 Schedule Configuration:');
console.log(`   - Order Checks: ${CHECK_INTERVAL}`);
console.log(`   - Auto Updates: ${AUTO_UPDATE_INTERVAL}`);
console.log(`   - Timeframe: 10 minutes (TESTING MODE)`);

// Schedule 1: Check orders (monitoring only)
cron.schedule(CHECK_INTERVAL, () => {
  console.log(`🔍 [${CHECK_INTERVAL} Check] Scanning orders for monitoring...`);
  getOrderStatistics()
    .then(stats => {
      console.log(`📊 [${CHECK_INTERVAL} Check] Stats - Total: ${stats.totalOrders}, Delivered: ${stats.deliveredOrders}, Pending: ${stats.pendingAutoConfirm}`);
    })
    .catch(console.error);
});

// Schedule 2: Auto-update orders
cron.schedule(AUTO_UPDATE_INTERVAL, () => {
  console.log(`🔄 [${AUTO_UPDATE_INTERVAL} Update] Running auto-confirmation process...`);
  autoConfirmDeliveredOrders()
    .then(result => {
      console.log(`✅ [${AUTO_UPDATE_INTERVAL} Update] Completed: ${result.confirmedCount} orders auto-confirmed`);
    })
    .catch(console.error);
});

// Manual trigger endpoint
app.post('/trigger-auto-confirm', async (req, res) => {
  try {
    const result = await autoConfirmDeliveredOrders();
    res.json({ 
      success: true, 
      message: 'Auto-confirmation triggered manually',
      confirmedCount: result.confirmedCount,
      checkedCount: result.checkedCount,
      timeframe: '10 minutes (TESTING)',
      schedule: {
        checks: CHECK_INTERVAL,
        updates: AUTO_UPDATE_INTERVAL
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Auto-Confirm Delivery Service',
    domain: 'smart-fit-ar.vercel.app',
    timeframe: '10 minutes auto-completion (TESTING MODE)',
    schedule: {
      checks: CHECK_INTERVAL,
      updates: AUTO_UPDATE_INTERVAL
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📅 Schedule Configuration:`);
  console.log(`   🔍 Order Checks: ${CHECK_INTERVAL}`);
  console.log(`   🔄 Auto Updates: ${AUTO_UPDATE_INTERVAL}`);
  console.log(`   🕐 Timeframe: 10 minutes after delivery (TESTING)`);
  console.log(`🌐 CORS enabled for: https://smart-fit-ar.vercel.app`);
});

// Run immediately on startup
setTimeout(() => {
  console.log('Running initial auto-confirm check...');
  autoConfirmDeliveredOrders().catch(console.error);
}, 5000);