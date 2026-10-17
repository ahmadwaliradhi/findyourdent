import { useTranslation } from "react-i18next";
import { data, Form, useNavigation } from "react-router";
import { GuidanceResult } from "~/components/guidance-result";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { getI18n } from "~/i18n/config";
import { detectLanguage } from "~/i18n/language.server";
import { requestGuidance } from "~/server/guidance.server";
import { getOrCreateSessionId } from "~/server/session.server";
import { sharePath } from "~/server/share.server";
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
  const [language, session] = await Promise.all([detectLanguage(request), getOrCreateSessionId(request)]);

  const outcome = await requestGuidance(context, {
    sessionId: session.sessionId,
    language,
    complaintText,
    followUpAnswer,
  });

  const headers = new Headers();
  if (session.setCookie) headers.append("Set-Cookie", session.setCookie);
  // The complaint is echoed back only so the Patient's own form keeps it; it is never stored.
  const echoed = typeof complaintText === "string" ? complaintText : "";
  if (!outcome.ok) {
    return data(
      { complaintText: echoed, error: outcome.error, response: null, share: null },
      { status: outcome.status, headers },
    );
  }
  const { response } = outcome;
  // Built from the Guidance object alone: the link never carries the complaint.
  const share =
    response.kind === "guidance"
      ? { path: sharePath(response.guidance, context.config.shareLinkSecret), origin: new URL(request.url).origin }
      : null;
  return data({ complaintText: echoed, error: null, response, share }, { headers });
}

export default function Home({ actionData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const pending = navigation.state === "submitting" && navigation.formAction === "/?index";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{t("home.headline")}</h1>
        <p className="text-muted-foreground">{t("home.intro")}</p>
      </div>

      <Form method="post" className="flex flex-col gap-4" aria-busy={pending}>
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
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto sm:self-start">
          {pending ? t("home.submitting") : t("home.submit")}
        </Button>

        <div aria-live="polite" className="flex flex-col gap-3">
          {actionData?.error && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive-soft px-3 py-3 text-sm"
            >
              <p>{t(`errors.${actionData.error}`)}</p>
              <Button type="submit" variant="outline" size="sm" className="self-start" disabled={pending}>
                {t("errors.retry")}
              </Button>
            </div>
          )}
          {actionData?.response && (
            <GuidanceResult response={actionData.response} pending={pending} share={actionData.share} />
          )}
        </div>
      </Form>
    </div>
  );
}
