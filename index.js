const {
  default: KeithConnect,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  downloadContentFromMessage,
  jidDecode,
  proto,
  getContentType,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const FileType = require("file-type");
const axios = require("axios");
const chalk = require("chalk");
const express = require("express");
const { DateTime } = require("luxon");

const { smsg } = require('./smsg');
const authenticationn = require('./auth.js');
const { autoview, autoread, botname, autobio, mode, prefix, autoreact, presence, autolike, anticall } = require('./settings');
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif');
const { isUrl, generateMessageTag, getBuffer, getSizeMedia, fetchJson, sleep } = require('./lib/botFunctions');
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

const app = express();
const port = process.env.PORT || 10000;

authenticationn();
const groupEvents = require("./groupEvents.js");

async function startKeith() {
  const { saveCreds, state } = await useMultiFileAuthState(`session`);
  const client = KeithConnect({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    version: [2, 3000, 1015901307],
    browser: [`KEITH-MD`, 'Safari', '3.0'],
    auth: state,
    getMessage: async (key) => {
      if (store) {
        const mssg = await store.loadMessage(key.remoteJid, key.id);
        return mssg.message || undefined;
      }
      return { conversation: "HERE" };
    }
  });

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  let lastTextTime = 0;
  const messageDelay = 5000;

  client.ev.on('call', async (callData) => {
    if (anticall === 'true') {
      const callId = callData[0].id;
      const callerId = callData[0].from;
      await client.rejectCall(callId, callerId);
      const currentTime = Date.now();
      if (currentTime - lastTextTime >= messageDelay) {
        await client.sendMessage(callerId, {
          text: '```❗📵I AM KEITH MD | I REJECT THIS CALL BECAUSE MY OWNER IS BUSY. KINDLY SEND TEXT INSTEAD```.',
        });
        lastTextTime = currentTime;
      } else {
        console.log('Message skipped to prevent overflow');
      }
    }
  });

  if (autoreact === 'true') {
    client.ev.on("messages.upsert", async (chatUpdate) => {
      try {
        const mek = chatUpdate.messages[0];
        if (!mek || !mek.message) return;

        const emojiFilePath = path.resolve(__dirname, 'database', 'emojis.json');
        let emojis = [];

        try {
          const data = fs.readFileSync(emojiFilePath, 'utf8');
          emojis = JSON.parse(data);
        } catch (error) {
          console.error('Error reading emojis file:', error);
          return;
        }

        if (!mek.key.fromMe && emojis.length > 0) {
          const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
          await client.sendMessage(mek.key.remoteJid, {
            react: {
              text: randomEmoji,
              key: mek.key,
            },
          });
        }

      } catch (error) {
        console.error('Error processing message:', error);
      }
    });
  }

  if (autobio === 'true') {
    setInterval(() => {
      const date = new Date();
      client.updateProfileStatus(
        `${botname} is active 24/7\n\n${date.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' })} It's a ${date.toLocaleString('en-US', { weekday: 'long', timeZone: 'Africa/Nairobi' })}.`
      );
    }, 10 * 1000);
  }

  client.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      let mek = chatUpdate.messages[0];
      if (!mek.message) return;

      mek.message = Object.keys(mek.message)[0] === "ephemeralMessage" ? mek.message.ephemeralMessage.message : mek.message;

      if (autoview === 'true' && autolike === 'true' && mek.key && mek.key.remoteJid === "status@broadcast") {
        const keithlike = await client.decodeJid(client.user.id);
        await client.sendMessage(mek.key.remoteJid, { react: { key: mek.key, text: '💎' } }, { statusJidList: [mek.key.participant, keithlike] });
      }

      if (autoview === 'true' && mek.key && mek.key.remoteJid === "status@broadcast") {
        await client.readMessages([mek.key]);
      } else if (autoread === 'true' && mek.key && mek.key.remoteJid.endsWith('@s.whatsapp.net')) {
        await client.readMessages([mek.key]);
      }

      if (mek.key && mek.key.remoteJid.endsWith('@s.whatsapp.net')) {
        const Chat = mek.key.remoteJid;
        if (presence === 'online') {
          await client.sendPresenceUpdate("available", Chat);
        } else if (presence === 'typing') {
          await client.sendPresenceUpdate("composing", Chat);
        } else if (presence === 'recording') {
          await client.sendPresenceUpdate("recording", Chat);
        } else {
          await client.sendPresenceUpdate("unavailable", Chat);
        }
      }

      m = smsg(client, mek, store);
      require("./keith")(client, m, chatUpdate, store);
    } catch (err) {
      console.log(err);
    }
  });

  client.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      let decode = jidDecode(jid) || {};
      return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
    } else return jid;
  };

  client.getName = (jid, withoutContact = false) => {
    id = client.decodeJid(jid);
    withoutContact = client.withoutContact || withoutContact;
    let v;
    if (id.endsWith("@g.us"))
      return new Promise(async (resolve) => {
        v = store.contacts[id] || {};
        if (!(v.name || v.subject)) v = client.groupMetadata(id) || {};
        resolve(v.name || v.subject || PhoneNumber("+" + id.replace("@s.whatsapp.net", "")).getNumber("international"));
      });
    else
      v =
        id === "0@s.whatsapp.net"
          ? {
              id,
              name: "WhatsApp",
            }
          : id === client.decodeJid(client.user.id)
          ? client.user
          : store.contacts[id] || {};
    return (withoutContact ? "" : v.name) || v.subject || v.verifiedName || PhoneNumber("+" + jid.replace("@s.whatsapp.net", "")).getNumber("international");
  };

  client.public = true;
  client.serializeM = (m) => smsg(client, m, store);

  client.ev.on("group-participants.update", async (m) => {
    groupEvents(client, m);
  });

  client.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(`Bad Session File, Please Delete Session and Scan Again`);
        process.exit();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Connection closed, reconnecting....");
        startKeith();
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Connection Lost from Server, reconnecting...");
        startKeith();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log("Connection Replaced, Another New Session Opened, Please Restart Bot");
        process.exit();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(`Device Logged Out, Please Delete File creds.json and Scan Again.`);
        process.exit();
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Restart Required, Restarting...");
        startKeith();
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Connection TimedOut, Reconnecting...");
        startKeith();
      } else {
        console.log(`Unknown DisconnectReason: ${reason}|${connection}`);
        startKeith();
      }
    } else if (connection === "open") {
      await client.groupAcceptInvite("KVkQtTxS6JA0Jctdsu5Tj9");
      console.log(`✅ Connection successful\nLoaded commands.\nBot is active.`);
    }
  });

  client.ev.on("creds.update", saveCreds);

  app.use(express.static('public'));

  app.get("/", (req, res) => {
    res.sendFile(__dirname + '/index.html');
  });

  app.listen(port, () => console.log(`Server listening on port http://localhost:${port}`));

  module.exports = startKeith;
}

startKeith();
