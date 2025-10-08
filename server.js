const express = require('express');
const cron = require('node-cron');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

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
} else if (process.env.FIREBASE_PRIVATE_KEY) {
  console.log('Using individual Firebase environment variables');
  const serviceAccount = {
    type: "service_account",
    project_id: "opportunity-9d3bf",
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
  };
  
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

// Function to auto-confirm delivered orders after 14 days
async function autoConfirmDeliveredOrders() {
  try {
    console.log('🔍 Checking for delivered orders older than 14 days...');
    
    const snapshot = await db.ref('smartfit_AR_Database/transactions').once('value');
    const transactions = snapshot.val();
    
    if (!transactions) {
      console.log('No transactions found');
      return { success: true, confirmedCount: 0 };
    }

    const currentTime = Date.now();
    const fourteenDays = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds

    let confirmedCount = 0;

    for (const userId in transactions) {
      for (const orderId in transactions[userId]) {
        const order = transactions[userId][orderId];
        
        // Check if order status is "delivered" (not already completed)
        if (order.status && order.status.toLowerCase() === 'delivered') {
          // Check if we have status updates
          if (order.statusUpdates) {
            const statusUpdates = Object.values(order.statusUpdates);
            const deliveredUpdate = statusUpdates.find(update => 
              update.status && update.status.toLowerCase() === 'delivered'
            );

            if (deliveredUpdate && deliveredUpdate.timestamp) {
              const timeSinceDelivered = currentTime - deliveredUpdate.timestamp;
              
              // If it's been more than 14 days since delivery
              if (timeSinceDelivered > fourteenDays) {
                console.log(`🔄 Auto-confirming order ${orderId} for user ${userId}`);
                console.log(`⏰ Order delivered ${Math.round(timeSinceDelivered / (24 * 60 * 60 * 1000))} days ago`);
                
                // Generate unique ID for the auto-confirmation update
                const autoConfirmId = generateId();
                const autoConfirmTimestamp = Date.now();
                
                // Add auto-confirmation status update
                await db.ref(`smartfit_AR_Database/transactions/${userId}/${orderId}/statusUpdates/${autoConfirmId}`).set({
                  status: 'completed',
                  timestamp: autoConfirmTimestamp,
                  message: 'Order automatically confirmed as completed after 14 days of delivery',
                  location: 'System Auto-Confirm',
                  addedBy: 'System',
                  addedById: 'auto-confirm-system',
                  createdAt: new Date().toISOString(),
                  isAutoConfirmed: true,
                  daysSinceDelivery: Math.round(timeSinceDelivered / (24 * 60 * 60 * 1000))
                });
                
                // Update main order status to "completed"
                await db.ref(`smartfit_AR_Database/transactions/${userId}/${orderId}/status`).set('completed');
                
                console.log(`✅ Order ${orderId} auto-confirmed as completed after 14 days`);
                confirmedCount++;
              } else {
                const daysRemaining = Math.ceil((fourteenDays - timeSinceDelivered) / (24 * 60 * 60 * 1000));
                console.log(`⏳ Order ${orderId} delivered ${Math.round(timeSinceDelivered / (24 * 60 * 60 * 1000))} days ago - ${daysRemaining} days remaining until auto-completion`);
              }
            }
          }
        }
      }
    }
    
    console.log(`✅ Auto-confirmation check completed. ${confirmedCount} orders confirmed after 14 days.`);
    return { success: true, confirmedCount };
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
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    
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

// Schedule the task to run every 6 hours (more efficient for 14-day window)
cron.schedule('0 */6 * * *', () => {
  console.log('⏰ Scheduled auto-confirm job running...');
  autoConfirmDeliveredOrders().catch(console.error);
});

// Manual trigger endpoint
app.post('/trigger-auto-confirm', async (req, res) => {
  try {
    const result = await autoConfirmDeliveredOrders();
    res.json({ 
      success: true, 
      message: 'Auto-confirmation triggered manually',
      confirmedCount: result.confirmedCount,
      timeframe: '14 days',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get order statistics endpoint
app.get('/statistics', async (req, res) => {
  try {
    const stats = await getOrderStatistics();
    res.json({
      success: true,
      statistics: stats,
      timeframe: '14 days auto-confirm',
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
    timeframe: '14 days auto-completion'
  });
});

// Get service status
app.get('/status', async (req, res) => {
  try {
    const stats = await getOrderStatistics();
    res.json({
      service: 'Auto-Confirm Delivery Service',
      status: 'running',
      nextRun: 'Every 6 hours',
      timeframe: '14 days after delivery',
      supportedDomains: ['https://smart-fit-ar.vercel.app'],
      statistics: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test endpoint to verify CORS is working
app.get('/test-cors', (req, res) => {
  res.json({
    message: 'CORS is working!',
    yourDomain: 'smart-fit-ar.vercel.app',
    timeframe: '14 days auto-completion',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`⏰ Auto-confirm service started - will check every 6 hours`);
  console.log(`📅 Timeframe: 14 days after delivery`);
  console.log(`🌐 CORS enabled for: https://smart-fit-ar.vercel.app`);
});

// Run immediately on startup
setTimeout(() => {
  console.log('Running initial auto-confirm check...');
  autoConfirmDeliveredOrders().catch(console.error);
}, 5000);