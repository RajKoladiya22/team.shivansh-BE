import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import routes from "./routes";
import { checkStaticToken } from "./core/middleware/key";
import { requestLogger } from "./core/help/logs/requestLogger";
import path from "path";

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));
//
app.use(
  cors({
    origin: ["https://team.shivanshinfosys.in", "http://localhost:5173"],
    credentials: true,
    optionsSuccessStatus: 204,
  }),
);
app.use(helmet());
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(compression());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use("/storage", express.static(path.join(__dirname, "storage")));

const whitelist = ["/api/v1/auth/reset-password"];

app.use(requestLogger);
app.use(checkStaticToken(whitelist));
app.use(cookieParser());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid JSON payload." });
  }
  next();
});

app.use("/api/v1", routes);

export default app;
