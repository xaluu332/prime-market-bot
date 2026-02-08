const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const config = require("./config.json");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ================= GLOBAL ================= */
const spinCooldown = new Map();
let activeGuessGiveaway = null;
const giveaways = new Map();

/* ================= READY ================= */
client.once("ready", async () => {
  console.log(`✅ ${client.user.tag} ONLINE`);

  const commands = [
    new SlashCommandBuilder()
      .setName("say")
      .setDescription("Bot sends a message")
      .addStringOption(o => o.setName("message").setDescription("Message").setRequired(true)),

    new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Start a giveaway")
      .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true))
      .addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes").setRequired(true))
      .addIntegerOption(o => o.setName("winners").setDescription("Number of winners").setRequired(true)),

    new SlashCommandBuilder()
      .setName("reroll")
      .setDescription("Reroll a giveaway")
      .addStringOption(o => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)),

    new SlashCommandBuilder().setName("spin").setDescription("Spin for a chance to win a discount"),

    new SlashCommandBuilder().setName("close").setDescription("Close ticket"),

    new SlashCommandBuilder()
      .setName("legit")
      .setDescription("Leave a legit review")
      .addUserOption(o => o.setName("user").setDescription("Seller").setRequired(true))
      .addStringOption(o => o.setName("product").setDescription("Product").setRequired(true))
      .addStringOption(o => o.setName("message").setDescription("Review message").setRequired(true)),

    new SlashCommandBuilder()
      .setName("giveawayguess")
      .setDescription("Guess the number giveaway")
      .addIntegerOption(o => o.setName("number").setDescription("Secret number").setRequired(true))
      .addIntegerOption(o => o.setName("min").setDescription("Minimum").setRequired(true))
      .addIntegerOption(o => o.setName("max").setDescription("Maximum").setRequired(true))
      .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true)),

    new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Clear messages in the channel")
      .addStringOption(o =>
        o.setName("amount")
          .setDescription("Number of messages to delete or 'all'")
          .setRequired(true)
      )
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationGuildCommands(client.user.id, config.guildId), { body: commands });
});

client.on("guildMemberAdd", async member => {
  // Kanał powitalny
  const welcomeChannel = member.guild.channels.cache.get(config.welcomeChannelId);
  if (!welcomeChannel) return;

  // Liczba członków łącznie (boty też)
  const totalMembers = member.guild.memberCount;

  // ================= POWITALNY EMBED =================
  const embed = new EmbedBuilder()
    .setColor("#00ffcc")
    .setTitle("👋 Welcome")
    .setDescription(`Hi ${member}!\nWelcome to **PrimeMarket**.\nYou are member number **${totalMembers}**!\nCheck out our offer and stay with us for longer!`)
    .setImage(config.welcomeImage);

  await welcomeChannel.send({ content: `${member}`, embeds: [embed] });

  // ================= AKTUALIZACJA KANAŁU GŁOSOWEGO JAKO LICZNIK =================
  const voiceChannelId = "1469476659005624544"; // Twój kanał głosowy
  const voiceChannel = member.guild.channels.cache.get(voiceChannelId);

  if (voiceChannel && voiceChannel.type === 2) { // 2 = GuildVoice
    await voiceChannel.setName(`Members: ${totalMembers}`);
  }
});

