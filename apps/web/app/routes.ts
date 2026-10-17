import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("language", "routes/language.ts"),
  route("api/guidance", "routes/api.guidance.ts"),
  route("api/shortlist", "routes/api.shortlist.ts"),
  route("signin", "routes/signin.tsx"),
  route("auth/session", "routes/auth.session.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("admin", "routes/admin.tsx"),
  route("panduan/:token", "routes/panduan.$token.tsx"),
] satisfies RouteConfig;
