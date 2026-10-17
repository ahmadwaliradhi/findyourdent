import type { MetaDescriptor } from "react-router";

export const SITE_NAME = "FindYourDent";

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
  return [
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: url },
    { property: "og:site_name", content: SITE_NAME },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}
