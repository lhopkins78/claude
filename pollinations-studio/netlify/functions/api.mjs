import { handleApi } from "../../lib/api.mjs";

export default (req) =>
  handleApi(req, {
    key: Netlify.env.get("POLLINATIONS_KEY"),
    appPassword: Netlify.env.get("APP_PASSWORD") || "",
  });

export const config = { path: "/api/*" };
