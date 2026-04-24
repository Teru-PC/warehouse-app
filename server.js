require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

// HTTPSリダイレクト（Render本番環境のみ）
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.redirect("/login.html");
});
app.use(express.static(path.join(__dirname, "public")));

/**
 * require() の戻り値がどんな形でも Router を取り出す
 */
function asRouter(mod) {
  if (!mod) return mod;

  if (typeof mod === "function") return mod;

  if (typeof mod === "object") {
    if (typeof mod.router === "function") return mod.router;
    if (typeof mod.default === "function") return mod.default;
    for (const v of Object.values(mod)) {
      if (typeof v === "function") return v;
    }
  }

  return mod;
}

function mustBeRouter(name, r) {
  if (typeof r !== "function") {
    const keys = (r && typeof r === "object") ? Object.keys(r) : [];
    throw new Error(`${name} is not a router function. type=${typeof r} keys=${keys.join(",")}`);
  }
}

// routes
const authRoutes        = asRouter(require("./routes/auth"));
const projectRoutes     = asRouter(require("./routes/projects"));
const equipmentRoutes   = asRouter(require("./routes/equipment"));
const projectItemRoutes = asRouter(require("./routes/project_items"));
const shortageRoutes    = asRouter(require("./routes/shortages"));
const quotesRoutes      = asRouter(require("./routes/quotes"));
const googleCalendarRoutes = require("./routes/google_calendar");
const adminRoutes       = require("./routes/admin");

mustBeRouter("authRoutes", authRoutes);
mustBeRouter("projectRoutes", projectRoutes);
mustBeRouter("googleCalendarRoutes", googleCalendarRoutes);
mustBeRouter("adminRoutes", adminRoutes);
mustBeRouter("equipmentRoutes", equipmentRoutes);
mustBeRouter("projectItemRoutes", projectItemRoutes);
mustBeRouter("shortageRoutes", shortageRoutes);

// mount
app.use("/", authRoutes);
app.use("/api", projectRoutes);
app.use("/api/equipment", equipmentRoutes);
app.use("/api/upload", asRouter(require("./routes/upload")));
app.use("/api", googleCalendarRoutes);
app.use("/", adminRoutes);
app.use("/api", projectItemRoutes);
app.use("/api", shortageRoutes);
app.use("/api/quotes", quotesRoutes);

// ログイン試行制限（ルートマウントより前に設定）
const rateLimit = require("express-rate-limit");
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 10, // 10回まで
  message: { error: "試行回数が多すぎます。15分後に再試行してください" }
});
app.use("/api/auth/login", loginLimiter);

const PORT = process.env.PORT || 3000;

// 全体エラーハンドラー
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));