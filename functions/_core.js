// functions/_core.js
const XOR_KEY = 0x4f;

function encodeStringToTable(str, key) {
  const utf8Str = unescape(encodeURIComponent(str));
  let out = "";
  for (let i = 0; i < utf8Str.length; i++) {
    out += String.fromCharCode(utf8Str.charCodeAt(i) ^ (key ^ (i % 11)));
  }
  return btoa(out);
}

export function obfuscateWorkerCode(code) {
  const stringTable = [];
  const stringIndexMap = new Map();

  function getOrAddString(strContent) {
    if (stringIndexMap.has(strContent)) return stringIndexMap.get(strContent);
    const idx = stringTable.length;
    stringTable.push(encodeStringToTable(strContent, XOR_KEY));
    stringIndexMap.set(strContent, idx);
    return idx;
  }

  let i = 0;
  const len = code.length;
  let output = "";

  while (i < len) {
    const char = code[i];
    const nextChar = i + 1 < len ? code[i + 1] : "";

    if (char === "/" && nextChar === "/") {
      const end = code.indexOf("\n", i);
      if (end === -1) { output += code.slice(i); break; }
      output += code.slice(i, end);
      i = end;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end === -1) { output += code.slice(i); break; }
      output += code.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    if (char === "`") {
      let end = i + 1;
      while (end < len) {
        if (code[end] === "\\") end += 2;
        else if (code[end] === "`") { end++; break; }
        else end++;
      }
      output += code.slice(i, end);
      i = end;
      continue;
    }

    if (char === "/") {
      const trimmed = output.trimEnd();
      const lastChar = trimmed.slice(-1);
      const isRegex = !lastChar || "(=:[,!&|?;{}~^+*%-".includes(lastChar) || /(?:return|case|delete|throw|typeof)\s*$/.test(trimmed);

      if (isRegex) {
        let end = i + 1;
        let inClass = false;
        while (end < len) {
          if (code[end] === "\\") end += 2;
          else if (code[end] === "[" && !inClass) { inClass = true; end++; }
          else if (code[end] === "]" && inClass) { inClass = false; end++; }
          else if (code[end] === "/" && !inClass) {
            end++;
            while (end < len && /[gimsuy]/.test(code[end])) end++;
            break;
          } else end++;
        }
        output += code.slice(i, end);
        i = end;
        continue;
      }
    }

    if (char === '"' || char === "'") {
      const quote = char;
      const strStart = i;
      let strEnd = i + 1;

      while (strEnd < len) {
        if (code[strEnd] === "\\") strEnd += 2;
        else if (code[strEnd] === quote) { strEnd++; break; }
        else if (code[strEnd] === "\n") break;
        else strEnd++;
      }

      const strLiteral = code.slice(strStart, strEnd);
      let rawVal = null;
      try {
        rawVal = quote === '"'
          ? JSON.parse(strLiteral)
          : JSON.parse(`"${strLiteral.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
      } catch {
        rawVal = strLiteral.slice(1, -1);
      }

      const prevTrimmed = output.trimEnd();
      const isImportExport = /(?:from|import)\s*$/.test(prevTrimmed);
      const isDirective = rawVal === "use strict";

      if (isImportExport || isDirective || !rawVal || rawVal.length === 0) {
        output += strLiteral;
        i = strEnd;
        continue;
      }

      let k = strEnd;
      while (k < len && (code[k] === " " || code[k] === "\t" || code[k] === "\r" || code[k] === "\n")) k++;
      const isFollowedByColon = (code[k] === ":" && code[k + 1] !== ":");
      const lastToken = prevTrimmed.slice(-1);
      const isTernaryOrCondition = lastToken === "?" || /(?:case)\s*$/.test(prevTrimmed);

      if (isFollowedByColon && !isTernaryOrCondition) {
        output += strLiteral;
      } else {
        const idx = getOrAddString(rawVal);
        output += `func_dec(${idx})`;
      }

      i = strEnd;
      continue;
    }

    output += char;
    i++;
  }

  const runtimeHeader = `// @ts-nocheck
const _0x_key = ${XOR_KEY};
const _0x_tbl = ${JSON.stringify(stringTable)};
const _0x_cache = new Map();
function func_dec(idx) {
  if (_0x_cache.has(idx)) return _0x_cache.get(idx);
  const raw = atob(_0x_tbl[idx]);
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ (_0x_key ^ (i % 11)));
  }
  try {
    out = decodeURIComponent(escape(out));
  } catch (_) {}
  _0x_cache.set(idx, out);
  return out;
}
`;
  return runtimeHeader + "\n" + output;
}

export async function deployWorker({ accountId, apiToken, workerName, scriptUrl, d1Name, bindingName, kvName, kvBindingName, enableObfuscation, recreateWorker, customDomain }) {
  if (!accountId || !apiToken || !workerName || !scriptUrl) {
    throw new Error("فیلدهای اجباری (Account ID، Token، نام ورکر و آدرس سورس) ناقص هستند.");
  }

  const cfHeaders = { Authorization: `Bearer ${apiToken}` };

  // ۱. دریافت فایل سورس
  const scriptRes = await fetch(scriptUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PagesDeployer/1.0" },
  });
  if (!scriptRes.ok) {
    throw new Error(`خطا در دانلود سورس: ${scriptRes.status} ${scriptRes.statusText}`);
  }
  let workerScript = await scriptRes.text();

  // ۲. مبهم‌سازی در صورت درخواست
  if (enableObfuscation) {
    workerScript = obfuscateWorkerCode(workerScript);
  }

  const bindings = [];
  let d1DatabaseId = null;
  let kvNamespaceId = null;

  // ۳. مدیریت دیتابیس D1
  if (d1Name && bindingName) {
    const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
      headers: cfHeaders,
    });
    const listData = await listRes.json();

    if (!listData.success) {
      const isAuthErr = listData.errors?.some(e => e.code === 10000);
      if (isAuthErr) {
        throw new Error("خطای دسترسی کلودفلر (کد ۱۰۰۰۰): توکن دسترسی 'D1: Edit' را ندارد یا Account ID اشتباه است.");
      }
      throw new Error(`خطای دیتابیس D1: ${JSON.stringify(listData.errors)}`);
    }

    const existingDb = listData.result?.find((db) => db.name === d1Name);

    if (existingDb) {
      d1DatabaseId = existingDb.uuid;
    } else {
      const d1Res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
        method: "POST",
        headers: { ...cfHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: d1Name }),
      });
      const d1Data = await d1Res.json();
      if (!d1Data.success) {
        throw new Error(`خطا در ایجاد D1: ${JSON.stringify(d1Data.errors)}`);
      }
      d1DatabaseId = d1Data.result.uuid;
    }

    bindings.push({ type: "d1", name: bindingName, id: d1DatabaseId });
  }

  // ۴. مدیریت KV Namespace
  if (kvName && kvBindingName) {
    const kvListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, {
      headers: cfHeaders,
    });
    const kvListData = await kvListRes.json();

    if (!kvListData.success) {
      throw new Error(`خطا در دسترسی KV: ${JSON.stringify(kvListData.errors)}`);
    }

    const existingKv = kvListData.result?.find((ns) => ns.title === kvName);

    if (existingKv) {
      kvNamespaceId = existingKv.id;
    } else {
      const createKvRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, {
        method: "POST",
        headers: { ...cfHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ title: kvName }),
      });
      const createKvData = await createKvRes.json();
      if (!createKvData.success) {
        throw new Error(`خطا در ایجاد KV Namespace: ${JSON.stringify(createKvData.errors)}`);
      }
      kvNamespaceId = createKvData.result.id;
    }

    bindings.push({ type: "kv_namespace", name: kvBindingName, namespace_id: kvNamespaceId });
  }

  // ۵. حذف ورکر قبلی در صورت نیاز
  if (recreateWorker) {
    try {
      await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
        method: "DELETE",
        headers: cfHeaders,
      });
    } catch (_) {}
  }

  // ۵. بارگذاری سورس روی کلودفلر
  const isModule = workerScript.includes("export default") || workerScript.includes("export ");
  const formData = new FormData();
  const metadata = {
    ...(isModule ? { main_module: "worker.js" } : { body_part: "worker.js" }),
    bindings: bindings,
    compatibility_date: new Date().toISOString().split("T")[0],
  };

  formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  formData.append("worker.js", new Blob([workerScript], { type: "application/javascript+module" }), "worker.js");

  const uploadRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
    method: "PUT",
    headers: cfHeaders,
    body: formData,
  });

  const uploadData = await uploadRes.json();
  if (!uploadData.success) {
    throw new Error(`خطا از سوی کلودفلر: ${JSON.stringify(uploadData.errors)}`);
  }

  // ۶. فعال‌سازی ساب‌دامین
  await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
    method: "POST",
    headers: { ...cfHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });

  let workerUrl = null;
  try {
    const subRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
      headers: cfHeaders,
    });
    const subData = await subRes.json();
    if (subData.success && subData.result?.subdomain) {
      workerUrl = `https://${workerName}.${subData.result.subdomain}.workers.dev`;
    }
  } catch (_) {}

  // ۷. اتصال دامنه اختصاصی (Custom Domain)
  let customDomainUrl = null;
  let customDomainError = null;

  if (customDomain && customDomain.trim()) {
    const cleanDomain = customDomain.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    try {
      const domainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`, {
        method: "PUT",
        headers: { ...cfHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          environment: "production",
          hostname: cleanDomain,
          service: workerName,
        }),
      });
      const domainData = await domainRes.json();
      if (domainData.success) {
        customDomainUrl = `https://${cleanDomain}`;
      } else {
        customDomainError = domainData.errors?.[0]?.message || "خطا در اتصال دامنه به ورکر";
      }
    } catch (err) {
      customDomainError = err.message;
    }
  }

  return {
    success: true,
    workerName,
    workerUrl,
    customDomainUrl,
    customDomainError,
    d1DatabaseId,
    kvNamespaceId,
    obfuscated: !!enableObfuscation,
    recreated: !!recreateWorker,
  };
}