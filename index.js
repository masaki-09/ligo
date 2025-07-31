require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const express = require('express'); // ★ Webサーバー機能を追加

// --- 設定項目 ---
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CHECK_INTERVAL_MINUTES = 5;

// --- データベース設定 ---
const adapter = new FileSync('db.json');
const db = low(adapter);
db.defaults({ last_event_id: null }).write();

// --- Discordクライアント設定 ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
    ]
});

// --- メインの監視処理 ---
async function checkForNewEvents() {
    console.log(`[${new Date().toLocaleString('ja-JP')}] GCNサイトをチェックしています...`);
    
    try {
        const response = await fetch('https://gcn.nasa.gov/notices');
        if (!response.ok) {
            console.error(`GCNサイトへのアクセスに失敗しました。ステータス: ${response.status}`);
            return;
        }
        const html = await response.text();
        const $ = cheerio.load(html);

        const latestEventLink = $('ul > li > a').first();
        const eventName = latestEventLink.text().trim();
        const eventUrl = "https://gcn.nasa.gov" + latestEventLink.attr('href');
        const eventId = eventName.split(' ').pop();

        const lastEventId = db.get('last_event_id').value();

        if (eventId && eventId !== lastEventId) {
            console.log(`--- 新しいイベントを検知: ${eventId} ---`);
            
            const detailResponse = await fetch(eventUrl);
            const detailHtml = await detailResponse.text();
            const $$ = cheerio.load(detailHtml);

            let arrivalTime = 'N/A', detectors = 'N/A', distance = 'N/A', classification = 'N/A';

            $$('dt').each((index, element) => {
                const title = $$(element).text().trim();
                const value = $$(element).next('dd').text().trim();
                if (title.includes('Event Time')) arrivalTime = value;
                if (title.includes('Instruments')) detectors = value;
            });
            
            $$('table').each((index, table) => {
                $$('tr', table).each((i, row) => {
                    const th = $$('th', row).text().trim();
                    const td = $$('td', row).text().trim();
                    if (th.includes('Distance')) distance = td;
                    if (th.includes('Classification')) classification = td;
                });
            });

            const channel = await client.channels.fetch(CHANNEL_ID);
            if (channel) {
                const embed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle(`� 重力波イベント速報: ${eventId}`)
                    .setURL(eventUrl)
                    .addFields(
                        { name: '到来時刻 (UTC)', value: arrivalTime, inline: true },
                        { name: '検出器', value: detectors, inline: true },
                        { name: '距離', value: distance, inline: false },
                        { name: '分類の可能性', value: classification, inline: false }
                    )
                    .setTimestamp();
                
                await channel.send({ embeds: [embed] });
                console.log(`${eventId} の速報をDiscordに投稿しました。`);
                db.set('last_event_id', eventId).write();
            }
        } else {
            console.log('新しいイベントはありませんでした。');
        }

    } catch (error) {
        console.error("チェック中にエラーが発生しました:", error);
    }
}

// --- ボット起動時の処理 ---
client.on('ready', () => {
    console.log(`${client.user.tag} としてログインしました！`);
    checkForNewEvents();
    setInterval(checkForNewEvents, CHECK_INTERVAL_MINUTES * 60 * 1000);
});

// --- ★★★ ここからが新しい部分 ★★★ ---

// 1. Webサーバーのセットアップ
const app = express();
const PORT = process.env.PORT || 3000;

// サイトのURLにアクセスがあった場合に、ボットが動いていることを知らせる
app.get('/', (req, res) => {
  res.send('重力波Discordボットは正常に稼働中です。');
});

// 2. Webサーバーを起動
app.listen(PORT, () => {
  console.log(`Webサーバーがポート ${PORT} で起動しました。Discordボットの起動準備をします...`);
  
  // 3. Webサーバーが起動してから、Discordボットにログイン
  client.login(TOKEN);
});
