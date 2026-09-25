const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

const app = express();

app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
  }),
);


const APPLICATION_ID = process.env.VONAGE_APPLICATION_ID;
const PRIVATE_KEY = process.env.VONAGE_PRIVATE_KEY;
const USERNAME = process.env.VONAGE_USERNAME || "flutter_user";
const VONAGE_NUMBER = process.env.VONAGE_NUMBER;

const BASE_URL =
  process.env.BASE_URL || "https://call-recorder-server.vercel.app";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

let latestRecordingData = null;


function normalizePhone(value) {
  if (value === undefined || value === null) {
    return null;
  }

  let phone = String(value).trim();
  phone = phone.replace(/[\s().-]/g, "");

  if (phone.startsWith("00")) {
    phone = phone.substring(2);
  }

  if (phone.startsWith("+")) {
    phone = phone.substring(1);
  }

  if (!/^[1-9]\d{7,14}$/.test(phone)) {
    return null;
  }

  return phone;
}

function checkEnvironment() {
  const missing = [];

  if (!APPLICATION_ID) missing.push("VONAGE_APPLICATION_ID");
  if (!PRIVATE_KEY) missing.push("VONAGE_PRIVATE_KEY");
  if (!USERNAME) missing.push("VONAGE_USERNAME");
  if (!VONAGE_NUMBER) missing.push("VONAGE_NUMBER");

  return missing;
}

function getPrivateKey() {
  if (!PRIVATE_KEY) {
    throw new Error("VONAGE_PRIVATE_KEY is not configured");
  }
  return PRIVATE_KEY.replace(/\\n/g, "\n").trim();
}

app.get("/health", (req, res) => {
  const missing = checkEnvironment();
  return res.json({
    success: missing.length === 0,
    service: "Vonage Call Center API",
    environment: process.env.VERCEL ? "vercel" : "local",
    baseUrl: BASE_URL,
    missingEnvironmentVariables: missing,
  });
});

app.get("/debug", (req, res) => {
  const missing = checkEnvironment();
  return res.json({
    applicationId: APPLICATION_ID || null,
    username: USERNAME || null,
    vonageNumber: VONAGE_NUMBER || null,
    baseUrl: BASE_URL,
    hasPrivateKey: !!PRIVATE_KEY,
    missingEnvironmentVariables: missing,
  });
});

app.get("/token", (req, res) => {
  try {
    const missing = checkEnvironment();
    if (missing.length > 0) {
      return res.status(500).json({ success: false, error: "Missing environment variables", missing });
    }

    const username =
      typeof req.query.user === "string" && req.query.user.trim()
        ? req.query.user.trim()
        : USERNAME;

    const now = Math.floor(Date.now() / 1000);

    const payload = {
      application_id: APPLICATION_ID,
      sub: username,
      iat: now,
      exp: now + 60 * 60,
      jti: crypto.randomUUID(),
      acl: {
        paths: {
          "/*/users/**": {},
          "/*/conversations/**": {},
          "/*/sessions/**": {},
          "/*/devices/**": {},
          "/*/push/**": {},
          "/*/knocking/**": {},
          "/*/legs/**": {},
          "/*/rtc/**": {},
        },
      },
    };

    const privateKey = getPrivateKey();
    const token = jwt.sign(payload, privateKey, { algorithm: "RS256" });

    return res.json({ success: true, token, user: username, expiresAt: payload.exp });
  } catch (error) {
    console.error("JWT generation error:", error);
    return res.status(500).json({ success: false, error: "Failed to generate Vonage JWT", message: error.message });
  }
});

app.all('/answer', (req, res) => {
  try {
    const destination = normalizePhone(req.query.to || req.body?.to);
    const fromNumber = normalizePhone(process.env.VONAGE_NUMBER);

    if (!destination) {
      return res.status(400).json({ error: 'Invalid destination number' });
    }

    if (!fromNumber) {
      return res.status(500).json({ error: 'Invalid VONAGE_NUMBER' });
    }

    const recordingUrl = `${process.env.BASE_URL}/recordings`;
    const callEventUrl = `${process.env.BASE_URL}/events`;

    const ncco = [
      {
        action: 'record',
        format: 'mp3',
        eventMethod: 'POST',
        eventUrl: [recordingUrl],
        beepStart: true,
      },
      {
        action: 'connect',
        from: fromNumber,
        endpoint: [{ type: 'phone', number: destination }],
        eventUrl: [callEventUrl],
      },
    ];

    return res.json(ncco);
  } catch (error) {
    console.error('ANSWER ERROR:', error);
    return res.status(500).json({ error: 'Failed to generate NCCO', message: error.message });
  }
});


app.post("/recordings", async (req, res) => {
  console.log("========================================");
  console.log("VONAGE RECORDING WEBHOOK RECEIVED");
  console.log("========================================");

  try {
    const recordingUrl = req.body?.recording_url;
    const conversationUuid = req.body?.conversation_uuid;

    if (!recordingUrl) {
      console.error("No recording URL in payload");
      return res.sendStatus(204);
    }

    const now = Math.floor(Date.now() / 1000);
    const downloadToken = jwt.sign(
      {
        application_id: APPLICATION_ID,
        iat: now,
        exp: now + 300,
        jti: crypto.randomUUID(),
      },
      getPrivateKey(),
      { algorithm: "RS256" }
    );

    console.log("Downloading audio file from Vonage...");
    const vonageFileResponse = await fetch(recordingUrl, {
      headers: { Authorization: `Bearer ${downloadToken}` },
    });

    if (!vonageFileResponse.ok) {
      console.error("Failed to download file from Vonage:", vonageFileResponse.status);
      return res.sendStatus(204);
    }

    const arrayBuffer = await vonageFileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log("Uploading audio buffer to Cloudinary...");
    
    // Upload buffer to Cloudinary as a raw/video/auto resource stream
    const cloudinaryUpload = () => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: "auto",
            folder: "call_recordings",
            public_id: `rec_${conversationUuid || Date.now()}`,
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(buffer);
      });
    };

    const uploadResult = await cloudinaryUpload();
    const publicAudioUrl = uploadResult.secure_url;
    console.log("✅ Successfully uploaded to Cloudinary:", publicAudioUrl);

    latestRecordingData = {
      url: publicAudioUrl,
      timestamp: req.body?.timestamp,
    };

    // Extract client ID (using conversation ID or a fallback placeholder if phone info isn't embedded directly)
    const clientId = req.body?.user_data || conversationUuid || "client-123";

    // console.log("Forwarding public URL to target endpoint: ", process.env.CALL_CENTER_URL + "/api/process-config");

    // Post public URL to your another project endpoint
    const processConfigResponse = await fetch(process.env.CALL_CENTER_URL + "/api/process-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret: process.env.API_SECRET ,
        link: publicAudioUrl,
        clientId: clientId,
      }),
    });

    const responseText = await processConfigResponse.text();
    console.log("Target endpoint response:", processConfigResponse.status, responseText);

  } catch (err) {
    console.error("Error processing recording webhook:", err);
  }

  return res.sendStatus(204);
});

app.get("/latest-recording", (req, res) => {
  return res.json({
    success: true,
    data: latestRecordingData,
  });
});

app.all("/events", (req, res) => {
  return res.sendStatus(204);
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "CrowdSnap Call Center Vonage API",
  });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}