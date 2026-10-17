import type * as React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, Form, useNavigation, useSubmit } from "react-router";
import { GuidanceResult } from "~/components/guidance-result";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { getI18n } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import { APP_CHECK_FIELD } from "~/lib/app-check";
import { getAppCheckToken } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { requestGuidance } from "~/server/guidance.server";
import { guidanceRoute, protectPaidRequest, setRetryAfter } from "~/server/protection.server";
import { getOrCreateSessionId } from "~/server/session.server";
import type { Route } from "./+types/home";

export function meta({ matches }: Route.MetaArgs) {
  const language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [{ title: t("meta.title") }, { name: "description", content: t("meta.description") }];
}

/** Form submission from the home page; the browser never calls the agent itself. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const complaintText = form.get("complaintText");
  const followUpAnswer = form.get("followUpAnswer");
  // The complaint is echoed back only so the Patient's own form keeps it; it is never stored.
  const echoed = typeof complaintText === "string" ? complaintText : "";

  const [language, session] = await Promise.all([detectLanguage(request), getOrCreateSessionId(request)]);
  const headers = new Headers();
  if (session.setCookie) headers.append("Set-Cookie", session.setCookie);

  const protection = await protectPaidRequest(context, {
    request,
    route: guidanceRoute(followUpAnswer, session.setCookie !== null),
    sessionId: session.sessionId,
    formToken: form.get(APP_CHECK_FIELD),
  });
  if (!protection.ok) {
    setRetryAfter(headers, protection);
    return data(
      { complaintText: echoed, error: protection.error, response: null },
      { status: protection.status, headers },
    );
  }

  const outcome = await requestGuidance(context, {
    sessionId: session.sessionId,
    language,
    complaintText,
    followUpAnswer,
  });

  if (!outcome.ok) {
    return data({ complaintText: echoed, error: outcome.error, response: null }, { status: outcome.status, headers });
  }
  return data({ complaintText: echoed, error: null, response: outcome.response }, { headers });
}

export default function Home({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  // Fetching the App Check token counts as pending too, so a second tap cannot send a second request.
  const [preparing, setPreparing] = useState(false);
  const pending = preparing || (navigation.state === "submitting" && navigation.formAction === "/?index");
  const submit = useSubmit();
  const firebase = useFirebaseConfig();
  // Until the page hydrates, a submit would skip onSubmit and post without an App Check token.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Guidance can call Gemini, so the server wants an App Check token with every submit.
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    setPreparing(true);
    void getAppCheckToken(firebase)
      .catch(() => "")
      .then((token) => {
        formData.set(APP_CHECK_FIELD, token);
        setPreparing(false);
        void submit(formData, { method: "post" });
      });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{t("home.headline")}</h1>
        <p className="text-muted-foreground">{t("home.intro")}</p>
      </div>

      <Form method="post" className="flex flex-col gap-4" aria-busy={pending} onSubmit={onSubmit}>
        <p
          role="note"
          className="rounded-md border border-primary/30 bg-secondary px-3 py-2 text-sm text-secondary-foreground"
          data-testid="consent"
        >
          {t("home.consent")}
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="complaintText" className="font-medium">
            {t("home.complaintLabel")}
          </label>
          <Textarea
            id="complaintText"
            name="complaintText"
            required
            maxLength={4000}
            defaultValue={actionData?.complaintText ?? ""}
            placeholder={t("home.complaintPlaceholder")}
            aria-describedby="complaintHint"
          />
          <p id="complaintHint" className="text-xs text-muted-foreground">
            {t("home.complaintHint")}
          </p>
        </div>
        <Button type="submit" size="lg" disabled={pending || !hydrated} className="w-full sm:w-auto sm:self-start">
          {pending ? t("home.submitting") : t("home.submit")}
        </Button>

        <div aria-live="polite" className="flex flex-col gap-3">
          {actionData?.error && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive-soft px-3 py-3 text-sm"
            >
              <p>{t(`errors.${actionData.error}`)}</p>
              <Button type="submit" variant="outline" size="sm" className="self-start" disabled={pending || !hydrated}>
                {t("errors.retry")}
              </Button>
            </div>
          )}
          {actionData?.response && <GuidanceResult response={actionData.response} pending={pending} />}
        </div>
      </Form>
    </div>
  );
}
