const jwt = require('jsonwebtoken');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const appId = 'YOUR_VONAGE_APPLICATION_ID';
const privateKeyPath =
  'C:/Users/ASUS/Downloads/private_d288976f-f070-4b43-b5e8-30911208392f.key';

const privateKey = fs.readFileSync(privateKeyPath);

const now = Math.floor(Date.now() / 1000);

const payload = {
  application_id: appId,
  sub: 'flutter_user',

  iat: now,
  exp: Math.floor(Date.now() / 1000) + 86400, 

  jti: uuidv4(),

  acl: {
    paths: {
      "/*/users/**": {},
      "/*/conversations/**": {},
      "/*/sessions/**": {},
      "/*/devices/**": {},
      "/*/push/**": {},
      "/*/knocking/**": {},
      "/*/legs/**": {},
      "/*/rtc/**": {}
    }
  }
};

const token = jwt.sign(payload, privateKey, {
  algorithm: 'RS256'
});

console.log('\nNEW JWT:\n');
console.log(token);
console.log('\n----------------------------------------\n');