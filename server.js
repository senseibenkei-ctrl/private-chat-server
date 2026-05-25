const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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
    return jwt.verify(token, 'SECRET_KEY');
  } catch {
    return null;
  }
}

// ===== REGISTER =====
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Brak danych' });
  }

  const existingUser = users.find(u => u.username === username);

  if (existingUser) {
    return res.status(400).json({ error: 'Username zajęty' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  users.push({ username, password: hashedPassword, contacts: [] });

  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

  res.json({ message: 'Użytkownik utworzony' });
});

// ===== LOGIN =====
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username);

  if (!user) {
    return res.status(400).json({ error: 'Błędne dane' });
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    return res.status(400).json({ error: 'Błędne dane' });
  }

  const token = jwt.sign({ username }, 'SECRET_KEY', { expiresIn: '7d' });

  res.json({
    token,
    contacts: user.contacts || []
  });
});

// ===== ADD CONTACT =====
app.post('/add-contact', (req, res) => {
  const { username, contact } = req.body;

  console.log("ADD CONTACT:", username, contact);

  const user = users.find(u => u.username === username);
  const target = users.find(u => u.username === contact);

  if (!user || !target) {
    return res.status(400).json({ error: "Użytkownik nie istnieje" });
  }

  // 🔥 dodaj tylko jeśli nie ma
  if (!user.contacts.includes(contact)) {
    user.contacts.push(contact);
  }

  if (!target.contacts.includes(username)) {
    target.contacts.push(username);
  }

  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

  res.json({
    success: true,
    contacts: user.contacts,
  });
});

// 🔥 GET CONTACTS
app.get('/contacts/:username', (req, res) => {
  const { username } = req.params;

  const users = JSON.parse(fs.readFileSync('users.json'));

  const user = users.find(u => u.username === username);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({
    contacts: user.contacts || []
  });
});

// 🔥 USUWANIE KONTAKTU
app.post('/remove-contact', (req, res) => {
  const { username, contact } = req.body;
  
  console.log("REMOVE CONTACT:", username, contact);
  console.log("USERS:", Object.keys(users));

const user = users.find(u => u.username === username);
const target = users.find(u => u.username === contact);

if (!user || !target) {
  return res.status(400).json({ error: "User nie istnieje" });
}

// 🔥 usuń kontakt
user.contacts = user.contacts.filter(c => c !== contact);

// 🔥 usuń w drugą stronę
target.contacts = target.contacts.filter(c => c !== username);

  // 🔥 ZAPIS DO PLIKU (NAJWAŻNIEJSZE)
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

  res.json({
    success: true,
    contacts: user.contacts,
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

  ws.on("message", (msg) => {
let data;
try {
  data = JSON.parse(msg);
} catch {
  return;
}    

    // 🔑 PUBLIC KEY (FIXED)
if (data.type === "publicKey") {
  console.log("🔑 KEY FROM:", data.from);

  clients[data.from] = ws;
  publicKeys[data.from] = data.publicKey;
  ws.username = data.from;

  onlineUsers.add(data.from);

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
    if (data.text && (data.to || data.groupId)) {

const msgToSend = {
  from: data.from,
  to: data.to || null,
  groupId: data.groupId || null,
  text: data.text,
  nonce: data.nonce,
  ephKey: data.ephKey,
  plain: data.plain || null,
};

messages.push({
  ...msgToSend,
  text: data.plain || msgToSend.text
});

      fs.writeFileSync('messages.json', JSON.stringify(messages, null, 2));

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
}

// 📩 DO NADAWCY (SYNC)
if (sender && sender.readyState === 1) {
  sender.send(JSON.stringify(msgToSend));
}

      return;
    }

  });

ws.on("close", () => {
  if (ws.username) {
    console.log("❌ DISCONNECT:", ws.username);

    delete clients[ws.username];
    onlineUsers.delete(ws.username);
  }
});

// 🔥 GET CONTACTS
app.get('/contacts/:username', (req, res) => {
  const { username } = req.params;

  const users = JSON.parse(fs.readFileSync('users.json'));

  const user = users.find(u => u.username === username);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({
    contacts: user.contacts || []
  });
});

});