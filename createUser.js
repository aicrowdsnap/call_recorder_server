const jwt = require('jsonwebtoken');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const privateKeyPath = 'C:/Users/ASUS/Downloads/private.key';
const privateKey = fs.readFileSync(privateKeyPath);

// 1. Generate an Admin Token to authorize the API request
const payload = {
  application_id: '905a1e3a-b542-418a-ad87-0662c7772345',
  jti: uuidv4()
};

const adminToken = jwt.sign(payload, privateKey, {
  algorithm: 'RS256',
  expiresIn: '1h'
});

// 2. Make a direct HTTP request to the Vonage API to create the user
async function createVonageUser() {
  console.log("Contacting Vonage API to create 'flutter_user'...");
  
  try {
    const response = await fetch('https://api.nexmo.com/v1/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ name: 'flutter_user' })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('\n✅ SUCCESS! User registered in Vonage database:');
      console.log(`User ID: ${data.id}`);
      console.log(`User Name: ${data.name}\n`);
    } else {
      console.error('\n❌ API ERROR (It is okay if it says "User already exists"):');
      console.error(data);
    }
  } catch (err) {
    console.error('\n❌ Network Error:', err);
  }
}

createVonageUser();