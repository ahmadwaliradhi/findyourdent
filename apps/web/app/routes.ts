import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("language", "routes/language.ts"),
  route("api/guidance", "routes/api.guidance.ts"),
  route("api/shortlist", "routes/api.shortlist.ts"),
  route("api/providers/:placeId/google", "routes/api.providers.$placeId.google.ts"),
  route("api/providers/:placeId/reviews", "routes/api.providers.$placeId.reviews.ts"),
  route("signin", "routes/signin.tsx"),
  route("auth/session", "routes/auth.session.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("admin", "routes/admin.tsx"),
  route("panduan/:token", "routes/panduan.$token.tsx"),
  route("api/guidance-card", "routes/api.guidance-card.ts"),
  route("api/feed", "routes/api.feed.ts"),
  route("direktori", "routes/direktori.tsx"),
  route("tempat/:placeId", "routes/tempat.$placeId.tsx"),
  route("dampak", "routes/dampak.ts"),
  route("sitemap.xml", "routes/sitemap.xml.ts"),
] satisfies RouteConfig;
