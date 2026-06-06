require('dotenv').config();
console.log("JWT:", process.env.JWT_SECRET);
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
console.log(
  "📁 CWD:",
  process.cwd()
);

console.log(
  "📁 USERS PATH:",
  require('path').resolve('users.json')
);

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.connect()
  .then(async () => {

    console.log("✅ POSTGRES CONNECTED");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        contacts JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("✅ USERS TABLE READY");

    await pool.query(`
  CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    user_username VARCHAR(100) NOT NULL,
    contact_username VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )
`);

console.log("✅ CONTACTS TABLE READY");

await pool.query(`
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,

    message_id VARCHAR(255) UNIQUE,

    sender VARCHAR(100),
    recipient VARCHAR(100),

    group_id VARCHAR(255),

    status VARCHAR(50),

    recipient_text TEXT,
    recipient_nonce TEXT,
    recipient_eph_key TEXT,

    self_text TEXT,
    self_nonce TEXT,
    self_eph_key TEXT,

    created_at BIGINT
  )
`);

console.log("✅ MESSAGES TABLE READY");

const usersInDb = await pool.query(
  'SELECT username FROM users'
);

console.log("👥 USERS IN DATABASE:");
console.log(usersInDb.rows);

  })
  .catch(err => {

    console.log("❌ POSTGRES ERROR");
    console.log(err);

  });

app.get("/", (req, res) => {
  res.send("SERVER DZIAŁA");
});

// ===== USERS =====
let users = [];

try {
  const data = fs.readFileSync('users.json');
  users = JSON.parse(data);
} catch {
  users = [];
}
console.log("👤 USERS LOADED:");
console.log(users);

// ===== MESSAGES =====
let messages = [];

if (fs.existsSync('messages.json')) {
  try {
    messages = JSON.parse(fs.readFileSync('messages.json'));
  } catch {
    messages = [];
  }
}

fs.writeFileSync('messages.json', JSON.stringify(messages, null, 2));
// ===== JWT VERIFY =====
function verifyToken(token) {
  try {

    return jwt.verify(
      token,
      process.env.JWT_SECRET
    );

  } catch {

    return null;

  }
}
// ===== REGISTER =====
app.post('/register', async (req, res) => {
  console.log("🔥 REGISTER HIT");
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Brak danych' });
  }

const existingUser = await pool.query(
  `SELECT * FROM users
   WHERE username = $1`,
  [username]
);

    if (existingUser.rows.length > 0) {
  return res.status(400).json({
    error: 'Username zajęty'
  });
}

  const hashedPassword = await bcrypt.hash(password, 10);

await pool.query(
  `
  INSERT INTO users
  (
    username,
    password_hash,
    contacts
  )
  VALUES
  (
    $1,
    $2,
    $3
  )
  `,
  [
    username,
    hashedPassword,
    JSON.stringify([])
  ]
);

const check = await pool.query(
  'SELECT username FROM users'
);

console.log(
  '👥 USERS AFTER INSERT:'
);

console.log(check.rows);

console.log(
  "🔥 FILE CONTENT:"
);

console.log(
  "🔥 FILE CONTENT:"
);

console.log(
  fs.readFileSync(
    'users.json',
    'utf8'
  )
);

  res.json({ message: 'Użytkownik utworzony' });
});

// ===== LOGIN =====
app.post('/login', async (req, res) => {

  const { username, password } = req.body;

  const result = await pool.query(
    `
    SELECT *
    FROM users
    WHERE username = $1
    `,
    [username]
  );

  if (result.rows.length === 0) {
    return res.status(400).json({
      error: 'Błędne dane'
    });
  }

  const user = result.rows[0];

  const valid = await bcrypt.compare(
    password,
    user.password_hash
  );

  if (!valid) {
    return res.status(400).json({
      error: 'Błędne dane'
    });
  }

  const token = jwt.sign(
    { username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    contacts: user.contacts || []
  });

});

