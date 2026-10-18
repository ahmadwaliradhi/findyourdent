// Attaching a Proof of Visit later, from "Testimoni saya" (spec 09 user stories 12 and
// 13): the published Testimony stays as it is while the proof alone is checked, and the
// result shows right away.
import { FileCheck, Upload } from "lucide-react";
import type * as React from "react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { FieldError } from "~/components/ui/field";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { getAppCheckToken } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { VERIFICATION_PATH } from "~/lib/paths";
import { PROOF_MIME_TYPES, type ProofAttachResponse, SUBMISSION_FIELDS, type TestimonyApiError } from "~/lib/testimony";
import { checkPickedFile } from "~/lib/testimony-draft";

export function AttachProof({
  testimonyId,
  attemptsLeft,
  onAttached,
}: {
  testimonyId: string;
  /** Proofs the author may still send; at least 1 when this is shown. */
  attemptsLeft: number;
  onAttached: (response: ProofAttachResponse) => void;
}) {
  const { t } = useTranslation();
  const firebase = useFirebaseConfig();
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sending needs JavaScript (App Check, the result in place), so a file picked before
  // hydration would be lost: the picker waits for it.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!picked) return;
    const check = checkPickedFile(picked, "proof");
    setFile(check ? null : picked);
    setError(check ? t(`testimonyForm.${check.key}`, check.values) : null);
  };

  const send = async () => {
    if (!file) return;
    setSending(true);
    setError(null);
    try {
      const body = new FormData();
      body.set(SUBMISSION_FIELDS.proof, file);
      const token = await getAppCheckToken(firebase);
      const response = await fetch(`/api/testimonies/${encodeURIComponent(testimonyId)}/proof`, {
        method: "POST",
        body,
        headers: token ? { [APP_CHECK_HEADER]: token } : {},
      });
      if (response.ok) {
        setFile(null);
        onAttached((await response.json()) as ProofAttachResponse);
        return;
      }
      const refusal = (await response.json().catch(() => null)) as Partial<TestimonyApiError> | null;
      setError(refusal?.fieldErrors?.proof ?? refusal?.message ?? t("myTestimonies.attachProof.failed"));
    } catch {
      setError(t("myTestimonies.attachProof.failed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border-strong px-4 py-3 text-sm">
      <span className="font-semibold">{t("myTestimonies.attachProof.title")}</span>
      <p id={hintId} className="text-muted-foreground">
        {t("myTestimonies.attachProof.hint")} {t("myTestimonies.attachProof.attemptsLeft", { count: attemptsLeft })}{" "}
        <Link to={VERIFICATION_PATH} className="font-medium text-primary underline underline-offset-4">
          {t("nav.verification")}
        </Link>
      </p>
      {file ? (
        <>
          <span className="flex items-center gap-2">
            <FileCheck aria-hidden="true" strokeWidth={1.75} className="size-5 shrink-0 text-success" />
            <span className="break-all font-semibold">{file.name}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={sending} onClick={send}>
              {sending ? t("myTestimonies.attachProof.sending") : t("myTestimonies.attachProof.send")}
            </Button>
            <Button variant="outline" size="sm" disabled={sending} onClick={() => setFile(null)}>
              {t("myTestimonies.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <label
          htmlFor={`${id}-file`}
          className="inline-flex min-h-touch w-fit cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-card px-4 text-base font-semibold shadow-xs hover:border-foreground has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-default has-disabled:opacity-60"
        >
          <Upload aria-hidden="true" strokeWidth={1.75} className="size-5 text-muted-foreground" />
          {t("myTestimonies.attachProof.choose")}
          <input
            id={`${id}-file`}
            type="file"
            accept={PROOF_MIME_TYPES.join(",")}
            onChange={pick}
            disabled={!hydrated}
            className="sr-only"
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
          />
        </label>
      )}
      {error ? (
        <FieldError id={errorId} role="alert">
          {error}
        </FieldError>
      ) : null}
    </div>
  );
}
