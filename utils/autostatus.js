/**
 * AutoStatus config - view status & react to status updates
 * Owner-only feature. Stored in database/autostatus.json
 */

const fs = require('fs');
const path = require('path');
const { jidNormalizedUser, generateMessageIDV2 } = require('@whiskeysockets/baileys');

const DB_PATH = path.join(__dirname, '../database');
const AUTOSTATUS_FILE = path.join(DB_PATH, 'autostatus.json');

const DEFAULTS = {
  view: false,
  react: false,
  reaction: '💚' // green heart
};

function load() {
  try {
    if (fs.existsSync(AUTOSTATUS_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTOSTATUS_FILE, 'utf8'));
      return { ...DEFAULTS, ...data };
    }
  } catch (e) {
    console.error('[autostatus] load error:', e.message);
  }
  return { ...DEFAULTS };
}

function save(data) {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(DB_PATH, { recursive: true });
    }
    fs.writeFileSync(AUTOSTATUS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[autostatus] save error:', e.message);
    return false;
  }
}

async function handleStatus(sock, msg) {
  const cfg = load();
  if (!cfg.view && !cfg.react) return;

  const statusKey = msg?.key;
  if (!statusKey?.id || statusKey.fromMe) return;

  // Skip protocol / senderKey distribution / revoke packets (these break sessions if read/reacted)
  const msgTypes = Object.keys(msg.message || {});
  const ignoredTypes = ['protocolMessage', 'senderKeyDistributionMessage', 'reactionMessage'];
  if (!msgTypes.length || msgTypes.every((t) => ignoredTypes.includes(t))) return;

  // Resolve real user JID (skip invalid @broadcast or unresolved @lid keys to prevent Signal desync)
  const rawParticipant = statusKey.participantAlt || statusKey.participant;
  if (!rawParticipant || !rawParticipant.endsWith('@s.whatsapp.net')) return;

  const participant = jidNormalizedUser(rawParticipant);
  const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
  if (!botJid || participant === botJid) return;

  // Build clean status key
  const cleanKey = {
    remoteJid: 'status@broadcast',
    id: statusKey.id,
    participant,
    fromMe: false
  };

  // 1. Auto View Status
  if (cfg.view) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      await sock.readMessages([cleanKey]);
    } catch (e) {
      console.error('[autostatus] view error:', e.message);
    }
  }

  // 2. Auto React to Status
  if (cfg.react) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const statusJidList = Array.from(new Set([participant, botJid]));
      await sock.relayMessage(
        'status@broadcast',
        {
          reactionMessage: {
            key: cleanKey,
            text: cfg.reaction || '💚',
            senderTimestampMs: Date.now()
          }
        },
        {
          messageId: generateMessageIDV2(sock.user.id),
          statusJidList
        }
      );
    } catch (e) {
      console.error('[autostatus] react error:', e.message);
    }
  }
}

module.exports = { load, save, DEFAULTS, handleStatus, reactToStatus: handleStatus };
