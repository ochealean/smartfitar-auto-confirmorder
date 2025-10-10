const express = require('express');
const cron = require('node-cron');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 🎯 SCHEDULE CONFIGURATION
const CHECK_INTERVAL = '*/2 * * * *';      // Every 2 minutes (monitoring)
const AUTO_UPDATE_INTERVAL = '*/2 * * * *'; // Every 2 minutes (actual updates)
    
// 🕐 TESTING: Change to 10 minutes instead of 14 days
const timeframe = 10 * 60 * 1000; // 10 minutes for testing
// For production: const timeframe = 14 * 24 * 60 * 60 * 1000; // 14 days

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

// Function to check if order has unresolved issues
async function hasUnresolvedIssues(userId, orderId) {
  try {
    console.log(`🔍 Checking issue reports for order ${orderId}, user ${userId}`);
    
    const issueReportsSnapshot = await db.ref(`smartfit_AR_Database/issueReports/${userId}`).once('value');
    const issueReports = issueReportsSnapshot.val();
    
    if (!issueReports) {
      console.log(`✅ No issue reports found for user ${userId}`);
      return false;
    }
    
    // Check if any issue report matches this order ID and is unresolved
    for (const issueId in issueReports) {
      const issue = issueReports[issueId];
      if (issue.orderID === orderId && !issue.resolved) {
        console.log(`❌ Found unresolved issue for order ${orderId}: ${issueId}`);
        return true;
      }
    }
    
    console.log(`✅ No unresolved issues found for order ${orderId}`);
    return false;
  } catch (error) {
    console.error(`❌ Error checking issue reports for order ${orderId}:`, error);
    // If there's an error checking issues, be safe and don't auto-complete
    return true;
  }
}

