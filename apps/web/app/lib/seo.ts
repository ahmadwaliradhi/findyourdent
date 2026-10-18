import type { MetaDescriptor } from "react-router";

export const SITE_NAME = "FindYourDent";

/** Where business and privacy questions go; shown in the footer, About, Privacy and Terms. */
export const BUSINESS_EMAIL = "business@findyourdent.com";

/**
 * Open Graph and Twitter tags for link previews (WhatsApp reads Open Graph).
 * `url` must be absolute. Pass only first-party text: never Google content.
 */
export function openGraphMeta({
  title,
  description,
  url,
}: {
  title: string;
  description: string;
  url: string;
}): MetaDescriptor[] {
  const image = new URL("/og-image.png", url).href;
  return [
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: url },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
}