client.on("guildMemberRemove", async member => {
  const totalMembers = member.guild.memberCount;

  const voiceChannelId = "1469476659005624544"; // Twój kanał głosowy
  const voiceChannel = member.guild.channels.cache.get(voiceChannelId);

  if (voiceChannel && voiceChannel.type === 2) {
    await voiceChannel.setName(`Members: ${totalMembers}`);
  }
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
  if (interaction.isButton()) {
    // ===== Verify =====
    if (interaction.customId === "verify") {
      await interaction.member.roles.add(config.verifyRoleId);
      return interaction.reply({ content: "✅ You are verified!", ephemeral: true });
    }

    // ===== Ticket =====
    if (interaction.customId.startsWith("ticket_")) {
      const type = interaction.customId.split("_")[1];
      return createTicket(interaction, type);
    }

    // ===== Close ticket =====
    if (interaction.customId === "ticket_close") {
      await interaction.reply("🔒 Ticket will close in 5 seconds...");
      setTimeout(() => interaction.channel.delete(), 5000);
    }
  }

  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;

  // ===== SAY =====
  if (cmd === "say") {
    await interaction.channel.send(interaction.options.getString("message"));
    return interaction.reply({ content: "✅ Sent", ephemeral: true });
  }

  // ===== GIVEAWAY =====
  if (cmd === "giveaway") {
    const prize = interaction.options.getString("prize");
    const minutes = interaction.options.getInteger("minutes");
    const winners = interaction.options.getInteger("winners");

    const embed = new EmbedBuilder()
      .setTitle("🎉 GIVEAWAY 🎉")
      .setColor("#ffcc00")
      .setDescription(`🏆 Prize: **${prize}**\n⏰ Ends in **${minutes} minutes**\n👥 Winners: **${winners}**\nReact with 🎉`);

    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    await msg.react("🎉");

    giveaways.set(msg.id, { prize, winners });

    setTimeout(async () => {
      const fetched = await msg.fetch();
      const users = (await fetched.reactions.cache.get("🎉").users.fetch()).filter(u => !u.bot);
      if (!users.size) return interaction.followUp("❌ No participants.");
      const win = users.random(Math.min(winners, users.size));
      interaction.followUp(`🎉 **Winners:** ${win.join(", ")}\n🏆 **Prize:** ${prize}`);
    }, minutes * 60000);
  }

  // ===== REROLL =====
  if (cmd === "reroll") {
    const id = interaction.options.getString("message_id");
    const data = giveaways.get(id);
    if (!data) return interaction.reply({ content: "❌ Giveaway not found.", ephemeral: true });

    const msg = await interaction.channel.messages.fetch(id);
    const users = (await msg.reactions.cache.get("🎉").users.fetch()).filter(u => !u.bot);
    if (!users.size) return interaction.reply("❌ No participants.");

    const win = users.random(Math.min(data.winners, users.size));
    interaction.reply(`🔁 **New winner(s):** ${win.join(", ")}`);
  }

  // ===== SPIN =====
  if (cmd === "spin") {
    const now = Date.now();
    const cd = 60 * 60 * 1000; // 1h
    if (spinCooldown.has(interaction.user.id) && spinCooldown.get(interaction.user.id) > now)
      return interaction.reply({ content: "⏳ Try again later.", ephemeral: true });

    spinCooldown.set(interaction.user.id, now + cd);

    if (Math.random() <= 0.05)
      return interaction.reply(`🎉 ${interaction.user} won **-10% discount**!\nUse it within **24h** in a ticket.`);
    else
      return interaction.reply("❌ No luck this time. Try again later 🍀");
  }

  // ===== CLOSE =====
  if (cmd === "close") {
    await interaction.reply("🔒 Ticket will close in 5 seconds...");
    setTimeout(() => interaction.channel.delete(), 5000);
  }

  // ===== LEGIT =====
  if (cmd === "legit") {
    const channel = interaction.guild.channels.cache.get(config.legitChannelId);
    if (!channel) return interaction.reply({ content: "❌ Legit channel not found.", ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("⭐ Legit Review")
      .addFields(
        { name: "Seller", value: interaction.options.getUser("user").username },
        { name: "Product", value: interaction.options.getString("product") },
        { name: "Message", value: interaction.options.getString("message") }
      )
      .setFooter({ text: `By ${interaction.user.username}` });

    channel.send({ embeds: [embed] });
    interaction.reply({ content: "✅ Legit posted!", ephemeral: true });
  }

  // ===== GIVEAWAY GUESS =====
  if (cmd === "giveawayguess") {
    activeGuessGiveaway = {
      number: interaction.options.getInteger("number"),
      channelId: interaction.channel.id,
      prize: interaction.options.getString("prize")
    };
    interaction.reply("🎯 Guess the number by typing it in chat!");
  }

  // ===== CLEAR =====
  if (cmd === "clear") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return interaction.reply({ content: "❌ You don't have permission.", ephemeral: true });

    let amount = interaction.options.getString("amount");
    if (amount.toLowerCase() === "all") {
      const fetched = await interaction.channel.messages.fetch({ limit: 100 });
      await interaction.channel.bulkDelete(fetched, true);
      return interaction.reply({ content: "🗑️ Cleared all messages (up to 100).", ephemeral: true });
    }

    amount = parseInt(amount);
    if (isNaN(amount) || amount < 1) return interaction.reply({ content: "❌ Invalid number.", ephemeral: true });
    if (amount > 100) amount = 100;

    await interaction.channel.bulkDelete(amount, true);
    return interaction.reply({ content: `🗑️ Cleared ${amount} messages.`, ephemeral: true });
  }
});

/* ================= MESSAGE LISTENER ================= */
client.on("messageCreate", message => {
  if (!activeGuessGiveaway || message.author.bot) return;
  if (message.channel.id !== activeGuessGiveaway.channelId) return;

  const guess = parseInt(message.content);
  if (guess === activeGuessGiveaway.number) {
    message.channel.send(`🎉 ${message.author} WON **${activeGuessGiveaway.prize}**!`);
    activeGuessGiveaway = null;
  }
});

/* ================= TICKETS ================= */
async function createTicket(interaction, type) {
  const guild = interaction.guild;
  const user = interaction.user;

  const existing = guild.channels.cache.find(c => c.topic === user.id);
  if (existing) return interaction.reply({ content: "❌ You already have a ticket.", ephemeral: true });

  const channel = await guild.channels.create({
    name: `ticket-${user.username}`,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId,
    topic: user.id,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      { id: config.supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel] }
    ]
  });

  const embed = new EmbedBuilder()
    .setColor("#00ffcc")
    .setTitle(type === "support" ? "🎧 Support Ticket" : "🛒 Purchase Ticket")
    .setDescription(`To open a ticket click the button below ⬇️`)
    .setImage(config.ticketImage);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 Close").setStyle(ButtonStyle.Danger)
  );

  channel.send({ content: `<@&${config.supportRoleId}>`, embeds: [embed], components: [row] });
  interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
}

