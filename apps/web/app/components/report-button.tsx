import type { ReportCategory } from "@findyourdent/contracts/firestore";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { getAppCheckToken } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import {
  HIDING_CATEGORIES,
  REPORT_CATEGORIES,
  REPORT_DETAILS_MAX_CHARS,
  type ReportApiError,
  type ReportRequest,
  type ReportResponse,
} from "~/lib/reports";

type State =
  | { step: "closed" | "open" | "sending" }
  | { step: "sent"; hidden: boolean }
  | { step: "failed"; message: string };

/** "Laporkan" on a public Testimony (spec 03): anyone may report, no sign-in needed. */
export function ReportButton({ testimonyId, onHidden }: { testimonyId: string; onHidden?: () => void }) {
  const { t } = useTranslation();
  const firebase = useFirebaseConfig();
  const id = useId();
  const [state, setState] = useState<State>({ step: "closed" });
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState("");

  if (state.step === "closed") {
    return (
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setState({ step: "open" })}>
        {t("report.open")}
      </Button>
    );
  }
  if (state.step === "sent") {
    return (
      <p role="status" className="text-sm">
        {state.hidden ? t("report.sentHidden") : t("report.sent")}
      </p>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!category) return;
    setState({ step: "sending" });
    const body: ReportRequest = { category, ...(details.trim() ? { details: details.trim() } : {}) };
    try {
      const token = await getAppCheckToken(firebase);
      const response = await fetch(`/api/testimonies/${encodeURIComponent(testimonyId)}/reports`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { [APP_CHECK_HEADER]: token } : {}) },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const { hidden } = (await response.json()) as ReportResponse;
        setState({ step: "sent", hidden });
        if (hidden) onHidden?.();
        return;
      }
      const error = (await response.json().catch(() => null)) as ReportApiError | null;
      setState({ step: "failed", message: error?.message ?? t("report.failed") });
    } catch {
      setState({ step: "failed", message: t("report.failed") });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border p-3" aria-labelledby={`${id}-title`}>
      <fieldset className="flex flex-col gap-2">
        <legend id={`${id}-title`} className="mb-1 font-medium">
          {t("report.title")}
        </legend>
        {REPORT_CATEGORIES.map((value) => (
          <label key={value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-category`}
              value={value}
              checked={category === value}
              onChange={() => setCategory(value)}
              className="mt-1"
            />
            <span>
              {t(`report.categories.${value}`)}
              {HIDING_CATEGORIES.has(value) && (
                <span className="block text-xs text-muted-foreground">{t("report.hidesAtOnce")}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-details`}>{t("report.details")}</label>
        <Textarea
          id={`${id}-details`}
          value={details}
          maxLength={REPORT_DETAILS_MAX_CHARS}
          onChange={(event) => setDetails(event.target.value)}
          className="min-h-16"
        />
      </div>
      {state.step === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!category || state.step === "sending"}>
          {state.step === "sending" ? t("report.sending") : t("report.submit")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setState({ step: "closed" })}>
          {t("report.cancel")}
        </Button>
      </div>
    </form>
  );
}
