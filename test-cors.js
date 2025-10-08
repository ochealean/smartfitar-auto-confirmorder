// Test script to verify CORS is working
const https = require('https');

const options = {
  hostname: 'your-render-app.onrender.com', // Replace with your Render URL
  port: 443,
  path: '/test-cors',
  method: 'GET',
  headers: {
    'Origin': 'https://smart-fit-ar.vercel.app'
  }
};

const req = https.request(options, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', data);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.end();