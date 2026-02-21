require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder
} = require("discord.js");

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel]
});

/* ================= CONFIG ================= */
const PREFIX = "!";
const IMMORTAL = ["1390372727767961640", "728984351316115474"];

let ANTI_RAID = true;
let RAID_LEVEL = "medium";

/* ================= ENV VARIABLES ================= */
const GUILD_IDS = process.env.GUILD_IDS?.split(",") || [];
const HALL_OF_SHAME_MAP = new Map(
  (process.env.HALL_OF_SHAME_MAP?.split(",") || []).map(entry => {
    const [guildId, channelId] = entry.split(":");
    return [guildId, channelId];
  })
);
const VANITY_MAP = new Map(
  (process.env.VANITY_MAP?.split(",") || []).map(entry => {
    const [guildId, code, roleId] = entry.split(":");
    if (!guildId || !code || !roleId) return null;
    return [`${guildId}:${code}`, roleId];
  }).filter(Boolean)
);

/* ================= DATA ================= */
const whitelist = {
  user: { common: new Set(), mod: new Set(), antiraid: new Set(), all: new Set(IMMORTAL) },
  role: { common: new Set(), mod: new Set(), antiraid: new Set(), all: new Set() }
};

const spamMap = new Map();
const warnMap = new Map();

/* ================= HELPERS ================= */
const parseId = i => i?.replace(/[<@!&>]/g, "");
const isImmortal = id => IMMORTAL.includes(id);

function hasPerm(member, level) {
  if (!member) return false;
  if (isImmortal(member.id)) return true;
  if (whitelist.user.all.has(member.id)) return true;
  if (whitelist.user[level]?.has(member.id)) return true;
  return member.roles.cache.some(r =>
    whitelist.role.all.has(r.id) || whitelist.role[level]?.has(r.id)
  );
}

function raidConfig() {
  if (RAID_LEVEL === "low") return { msgs: 4, time: 3000 };
  if (RAID_LEVEL === "high") return { msgs: 2, time: 1000 };
  return { msgs: 3, time: 2000 };
}

function getHallOfShameChannel(guildId) {
  return HALL_OF_SHAME_MAP.get(guildId);
}

async function hallOfShame(guild, userId, mod, reason) {
  const chId = getHallOfShameChannel(guild.id);
  if (!chId) return;

  const ch = guild.channels.cache.get(chId);
  if (!ch) return;

  const embed = new EmbedBuilder()
    .setTitle("🚫 Hall of Shame")
    .setColor("DarkRed")
    .setDescription(
      "**You can’t overpass us.**\n**You broke the rules — and now we broke you.**"
    )
    .addFields(
      { name: "User ID", value: userId, inline: true },
      { name: "Moderator", value: mod ? `<@${mod}>` : "Anti-Raid", inline: true },
      { name: "Reason", value: reason || "No reason" }
    )
    .setTimestamp();

  ch.send({ embeds: [embed] });
}

/* ================= VANITY ROLE SYSTEM ================= */
client.on("guildMemberAdd", async member => {
  try {
    if (!GUILD_IDS.includes(member.guild.id)) return;

    const vanity = await member.guild.fetchVanityData().catch(() => null);
    if (!vanity) return;

    const roleId = VANITY_MAP.get(`${member.guild.id}:${vanity.code}`);
    if (!roleId) return;

    const role = member.guild.roles.cache.get(roleId);
    if (!role) return console.log("Vanity role not found");

    await member.roles.add(role);

    // Optional: Welcome log in the same channel as Hall of Shame
    const chId = getHallOfShameChannel(member.guild.id);
    const ch = member.guild.channels.cache.get(chId);
    if (ch) {
      const embed = new EmbedBuilder()
        .setTitle("✨ New Vanity Join")
        .setColor("Gold")
        .setDescription(`<@${member.id}> joined using vanity code **${vanity.code}** and received the role <@&${roleId}>.`)
        .setTimestamp();
      ch.send({ embeds: [embed] });
    }

    console.log(`${member.user.tag} joined with vanity and got role`);

  } catch (err) {
    console.error("Vanity Error:", err);
  }
});

/* ================= ANTI-RAID ================= */
client.on("messageCreate", async msg => {
  if (!ANTI_RAID || !msg.guild || msg.author.bot) return;
  if (hasPerm(msg.member, "mod")) return;

  const { msgs, time } = raidConfig();
  const now = Date.now();
  const arr = spamMap.get(msg.author.id) || [];
  const filtered = arr.filter(t => now - t < time);
  filtered.push(now);
  spamMap.set(msg.author.id, filtered);

  if (filtered.length >= msgs) {
    const warns = warnMap.get(msg.author.id) || 0;
    warnMap.set(msg.author.id, warns + 1);

    if (warns < 2) {
      msg.reply("⚠️ Stop spamming.");
    } else {
      await msg.member.timeout(5 * 60 * 1000, "Anti-Raid Spam");
      hallOfShame(msg.guild, msg.author.id, null, "Spam");
    }
  }
});

/* ================= COMMANDS ================= */
client.on("messageCreate", async msg => {
  if (!msg.guild || msg.author.bot || !msg.content.startsWith(PREFIX)) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  const member = msg.member;

  /* ===== CMDS ===== */
  if (cmd === "cmds") {
    const embed = new EmbedBuilder()
      .setTitle("🛠️ Bot Commands")
      .setColor("Blue")
      .setDescription(`
**Moderation**
!ban !forceban !massban
!mute !unmute !warn !unwarn
!purge 1-500

**Security**
!lockdown !unlockdown
!anti-raid low|medium|high
!anti-raid

**Info**
!info @user/@role
!server
!cmds
`);
    return msg.reply({ embeds: [embed] });
  }

  /* ===== INFO ===== */
  if (cmd === "info") {
    const id = parseId(args[0] || msg.author.id);
    const target = await msg.guild.members.fetch(id).catch(() => null);
    if (!target) return msg.reply("User not found.");

    const embed = new EmbedBuilder()
      .setTitle("ℹ️ User Info")
      .setColor("Green")
      .addFields(
        { name: "User", value: target.user.tag },
        { name: "User ID", value: target.id },
        { name: "Joined Server", value: `<t:${Math.floor(target.joinedTimestamp/1000)}:R>` },
        { name: "Account Created", value: `<t:${Math.floor(target.user.createdTimestamp/1000)}:R>` },
        { name: "Roles", value: target.roles.cache.map(r => r.name).join(", ") || "None" }
      );
    return msg.reply({ embeds: [embed] });
  }

  /* ===== SERVER ===== */
  if (cmd === "server") {
    const embed = new EmbedBuilder()
      .setTitle("📊 Server Info")
      .setColor("Purple")
      .addFields(
        { name: "Server Name", value: msg.guild.name },
        { name: "Server ID", value: msg.guild.id },
        { name: "Members", value: `${msg.guild.memberCount}` },
        { name: "Anti-Raid", value: `${ANTI_RAID} (${RAID_LEVEL})` }
      );
    return msg.reply({ embeds: [embed] });
  }

});

/* ================= READY ================= */
client.once("ready", () => {
  console.log(`🛡️ ONLINE as 676767 ${client.user.tag}`);
});

client.login(process.env.TOKEN);
