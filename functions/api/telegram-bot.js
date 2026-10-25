// functions/api/telegram-bot.js
import { deployWorker } from "../_core.js";

const TOKEN_CREATE_URL = "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=Jasaz%20Deployer";

const PRESETS = {
  nahan: {
    title: "🛡️ نهان (Nahan)",
    url: "https://raw.githubusercontent.com/itsyebekhe/nahan/refs/heads/main/worker.encode.js",
    binding: "IOT_DB",
    obfuscate: 0,
    recreate: 1,
    d1: 1,
  },
  zeus: {
    title: "⚡ زئوس (Zeus)",
    url: "https://raw.githubusercontent.com/panel-zeus/Z-E-U-S/refs/heads/main/Source.js",
    binding: "DB",
    obfuscate: 1,
    recreate: 1,
    d1: 1,
  },
  custom: {
    title: "🛠️ سفارشی (Custom)",
    url: "",
    binding: "DB",
    obfuscate: 1,
    recreate: 0,
    d1: 0,
  },
};

function generateRandomName(prefix = "worker") {
  const words = ["fast", "turbo", "sky", "pixel", "smart", "flow", "shield", "edge"];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const num = Math.floor(Math.random() * 899) + 100;
  return `${prefix}-${pick(words)}-${num}`;
}

async function tgApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

function encodeAction(act, pKey, obf, clean, d1, kv = 0) {
  return `${act}|${pKey}|${obf}|${clean}|${d1}|${kv}`;
}

function parseAction(data) {
  const [act, pKey, obf, clean, d1, kv] = data.split("|");
  return {
    act,
    pKey: pKey && PRESETS[pKey] ? pKey : "zeus",
    obfuscate: obf === "1",
    recreate: clean === "1",
    d1: d1 === "1",
    kv: kv === "1",
  };
}

function parseConfigFromText(text = "") {
  const getVal = (key) => {
    const match = text.match(new RegExp(`${key}:\\s*([^\\n\\r<]+)`));
    return match ? match[1].trim() : "";
  };

  return {
    pKey: getVal("PRJ"),
    accountId: getVal("ACC"),
    apiToken: getVal("TOK"),
    workerName: getVal("WRK") || generateRandomName("cf"),
    d1Name: getVal("D1N") || generateRandomName("db"),
    bindingName: getVal("BND"),
    kvName: getVal("KVN") || generateRandomName("kv"),
    kvBindingName: getVal("KVB") || "KV",
    scriptUrl: getVal("URL"),
  };
}