// ===== ADD CONTACT =====
app.post('/add-contact', async (req, res) => {

  const { username, contact } = req.body;

  console.log(
    "ADD CONTACT:",
    username,
    contact
  );

  const userCheck = await pool.query(
    `SELECT username
     FROM users
     WHERE username = $1`,
    [username]
  );

  const contactCheck = await pool.query(
    `SELECT username
     FROM users
     WHERE username = $1`,
    [contact]
  );

  if (
    userCheck.rows.length === 0 ||
    contactCheck.rows.length === 0
  ) {
    return res.status(400).json({
      error: "Użytkownik nie istnieje"
    });
  }

  const alreadyExists = await pool.query(
    `
    SELECT *
    FROM contacts
    WHERE user_username = $1
    AND contact_username = $2
    `,
    [username, contact]
  );

  if (alreadyExists.rows.length === 0) {

    await pool.query(
      `
      INSERT INTO contacts
      (
        user_username,
        contact_username
      )
      VALUES
      (
        $1,
        $2
      )
      `,
      [username, contact]
    );

    await pool.query(
      `
      INSERT INTO contacts
      (
        user_username,
        contact_username
      )
      VALUES
      (
        $1,
        $2
      )
      `,
      [contact, username]
    );

  }

  const contacts = await pool.query(
    `
    SELECT contact_username
    FROM contacts
    WHERE user_username = $1
    `,
    [username]
  );

  res.json({
    success: true,
    contacts: contacts.rows.map(
      c => c.contact_username
    )
  });

});

// 🔥 GET CONTACTS
app.get('/contacts/:username', async (req, res) => {

  const { username } = req.params;

  const contacts = await pool.query(
    `
    SELECT contact_username
    FROM contacts
    WHERE user_username = $1
    `,
    [username]
  );

  res.json({
    contacts: contacts.rows.map(
      c => c.contact_username
    )
  });

});

// 🔥 USUWANIE KONTAKTU
app.post('/remove-contact', async (req, res) => {

  const { username, contact } = req.body;

  console.log(
    "REMOVE CONTACT:",
    username,
    contact
  );

  await pool.query(
    `
    DELETE FROM contacts
    WHERE user_username = $1
    AND contact_username = $2
    `,
    [username, contact]
  );

  await pool.query(
    `
    DELETE FROM contacts
    WHERE user_username = $1
    AND contact_username = $2
    `,
    [contact, username]
  );

  const contacts = await pool.query(
    `
    SELECT contact_username
    FROM contacts
    WHERE user_username = $1
    `,
    [username]
  );

  res.json({
    success: true,
    contacts: contacts.rows.map(
      c => c.contact_username
    )
  });

});

// ===== GET MESSAGES =====
app.get('/messages/:user/:chat', (req, res) => {
  const { user, chat } = req.params;

  const allMessages = JSON.parse(fs.readFileSync('messages.json', 'utf-8') || '[]');

  const filtered = allMessages.filter(
    m =>
      (m.from === user && m.to === chat) ||
      (m.from === chat && m.to === user) ||
      (m.groupId && m.groupId === chat)
  );

  res.json(filtered);
});
// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Server działa na porcie:', PORT);
});

const wss = new WebSocket.Server({ server });

const clients = {};
const publicKeys = {};
const groups = {};
const onlineUsers = new Set();

