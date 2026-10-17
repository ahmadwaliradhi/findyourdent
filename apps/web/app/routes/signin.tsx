import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { getI18n } from "~/i18n/config";
import { signInWithGoogle } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { safeRedirect } from "~/lib/safe-redirect";
import type { Route } from "./+types/signin";

export function meta({ matches }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [{ title: t("signin.title") }, { name: "robots", content: "noindex" }];
}

export function loader({ request }: Route.LoaderArgs) {
  return { redirectTo: safeRedirect(new URL(request.url).searchParams.get("redirectTo")) };
}

/** Google sign-in only, one tap, no verification step (spec 00). */
export default function SignIn({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const firebase = useFirebaseConfig().app;
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");

  const onClick = async () => {
    if (!firebase) return;
    setState("pending");
    try {
      await signInWithGoogle(firebase);
      window.location.assign(loaderData.redirectTo);
    } catch {
      setState("failed");
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="signin-title">
      <h1 id="signin-title" className="text-2xl font-bold">
        {t("signin.title")}
      </h1>
      <p className="text-muted-foreground">{t("signin.intro")}</p>
      <Button
        type="button"
        size="lg"
        className="w-full sm:w-auto sm:self-start"
        disabled={!firebase || state === "pending"}
        onClick={onClick}
      >
        {state === "pending" ? t("signin.pending") : t("signin.google")}
      </Button>
      <div aria-live="polite">
        {state === "failed" && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive-soft px-3 py-3 text-sm">
            {t("signin.failed")}
          </p>
        )}
        {!firebase && <p className="text-sm text-muted-foreground">{t("signin.unavailable")}</p>}
      </div>
    </section>
  );
}
