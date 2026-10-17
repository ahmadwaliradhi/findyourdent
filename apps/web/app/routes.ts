import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("language", "routes/language.ts"),
  route("api/guidance", "routes/api.guidance.ts"),
  route("panduan/:token", "routes/panduan.$token.tsx"),
] satisfies RouteConfig;