wss.on('connection', (ws) => {
  console.log("🟢 NOWE POŁĄCZENIE");  

ws.on("message", async (msg) => {
  let data;
  try {
    data = JSON.parse(msg);
if (data.type === "ping") {
  return;
}

// 👁 MESSAGE READ
if (data.type === "message_read") {

  console.log(
  "👁 MESSAGE_READ",
  data.from,
  "->",
  data.to
);

  messages.forEach(msg => {

    if (
      msg.from === data.to &&
      msg.to === data.from &&
      msg.status === "delivered"
    ) {
      msg.status = "read";
    }

  });

  fs.writeFileSync(
    "messages.json",
    JSON.stringify(messages, null, 2)
  );

  const sender = clients[data.to];

  if (sender && sender.readyState === 1) {

    sender.send(JSON.stringify({
      type: "message_read",
      from: data.from,
    }));

  }

  return;
}

  } catch {
    return;
  }

  if (ws.username && data.from && ws.username !== data.from) {
    console.log("🚫 SPOOF ATTEMPT:", data.from);
    return;
  }   

    // 🔑 PUBLIC KEY (FIXED)
if (data.type === "publicKey") {
  console.log("🔑 KEY FROM:", data.from);

  clients[data.from] = ws;
  publicKeys[data.from] = data.publicKey;
  ws.username = data.from;

  onlineUsers.add(data.from);

  Object.values(clients).forEach(client => {
  if (client.readyState === 1) {
    client.send(JSON.stringify({
      type: "online",
      users: [...onlineUsers]
    }));
  }
});

  // 🔥 WYŚLIJ WSZYSTKIE KLUCZE DO TEGO USERA
  Object.entries(publicKeys).forEach(([username, key]) => {
    ws.send(JSON.stringify({
      type: "publicKey",
      from: username,
      publicKey: key
    }));
  });

  // 🔥 WYŚLIJ JEGO KLUCZ DO INNYCH
  Object.entries(clients).forEach(([username, client]) => {
    if (username !== data.from && client.readyState === 1) {
      client.send(JSON.stringify({
        type: "publicKey",
        from: data.from,
        publicKey: data.publicKey
      }));
    }
  });

  return;
}
    // 👥 CREATE GROUP
    if (data.type === "create_group") {
      console.log("👥 NOWA GRUPA:", data.name);

      const groupId = Date.now().toString();

      groups[groupId] = {
        members: data.members || []
      };

      // 🔥 poinformuj userów
      data.members.forEach(member => {
        const client = clients[member];
        if (client && client.readyState === 1) {
          client.send(JSON.stringify({
            type: "group_created",
            groupId
          }));
        }
      });

      return;
    }

// 💬 MESSAGE
if (
  (
    data.recipientText ||
    data.selfText
  ) &&
  (
    data.to ||
    data.groupId
  )
)
{

console.log("📨 MESSAGE BLOCK HIT");
console.log(JSON.stringify(data));

const msgToSend = {

  from: data.from,
  to: data.to || null,
  messageId: data.messageId,
  status: "sent",
  groupId: data.groupId || null,

  // 📩 ODBIORCA
  recipientText: data.recipientText,
  recipientNonce: data.recipientNonce,
  recipientEphKey: data.recipientEphKey,

  // 📩 NADAWCA
  selfText: data.selfText,
  selfNonce: data.selfNonce,
  selfEphKey: data.selfEphKey,

  createdAt: Date.now(),

};

messages.push(msgToSend);

      fs.writeFileSync(
        'messages.json', 
        JSON.stringify(messages, null, 2)
      );

await pool.query(
  `
  INSERT INTO messages
  (
    message_id,
    sender,
    recipient,
    group_id,
    status,

    recipient_text,
    recipient_nonce,
    recipient_eph_key,

    self_text,
    self_nonce,
    self_eph_key,

    created_at
  )
  VALUES
  (
    $1,$2,$3,$4,$5,
    $6,$7,$8,
    $9,$10,$11,
    $12
  )
  `,
  [
    msgToSend.messageId,
    msgToSend.from,
    msgToSend.to,
    msgToSend.groupId,
    msgToSend.status,

    msgToSend.recipientText,
    msgToSend.recipientNonce,
    msgToSend.recipientEphKey,

    msgToSend.selfText,
    msgToSend.selfNonce,
    msgToSend.selfEphKey,

    msgToSend.createdAt
  ]
);

console.log(
  "💾 MESSAGE SAVED TO POSTGRES:",
  msgToSend.messageId
);



      // ===== GROUP =====
      if (data.groupId) {
        const group = groups[data.groupId];
        if (!group) return;

        group.members.forEach(member => {
          const client = clients[member];
          if (client && client.readyState === 1) {
            client.send(JSON.stringify(msgToSend));
          }
        });

        return;
      }

      // ===== 1–1 =====
      const recipient = clients[data.to];
      const sender = clients[data.from];

// 📩 DO ODBIORCY
if (recipient && recipient.readyState === 1) {

  recipient.send(JSON.stringify(msgToSend));

// ✅ DOSTARCZONO DO ODBIORCY
if (sender && sender.readyState === 1) {

  const storedMsg = messages.find(
    m => m.messageId === msgToSend.messageId
  );

  if (storedMsg) {
    storedMsg.status = "delivered";

    fs.writeFileSync(
      "messages.json",
      JSON.stringify(messages, null, 2)
    );
  }

  sender.send(JSON.stringify({
    type: "message_delivered",
    messageId: msgToSend.messageId,
  }));

}
}

// 📩 DO NADAWCY (SYNC)
if (sender && sender.readyState === 1) {
  sender.send(JSON.stringify(msgToSend));
}

// ✅ ACK
if (sender && sender.readyState === 1) {

  sender.send(JSON.stringify({
    type: "message_ack",
    messageId:
    data.messageId ||
    Date.now().toString(),
  }));

}

      return;
    }

  });

ws.on("close", () => {
  if (ws.username) {
    console.log("❌ DISCONNECT:", ws.username);

    delete clients[ws.username];
    onlineUsers.delete(ws.username);

Object.values(clients).forEach(client => {
  if (client.readyState === 1) {
    client.send(JSON.stringify({
      type: "online",
      users: [...onlineUsers]
    }));
  }
});

  }
});
});