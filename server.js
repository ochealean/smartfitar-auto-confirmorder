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
    'https://smart-fit-ar.vercel.app/',
    'http://localhost:3000', // for local development
    'http://localhost:5500'  // common local dev server port
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

// Initialize Firebase Admin with your existing config
const serviceAccount = {
  type: "service_account",
  project_id: "opportunity-9d3bf",
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  universe_domain: "googleapis.com"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://opportunity-9d3bf-default-rtdb.firebaseio.com"
});

const db = admin.database();

// Function to auto-confirm delivered orders after 24 hours
async function autoConfirmDeliveredOrders() {
  try {
    console.log('🔍 Checking for orders to auto-confirm...');
    
    const snapshot = await db.ref('smartfit_AR_Database/transactions').once('value');
    const transactions = snapshot.val();
    
    if (!transactions) {
      console.log('No transactions found');
      return;
    }

    const currentTime = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    let confirmedCount = 0;

    for (const userId in transactions) {
      for (const orderId in transactions[userId]) {
        const order = transactions[userId][orderId];
        
        // Check if order status is "delivered"
        if (order.status && order.status.toLowerCase() === 'delivered') {
          // Check if we have status updates
          if (order.statusUpdates) {
            const statusUpdates = Object.values(order.statusUpdates);
            const deliveredUpdate = statusUpdates.find(update => 
              update.status && update.status.toLowerCase() === 'delivered'
            );

            if (deliveredUpdate && deliveredUpdate.timestamp) {
              const timeSinceDelivered = currentTime - deliveredUpdate.timestamp;
              
              // If it's been more than 24 hours since delivery
              if (timeSinceDelivered > twentyFourHours) {
                console.log(`🔄 Auto-confirming order ${orderId} for user ${userId}`);
                
                // Generate unique ID for the auto-confirmation update
                const autoConfirmId = generateId();
                const autoConfirmTimestamp = Date.now();
                
                // Add auto-confirmation status update
                await db.ref(`smartfit_AR_Database/transactions/${userId}/${orderId}/statusUpdates/${autoConfirmId}`).set({
                  status: 'completed',
                  timestamp: autoConfirmTimestamp,
                  message: 'Order automatically confirmed as completed after 24 hours of delivery',
                  location: 'System Auto-Confirm',
                  addedBy: 'System',
                  addedById: 'auto-confirm-system',
                  createdAt: new Date().toISOString(),
                  isAutoConfirmed: true
                });
                
                // Update main order status to "completed"
                await db.ref(`smartfit_AR_Database/transactions/${userId}/${orderId}/status`).set('completed');
                
                console.log(`✅ Order ${orderId} auto-confirmed as completed`);
                confirmedCount++;
              }
            }
          }
        }
      }
    }
    
    console.log(`✅ Auto-confirmation check completed. ${confirmedCount} orders confirmed.`);
    return { success: true, confirmedCount };
  } catch (error) {
    console.error('❌ Error in auto-confirm function:', error);
    throw error;
  }
}

// Helper function to generate ID (similar to your client-side function)
function generateId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

// Schedule the task to run every hour
cron.schedule('0 * * * *', autoConfirmDeliveredOrders); // Run every hour at minute 0

// Manual trigger endpoint (for testing)
app.post('/trigger-auto-confirm', async (req, res) => {
  try {
    const result = await autoConfirmDeliveredOrders();
    res.json({ 
      success: true, 
      message: 'Auto-confirmation triggered manually',
      confirmedCount: result.confirmedCount,
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
    domain: 'smart-fit-ar.vercel.app'
  });
});

// Get service status
app.get('/status', (req, res) => {
  res.json({
    service: 'Auto-Confirm Delivery Service',
    status: 'running',
    nextRun: 'Every hour at minute 0',
    supportedDomains: ['https://smart-fit-ar.vercel.app'],
    timestamp: new Date().toISOString()
  });
});

// Test endpoint to verify CORS is working
app.get('/test-cors', (req, res) => {
  res.json({
    message: 'CORS is working!',
    yourDomain: 'smart-fit-ar.vercel.app',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`⏰ Auto-confirm service started - will check every hour`);
  console.log(`🌐 CORS enabled for: https://smart-fit-ar.vercel.app`);
});

// Run immediately on startup (optional)
autoConfirmDeliveredOrders();