export async function onRequestPost({ request, env }) {
  const BOT_TOKEN = env.BOT_TOKEN;
  const SECRET = env.BOT_SECRET;

  if (SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== SECRET) {
    return new Response("Unauthorized", { status: 403 });
  }

  try {
    const update = await request.json();

    // ۱. پردازش کلیک روی دکمه‌های شیشه‌ای
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;
      const data = cq.data;
      const msgText = cq.message.text || "";

      if (data === "help_acc_id") {
        await tgApi(BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cq.id, text: "راهنما ارسال شد." });
        const helpMsg = `🔍 <b>نحوه پیدا کردن Account ID:</b>\n\nوارد داشبورد کلودفلر شده و به منوی <b>Workers & Pages</b> بروید. در آدرس‌بار مرورگر، مقدار ۳۲ حرفی را بردارید:\n<code>https://dash.cloudflare.com/<b>[ACCOUNT_ID]</b>/workers-and-pages</code>`;
        await tgApi(BOT_TOKEN, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: helpMsg });
        return new Response("OK");
      }

      if (data === "cancel") {
        await tgApi(BOT_TOKEN, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "❌ عملیات لغو شد. برای شروع /start را بزنید.",
        });
        return new Response("OK");
      }

      // کاربر یک پروژه را انتخاب کرده است
      if (data.startsWith("pre:")) {
        const pKey = data.split(":")[1];
        const p = PRESETS[pKey];

        const promptText = `شما پروژه <b>${p.title}</b> را انتخاب کردید.

لطفاً اطلاعات کلودفلر را در قالب دو خط زیر ارسال کنید:

<code>خط اول: Account ID
خط دوم: API Token</code>
${pKey === "custom" ? "<code>خط سوم: آدرس سورس مستقیم JS</code>" : ""}

<i>(پیام بالا را کپی کرده و مقادیر خود را جایگزین کنید)</i>
[#PRJ_${pKey}#]`;

        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: promptText,
          parse_mode: "HTML",
          reply_markup: {
            force_reply: true,
            selective: true,
            inline_keyboard: [
              [{ text: "🔑 ساخت خودکار API Token", url: TOKEN_CREATE_URL }],
              [{ text: "❓ راهنمای پیدا کردن Account ID", callback_data: "help_acc_id" }],
            ],
          },
        });
        return new Response("OK");
      }

      const parsed = parseAction(data);
      const cfg = parseConfigFromText(msgText);
      const activePresetKey = parsed.pKey || cfg.pKey || "nahan";
      const p = PRESETS[activePresetKey];

      // تغییر دستی فیلدها
      if (parsed.act === "edit_wrk" || parsed.act === "edit_d1n" || parsed.act === "edit_bnd") {
        const labels = {
          edit_wrk: "نام ورکر (Worker Name)",
          edit_d1n: "نام دیتابیس D1",
          edit_bnd: "نام متغیر Binding",
        };
        const fieldKey = parsed.act.replace("edit_", "").toUpperCase();

        const replyPayload = `لطفاً <b>${labels[parsed.act]}</b> دلخواه خود را بنویسید و بفرستید:

[#TARGET_FIELD_${fieldKey}#]
[#PANEL_MSG_ID_${messageId}#]
[#PKEY_${activePresetKey}#]
[#FLAGS_${parsed.obfuscate ? "1" : "0"}_${parsed.recreate ? "1" : "0"}_${parsed.d1 ? "1" : "0"}#]

<pre>
PRJ: ${activePresetKey}
ACC: ${cfg.accountId}
TOK: ${cfg.apiToken}
WRK: ${cfg.workerName}
D1N: ${cfg.d1Name}
BND: ${cfg.bindingName || p.binding}
URL: ${cfg.scriptUrl || p.url}
</pre>`;

        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: replyPayload,
          parse_mode: "HTML",
          reply_markup: { force_reply: true, selective: true },
        });
        return new Response("OK");
      }

      if (parsed.act === "rnd_wrk") cfg.workerName = generateRandomName("cf");
      if (parsed.act === "rnd_d1") cfg.d1Name = generateRandomName("db");
      if (parsed.act === "rnd_kv") cfg.kvName = generateRandomName("kv");

      if (parsed.act === "tog_obf") {
        if (activePresetKey === "nahan") {
          await tgApi(BOT_TOKEN, "answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "سورس کد نهان از پیش مبهم‌سازی شده است و امکان تغییر ندارد.",
            show_alert: true,
          });
          return new Response("OK");
        }
        parsed.obfuscate = !parsed.obfuscate;
      }
      if (parsed.act === "tog_cln") parsed.recreate = !parsed.recreate;
      if (parsed.act === "tog_d1") parsed.d1 = !parsed.d1;
      if (parsed.act === "tog_kv") parsed.kv = !parsed.kv;

      // شروع استقرار
      if (parsed.act === "deploy") {
        if (!cfg.accountId || !cfg.apiToken) {
          await tgApi(BOT_TOKEN, "sendMessage", {
            chat_id: chatId,
            text: "❌ اطلاعات منقضی یا مفقود شده است. لطفاً /start را بزنید.",
          });
          return new Response("OK");
        }

        await tgApi(BOT_TOKEN, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: `⏳ <b>در حال استقرار پروژه ${p.title} روی کلودفلر...</b>\nلطفاً شکیبا باشید.`,
          parse_mode: "HTML",
        });

        // تضمین کامل استفاده از URL و Binding پروژه انتخابی (Zeus یا Nahan)
        const finalUrl = activePresetKey === "custom" ? cfg.scriptUrl : p.url;
        const finalBinding = cfg.bindingName || p.binding;

        try {
          const deployRes = await deployWorker({
            accountId: cfg.accountId,
            apiToken: cfg.apiToken,
            workerName: cfg.workerName,
            scriptUrl: finalUrl,
            bindingName: parsed.d1 ? finalBinding : null,
            d1Name: parsed.d1 ? cfg.d1Name : null,
            kvName: parsed.kv ? cfg.kvName : null,
            kvBindingName: parsed.kv ? cfg.kvBindingName : null,
            enableObfuscation: parsed.obfuscate,
            recreateWorker: parsed.recreate,
          });

          // اضافه کردن مسیر اختصاصی پنل هر پروژه
          // ساخت لینک و پسورد پیش‌فرض اختصاصی هر پروژه
          let panelUrl = deployRes.workerUrl;
          let extraTips = "";

          if (panelUrl) {
            if (activePresetKey === "nahan") {
              panelUrl = panelUrl.replace(/\/+$/, "") + "/sync/dash";
              extraTips = "\n🔑 <b>رمز عبور پیش‌فرض ورود به پنل نهان:</b> <code>admin</code>";
            } else if (activePresetKey === "zeus") {
              panelUrl = panelUrl.replace(/\/+$/, "") + "/panel";
            }
          }

          const resultMsg = `🎉 <b>پروژه ${p.title} با موفقیت مستقر شد!</b>

🔹 <b>نام ورکر:</b> <code>${deployRes.workerName}</code>
🔹 <b>مبهم‌سازی:</b> ${deployRes.obfuscated ? "فعال ✅" : "خاموش ❌"}
🔹 <b>نصب تمیز:</b> ${deployRes.recreated ? "بله ✅" : "خیر"}
${deployRes.d1DatabaseId ? `🔹 <b>دیتابیس D1:</b> <code>${cfg.d1Name}</code>\n🔹 <b>بایندینگ:</b> <code>${finalBinding}</code>` : "🔹 <b>دیتابیس D1:</b> غیرفعال"}
${extraTips}

🌐 <b>آدرس داشبورد پنل:</b>
<a href="${panelUrl}">${panelUrl}</a>`;

          await tgApi(BOT_TOKEN, "editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            text: resultMsg,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚀 ورود مستقیم به پنل", url: panelUrl }],
                [
                  { text: "📡 کلین آی‌پی (@itsZetaBot)", url: "https://t.me/itsZetaBot" },
                  { text: "🌐 آی‌پی رله (@nahanproxyipbot)", url: "https://t.me/nahanproxyipbot" },
                ],
                [{ text: "🔄 نصب ورکر دیگر", callback_data: "cancel" }],
              ],
            },
          });
        } catch (deployErr) {
          await tgApi(BOT_TOKEN, "editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML",
            text: `❌ <b>خطا در استقرار:</b>\n\n<code>${deployErr.message}</code>`,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔑 ساخت توکن جدید (دسترسی D1)", url: TOKEN_CREATE_URL }],
                [{ text: "🔄 تلاش مجدد", callback_data: data }],
                [{ text: "❌ انصراف", callback_data: "cancel" }],
              ],
            },
          });
        }
        return new Response("OK");
      }

      await renderReviewMenu(BOT_TOKEN, chatId, messageId, cfg, parsed, activePresetKey);
      return new Response("OK");
    }

    // ۲. پردازش پیام‌های متنی
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();
      const replyToMsg = update.message.reply_to_message;
      const replyTo = replyToMsg?.text || "";

      if (text === "/start" || text === "/new") {
        const welcomeMsg = `سلام! به ربات نصب و مدیریت ورکر خوش آمدید 🚀

پروژه مورد نظر خود را جهت استقرار انتخاب کنید:

<b>🧰 سایر ابزارهای کاربردی پیشنهادی:</b>
• @itsZetaBot: اسکنر زنده کلین آی‌پی کلودفلر، استخراج DNS و تبدیل تصادفی حروف SNI
• @nahanproxyipbot: دسترسی روزانه به سریع‌ترین Proxy IPهای رله جهانی`;

        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          parse_mode: "HTML",
          text: welcomeMsg,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "⚡ زئوس (Zeus)", callback_data: "pre:zeus" },
                { text: "🛡️ نهان (Nahan)", callback_data: "pre:nahan" },
              ],
              [{ text: "🛠️ سورس سفارشی (Custom)", callback_data: "pre:custom" }],
              [
                { text: "📡 ربات Zeta (کلین IP)", url: "https://t.me/itsZetaBot" },
                { text: "🌐 ربات Proxy IP رله", url: "https://t.me/nahanproxyipbot" },
              ],
            ],
          },
        });
        return new Response("OK");
      }

      // الف: تغییر فیلد تکی
      if (replyTo.includes("[#TARGET_FIELD_")) {
        const fieldMatch = replyTo.match(/\[#TARGET_FIELD_([A-Z0-9]+)#\]/);
        const panelMsgMatch = replyTo.match(/\[#PANEL_MSG_ID_([0-9]+)#\]/);
        const pKeyMatch = replyTo.match(/\[#PKEY_([a-z0-9]+)#\]/);
        const flagsMatch = replyTo.match(/\[#FLAGS_([01])_([01])_([01])#\]/);

        if (fieldMatch && panelMsgMatch) {
          const field = fieldMatch[1];
          const targetPanelMsgId = parseInt(panelMsgMatch[1], 10);
          const pKey = pKeyMatch ? pKeyMatch[1] : "zeus";
          
          const cfg = parseConfigFromText(replyTo);

          if (field === "WRK") cfg.workerName = text.replace(/[^a-zA-Z0-9_-]/g, "");
          if (field === "D1N") cfg.d1Name = text.replace(/[^a-zA-Z0-9_-]/g, "");
          if (field === "BND") cfg.bindingName = text.replace(/[^a-zA-Z0-9_]/g, "");

          const state = {
            act: "view",
            pKey: pKey,
            obfuscate: flagsMatch ? flagsMatch[1] === "1" : true,
            recreate: flagsMatch ? flagsMatch[2] === "1" : true,
            d1: flagsMatch ? flagsMatch[3] === "1" : true,
          };

          await renderReviewMenu(BOT_TOKEN, chatId, targetPanelMsgId, cfg, state, pKey);

          try {
            await tgApi(BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: update.message.message_id });
            await tgApi(BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: replyToMsg.message_id });
          } catch (_) {}

          return new Response("OK");
        }
      }

      // ب: دریافت اطلاعات اولیه اکانت
      // تشخیص بدون حساسیت به حروف (Case-Insensitive) با استخراج مستقیم شناسه پروژه
      let presetKey = "nahan"; // پیش‌فرض امن

      const prjMatch = replyTo.match(/\[#PRJ_([a-zA-Z0-9]+)#\]/i);
      if (prjMatch && prjMatch[1]) {
        const detected = prjMatch[1].toLowerCase();
        if (PRESETS[detected]) {
          presetKey = detected;
        }
      } else if (/نهان|nahan/i.test(replyTo)) {
        presetKey = "nahan";
      } else if (/زئوس|zeus/i.test(replyTo)) {
        presetKey = "zeus";
      } else if (/سفارشی|custom/i.test(replyTo)) {
        presetKey = "custom";
      }

      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

      if (lines.length < 2) {
        await tgApi(BOT_TOKEN, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ لطفاً اطلاعات را در دو خط جداگانه بفرستید:\n\nخط ۱: Account ID\nخط ۲: API Token`,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔑 ساخت خودکار API Token", url: TOKEN_CREATE_URL }],
              [{ text: "❓ راهنمای پیدا کردن Account ID", callback_data: "help_acc_id" }],
            ],
          },
        });
        return new Response("OK");
      }

      const p = PRESETS[presetKey];
      const cfg = {
        accountId: lines[0],
        apiToken: lines[1],
        workerName: generateRandomName("cf"),
        d1Name: generateRandomName("db"),
        bindingName: p.binding,
        scriptUrl: lines[2] || p.url,
      };

      const state = {
        act: "view",
        pKey: presetKey,
        obfuscate: p.obfuscate === 1,
        recreate: p.recreate === 1,
        d1: p.d1 === 1,
      };

      try {
        await tgApi(BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: update.message.message_id });
      } catch (_) {}

      await renderReviewMenu(BOT_TOKEN, chatId, null, cfg, state, presetKey);
      return new Response("OK");
    }

    return new Response("OK");
  } catch (err) {
    return new Response("Error: " + err.message, { status: 200 });
  }
}

// ساخت و نمایش پنل تنظیمات پیش از اجرا
async function renderReviewMenu(botToken, chatId, messageId, cfg, state, pKey) {
  const effectivePKey = pKey || state.pKey || "zeus";
  const p = PRESETS[effectivePKey];
  const obfFlag = state.obfuscate ? "1" : "0";
  const clnFlag = state.recreate ? "1" : "0";
  const d1Flag = state.d1 ? "1" : "0";
  const kvFlag = state.kv ? "1" : "0";

  const bindingName = cfg.bindingName || p.binding;
  const kvBindingName = cfg.kvBindingName || "KV";
  const scriptUrl = effectivePKey === "custom" ? (cfg.scriptUrl || "") : p.url;

  const text = `📋 <b>تنظیمات استقرار ورکر: ${p.title}</b>

🔹 <b>نام ورکر:</b> <code>${cfg.workerName}</code>
🔹 <b>مبهم‌سازی کد:</b> ${state.obfuscate ? "روشن ✅" : "خاموش ❌"}
🔹 <b>نصب تمیز (Clean):</b> ${state.recreate ? "روشن ✅" : "خاموش ❌"}
🔹 <b>دیتابیس D1:</b> ${state.d1 ? `روشن (<code>${cfg.d1Name}</code>)` : "خاموش ❌"}
🔹 <b>حافظه KV:</b> ${state.kv ? `روشن (<code>${cfg.kvName}</code>)` : "خاموش ❌"}

<pre>
PRJ: ${effectivePKey}
ACC: ${cfg.accountId}
TOK: ${cfg.apiToken}
WRK: ${cfg.workerName}
D1N: ${cfg.d1Name}
BND: ${bindingName}
KVN: ${cfg.kvName || ""}
KVB: ${kvBindingName}
URL: ${scriptUrl}
</pre>`;

  const keyboard = [
    [
      { text: "✏️ نام ورکر", callback_data: encodeAction("edit_wrk", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag) },
      { text: "🎲 نام رندوم", callback_data: encodeAction("rnd_wrk", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag) },
    ],
    ...(state.d1
      ? [
          [
            { text: "✏️ نام D1", callback_data: encodeAction("edit_d1n", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag) },
            { text: "✏️ بایندینگ D1", callback_data: encodeAction("edit_bnd", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag) },
            { text: "🎲 دیتابیس رندوم", callback_data: encodeAction("rnd_d1", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag) },
          ],
        ]
      : []),
    [
      {
        text: effectivePKey === "nahan" ? "مبهم‌سازی: از پیش انکود شده 🔒" : `مبهم‌سازی: ${state.obfuscate ? "روشن 🟢" : "خاموش ⚪"}`,
        callback_data: encodeAction("tog_obf", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag)
      },
      { text: `نصب Clean: ${state.recreate ? "روشن 🟢" : "خاموش ⚪"}`, callback_data: encodeAction("tog_cln", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag) },
    ],
    [
      { text: `دیتابیس D1: ${state.d1 ? "روشن 🟢" : "خاموش ⚪"}`, callback_data: encodeAction("tog_d1", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag) },
      { text: `حافظه KV: ${state.kv ? "روشن 🟢" : "خاموش ⚪"}`, callback_data: encodeAction("tog_kv", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag) },
    ],
    [
      { text: `🚀 شروع استقرار ${p.title}`, callback_data: encodeAction("deploy", effectivePKey, obfFlag, clnFlag, d1Flag, kvFlag) },
      { text: "❌ انصراف", callback_data: "cancel" },
    ],
  ];

  if (messageId) {
    await tgApi(botToken, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      text,
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await tgApi(botToken, "sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text,
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}