/* ================= SETUP PANEL ================= */
client.on("messageCreate", async message => {
  if (message.author.bot || message.content !== "!setup") return;

  // ===== VERIFY PANEL =====
  const verifyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify")
      .setLabel("✅ Verify")
      .setStyle(ButtonStyle.Success)
  );

  const verifyEmbed = new EmbedBuilder()
    .setColor("#00ffcc")
    .setTitle("Verify Yourself")
    .setDescription("Click the button below to get verified ✅")
    .setImage(config.verifyImage); // <- poprawny obraz weryfikacji

  await message.channel.send({ embeds: [verifyEmbed], components: [verifyRow] });

  // ===== TICKET PANEL =====
  const ticketRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_support")
      .setLabel("🎧 Support")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ticket_purchase")
      .setLabel("🛒 Purchase")
      .setStyle(ButtonStyle.Secondary)
  );

  const ticketEmbed = new EmbedBuilder()
    .setColor("#00ffcc")
    .setTitle("🎫 Tickets")
    .setDescription("To open a ticket click the button below ⬇️")
    .setImage(config.ticketImage); // <- poprawny obraz ticketów

  await message.channel.send({ embeds: [ticketEmbed], components: [ticketRow] });
});

/* ================= OCHRONA SERWERA ================= */
client.on("guildChannelDelete", async channel => {
  const audit = await channel.guild.fetchAuditLogs({ type: 'CHANNEL_DELETE', limit: 1 });
  const entry = audit.entries.first();
  if (!entry) return;
  const user = entry.executor;
  if (!user.permissions.has("Administrator")) {
    console.log(`🚨 ${user.tag} próbował usunąć kanał!`);
    // opcjonalnie przywrócenie kanału, np. w zależności od potrzeb
  }
});

client.on("guildBanAdd", async (guild, user) => {
  console.log(`🚨 Ban detected: ${user.tag}`);
});

client.on("roleDelete", async role => {
  console.log(`🚨 Role deleted: ${role.name}`);
});

client.on("roleUpdate", async role => {
  console.log(`🚨 Role updated: ${role.name}`);
});

client.login(config.token);