// Function to auto-complete orders that have been "Out for Delivery" for the specified timeframe
async function autoCompleteOutForDeliveryOrders() {
  try {
    console.log(`🔍 Checking for "Out for Delivery" orders older than ${timeframe / (60 * 1000)} minutes...`);
    
    const snapshot = await db.ref('smartfit_AR_Database/transactions').once('value');
    const transactions = snapshot.val();
    
    if (!transactions) {
      console.log('No transactions found');
      return { success: true, completedCount: 0, skippedDueToIssues: 0 };
    }

    const currentTime = Date.now();

    let completedCount = 0;
    let checkedCount = 0;
    let skippedDueToIssues = 0;

    for (const userId in transactions) {
      for (const orderId in transactions[userId]) {
        checkedCount++;
        const order = transactions[userId][orderId];
        
        // Look for "Out for Delivery" status (case insensitive)
        if (order.status && order.status.toLowerCase() === 'out for delivery') {
          console.log(`📦 Found "Out for Delivery" order: ${orderId}`);
          
          if (order.statusUpdates) {
            const statusUpdates = Object.values(order.statusUpdates);
            const outForDeliveryUpdate = statusUpdates.find(update => 
              update.status && update.status.toLowerCase() === 'out for delivery'
            );

            if (outForDeliveryUpdate && outForDeliveryUpdate.timestamp) {
              const timeSinceOutForDelivery = currentTime - outForDeliveryUpdate.timestamp;
              const minutesSince = Math.round(timeSinceOutForDelivery / (60 * 1000));
              
              console.log(`⏰ Order ${orderId} has been "Out for Delivery" for ${minutesSince} minutes`);
              
              if (timeSinceOutForDelivery > timeframe) {
                // Check for unresolved issues before auto-completing
                const hasIssues = await hasUnresolvedIssues(userId, orderId);
                
                if (hasIssues) {
                  console.log(`⏸️  Skipping auto-completion for order ${orderId} due to unresolved issues`);
                  skippedDueToIssues++;
                  
                  // Add a monitoring status update (but don't complete the order)
                  const monitoringId = generateId();
                  const monitoringTimestamp = Date.now();
                  
                  await db.ref(`smartfit_AR_Database/transactions/${userId}/${orderId}/statusUpdates/${monitoringId}`).set({
                    status: 'out for delivery',
                    timestamp: monitoringTimestamp,
                    message: `Auto-completion skipped: Order has unresolved issue reports`,
                    location: 'System Monitor',
                    addedBy: 'System',
                    addedById: 'auto-complete-system',
                    createdAt: new Date().toISOString(),
                    isMonitoringUpdate: true,
                    minutesSinceOutForDelivery: minutesSince,
                    note: 'Order will remain in "Out for Delivery" status until issues are resolved'
                  });
                  
                  continue; // Skip to next order
                }
                
                console.log(`🔄 Auto-completing order ${orderId} for user ${userId}`);
                
                const autoCompleteId = generateId();
                const autoCompleteTimestamp = Date.now();
                
                // Add auto-completion status update
                await db.ref(`smartfit_AR_Database/transactions/${userId}/${orderId}/statusUpdates/${autoCompleteId}`).set({
                  status: 'completed',
                  timestamp: autoCompleteTimestamp,
                  message: `Order automatically completed after ${timeframe / (60 * 1000)} minutes of being out for delivery`,
                  location: 'System Auto-Complete',
                  addedBy: 'System',
                  addedById: 'auto-complete-system',
                  createdAt: new Date().toISOString(),
                  isAutoCompleted: true,
                  minutesSinceOutForDelivery: minutesSince
                });
                
                // Update main order status to "completed"
                await db.ref(`smartfit_AR_Database/transactions/${userId}/${orderId}/status`).set('completed');
                
                console.log(`✅ Order ${orderId} auto-completed after ${minutesSince} minutes of being out for delivery`);
                completedCount++;
              } else {
                const minutesRemaining = Math.ceil((timeframe - timeSinceOutForDelivery) / (60 * 1000));
                console.log(`⏳ Order ${orderId} - ${minutesRemaining} minutes remaining until auto-completion`);
              }
            } else {
              console.log(`❌ Order ${orderId} has "Out for Delivery" status but no timestamp in status updates`);
            }
          } else {
            console.log(`❌ Order ${orderId} has "Out for Delivery" status but no status updates`);
          }
        }
      }
    }
    
    console.log(`✅ Checked ${checkedCount} orders. ${completedCount} orders auto-completed, ${skippedDueToIssues} skipped due to unresolved issues after ${timeframe / (60 * 1000)} minutes.`);
    return { success: true, completedCount, checkedCount, skippedDueToIssues };
  } catch (error) {
    console.error('❌ Error in auto-complete function:', error);
    throw error;
  }
}

// Function to get statistics about orders
async function getOrderStatistics() {
  try {
    const snapshot = await db.ref('smartfit_AR_Database/transactions').once('value');
    const transactions = snapshot.val();
    
    if (!transactions) {
      return { totalOrders: 0, outForDeliveryOrders: 0, pendingAutoComplete: 0, ordersWithUnresolvedIssues: 0 };
    }

    const currentTime = Date.now();
    
    let totalOrders = 0;
    let outForDeliveryOrders = 0;
    let pendingAutoComplete = 0;
    let ordersWithUnresolvedIssues = 0;

    for (const userId in transactions) {
      for (const orderId in transactions[userId]) {
        totalOrders++;
        const order = transactions[userId][orderId];
        
        // Look for "Out for Delivery" status (case insensitive)
        if (order.status && order.status.toLowerCase() === 'out for delivery') {
          outForDeliveryOrders++;
          
          if (order.statusUpdates) {
            const statusUpdates = Object.values(order.statusUpdates);
            const outForDeliveryUpdate = statusUpdates.find(update => 
              update.status && update.status.toLowerCase() === 'out for delivery'
            );

            if (outForDeliveryUpdate && outForDeliveryUpdate.timestamp) {
              const timeSinceOutForDelivery = currentTime - outForDeliveryUpdate.timestamp;
              
              // Check for unresolved issues
              const hasIssues = await hasUnresolvedIssues(userId, orderId);
              if (hasIssues) {
                ordersWithUnresolvedIssues++;
                console.log(`⚠️  Order ${orderId} has unresolved issues - will not auto-complete`);
              }
              
              if (timeSinceOutForDelivery < timeframe && !hasIssues) {
                pendingAutoComplete++;
                const minutesRemaining = Math.ceil((timeframe - timeSinceOutForDelivery) / (60 * 1000));
                console.log(`⏳ Order ${orderId}: ${Math.round(timeSinceOutForDelivery / (60 * 1000))} minutes out for delivery, ${minutesRemaining} minutes remaining`);
              }
            }
          }
        }
      }
    }

    return { 
      totalOrders, 
      outForDeliveryOrders, 
      pendingAutoComplete, 
      ordersWithUnresolvedIssues 
    };
  } catch (error) {
    console.error('Error getting order statistics:', error);
    return { 
      totalOrders: 0, 
      outForDeliveryOrders: 0, 
      pendingAutoComplete: 0, 
      ordersWithUnresolvedIssues: 0 
    };
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
console.log(`   - Timeframe: ${timeframe / (60 * 1000)} minutes (TESTING MODE)`);
console.log(`   - Issue Check: Orders with unresolved issues will NOT auto-complete`);

// Schedule 1: Check orders (monitoring only)
cron.schedule(CHECK_INTERVAL, () => {
  console.log(`🔍 [${CHECK_INTERVAL} Check] Scanning orders for monitoring...`);
  getOrderStatistics()
    .then(stats => {
      console.log(`📊 [${CHECK_INTERVAL} Check] Stats - Total: ${stats.totalOrders}, Out for Delivery: ${stats.outForDeliveryOrders}, Pending: ${stats.pendingAutoComplete}, With Issues: ${stats.ordersWithUnresolvedIssues}`);
    })
    .catch(console.error);
});

// Schedule 2: Auto-update orders
cron.schedule(AUTO_UPDATE_INTERVAL, () => {
  console.log(`🔄 [${AUTO_UPDATE_INTERVAL} Update] Running auto-completion process...`);
  autoCompleteOutForDeliveryOrders()
    .then(result => {
      console.log(`✅ [${AUTO_UPDATE_INTERVAL} Update] Completed: ${result.completedCount} orders auto-completed, ${result.skippedDueToIssues} skipped due to issues`);
    })
    .catch(console.error);
});

// Manual trigger endpoint
app.post('/trigger-auto-complete', async (req, res) => {
  try {
    const result = await autoCompleteOutForDeliveryOrders();
    res.json({ 
      success: true, 
      message: 'Auto-completion triggered manually',
      completedCount: result.completedCount,
      checkedCount: result.checkedCount,
      skippedDueToIssues: result.skippedDueToIssues,
      timeframe: `${timeframe / (60 * 1000)} minutes (TESTING)`,
      note: 'Orders with unresolved issue reports are NOT auto-completed',
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
    service: 'Auto-Complete Delivery Service',
    domain: 'smart-fit-ar.vercel.app',
    timeframe: `${timeframe / (60 * 1000)} minutes auto-completion (TESTING MODE)`,
    feature: 'Orders with unresolved issue reports are NOT auto-completed',
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
  console.log(`   🕐 Timeframe: ${timeframe / (60 * 1000)} minutes after "Out for Delivery" (TESTING)`);
  console.log(`   ⚠️  Issue Check: Orders with unresolved issues will NOT auto-complete`);
  console.log(`🌐 CORS enabled for: https://smart-fit-ar.vercel.app`);
});

// Run immediately on startup
setTimeout(() => {
  console.log('Running initial auto-complete check...');
  autoCompleteOutForDeliveryOrders().catch(console.error);
}, 5000);