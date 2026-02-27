const fs = require("fs");
const path = require("path");

const url = process.env.BUNDL_SUPABASE_URL;
const key = process.env.BUNDL_SUPABASE_ANON_KEY;
const apiUrl = process.env.BUNDL_API_URL;

if (!url || !key || !apiUrl) {
  console.error("✗ Missing BUNDL_SUPABASE_URL, BUNDL_SUPABASE_ANON_KEY, or BUNDL_API_URL");
  console.error("  Set these environment variables before publishing.");
  process.exit(1);
}

const configPath = path.join(__dirname, "../dist/utils/config.js");

if (!fs.existsSync(configPath)) {
  console.error("✗ dist/utils/config.js not found — run npm run build first");
  process.exit(1);
}

let content = fs.readFileSync(configPath, "utf8");
content = content.replace("__SUPABASE_URL__", url);
content = content.replace("__SUPABASE_ANON_KEY__", key);
content = content.replace("__BUNDL_API_URL__", apiUrl);
fs.writeFileSync(configPath, content);
console.log("✓ Supabase and API config injected into dist");
