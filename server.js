require("dotenv").config();
const express = require("express");
const cors = require("cors");
const projectRoutes = require("./routes/projects");
const authRoutes = require("./routes/auth");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("API is running"));

app.use(authRoutes);
app.use(projectRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
