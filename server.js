require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

mustBeRouter("authRoutes", authRoutes);
mustBeRouter("projectRoutes", projectRoutes);
mustBeRouter("equipmentRoutes", equipmentRoutes);
mustBeRouter("projectItemRoutes", projectItemRoutes);
mustBeRouter("shortageRoutes", shortageRoutes);

// mount
app.use("/", authRoutes);
app.use("/api", projectRoutes);
app.use("/api", equipmentRoutes);
app.use("/api", projectItemRoutes);
app.use("/api", shortageRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));