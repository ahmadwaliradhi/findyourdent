// The Testimony posting form (spec 03, user stories 9 to 23): mobile first, a draft
// kept in the browser, Google sign-in only when the Patient presses Kirim, and the
// fix-before-submit loop when Moderation flags something the author can fix.
import procedureList from "@findyourdent/contracts/data/procedures.json";
import { Check, FileCheck, Plus, TriangleAlert, Upload } from "lucide-react";
import type * as React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ProviderFields } from "~/components/provider-fields";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ErrorNotice } from "~/components/ui/error-notice";
import { FieldError, fieldClassName } from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import { isLanguage, type Language } from "~/i18n/config";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { ASPECTS } from "~/lib/aspects";
import { type FixIssue, issuesBySentence, rulesWithoutSpan } from "~/lib/author-fix";
import { getAppCheckToken, signInWithGoogle } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { providerPath, VERIFICATION_PATH } from "~/lib/paths";
import { procedureLabel } from "~/lib/procedures";
import {
  isAuthorFixable,
  PHOTO_MIME_TYPES,
  PROOF_MIME_TYPES,
  SUBMISSION_FIELDS,
  TESTIMONY_LIMITS,
  type TestimonyApiError,
  type TestimonyAuthorFixResponse,
  type TestimonyStoredResponse,
  type TestimonySubmission,
  type TestimonySubmitResponse,
} from "~/lib/testimony";
import {
  type Aspect,
  checkPickedFile,
  DRAFT_KEY,
  type FormError,
  formatPriceInput,
  hasContent,
  isFutureMonth,
  parseDraft,
  serializeDraft,
  stateFromInitial,
  type TestimonyFormState,
  toSubmission,
  validateForm,
  visitYears,
} from "~/lib/testimony-draft";
import { cn } from "~/lib/utils";

export interface TestimonyFormProps {
  /** create: POST /api/testimonies, with a browser draft. edit: POST /api/testimonies/:testimonyId. */
  mode: "create" | "edit";
  /** Edit: the Testimony id. */
  testimonyId?: string;
  /** Create: a place picked on the Provider page. Edit: the stored content, with photo URLs for keepPhotoPaths. */
  initial?: Partial<TestimonySubmission> & { photos?: Array<{ path: string; url: string }> };
  /** Edit: the Listed Provider being written about (it cannot change). */
  provider?: { placeId: string; name: string };
}

/** 'Testimoni saya' (built with the edit page). */
const MY_TESTIMONIES_PATH = "/testimoni-saya";
const PROVIDER_ERROR_KEYS = ["placeId", "providerName", "region.provinceCode", "region.regencyCode"];
/** Each card's title, and each field's visible label (the design system's h3 and label styles). */
const sectionTitle = "text-lg leading-6 font-[650]";
const labelClass = "text-sm leading-5 font-semibold text-foreground";
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

interface NewPhoto {
  id: string;
  file: File;
  /** Object URL for the preview; revoked when the photo goes. */
  url: string;
}

type Phase = "editing" | "sending" | "signingIn";
interface Problem {
  message: string;
  alreadyPosted?: boolean;
}

// Storage can throw (private mode, blocked site data); the form works without it.
function readDraft(): string | null {
  try {
    return window.localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

function writeDraft(value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, value);
  } catch {
    // Nothing to do: the draft is a convenience.
  }
}

function monthName(month: string, language: Language): string {
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-ID", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, Number(month) - 1, 1)),
  );
}

async function readApiError(response: Response): Promise<TestimonyApiError | null> {
  try {
    return (await response.json()) as TestimonyApiError;
  } catch {
    return null;
  }
}

export function TestimonyForm({ mode, testimonyId, initial, provider }: TestimonyFormProps) {
  const { t, i18n } = useTranslation();
  const language: Language = isLanguage(i18n.language) ? i18n.language : "id";
  const firebase = useFirebaseConfig();
  const formId = useId();
  const id = (name: string) => `${formId}-${name}`;

  const [state, setState] = useState<TestimonyFormState>(() => stateFromInitial(initial));
  const [photos, setPhotos] = useState<NewPhoto[]>([]);
  const [kept, setKept] = useState(initial?.photos ?? []);
  const [proof, setProof] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("editing");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [result, setResult] = useState<{ response: TestimonyStoredResponse; proofSent: boolean } | null>(null);
  const [fix, setFix] = useState<TestimonyAuthorFixResponse | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  // The create draft loads after hydration; nothing is saved before it has.
  const [draftLoaded, setDraftLoaded] = useState(mode !== "create");
  // Kirim needs JavaScript (files and sign-in), so it waits for hydration.
  const [hydrated, setHydrated] = useState(false);
  // After a sign_in_required answer, the next Kirim opens Google first, inside the tap,
  // so a popup blocker does not stop it.
  const [signInFirst, setSignInFirst] = useState(false);
  const problemRef = useRef<HTMLDivElement>(null);
  const fixRef = useRef<HTMLDivElement>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const now = useMemo(() => new Date(), []);
  const busy = phase !== "editing";
  const initialPlaceId = initial?.placeId;

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (mode !== "create") return;
    const draft = parseDraft(readDraft());
    // A draft about another place does not replace the place picked on a Provider page.
    const samePlace = !initialPlaceId || !draft?.provider.placeId || draft.provider.placeId === initialPlaceId;
    if (draft && hasContent(draft) && samePlace) {
      const placeId = draft.provider.placeId ?? initialPlaceId ?? null;
      setState({ ...draft, provider: { ...draft.provider, placeId } });
      setDraftRestored(true);
    }
    setDraftLoaded(true);
  }, [mode, initialPlaceId]);

  useEffect(() => {
    if (mode !== "create" || !draftLoaded || result) return;
    writeDraft(hasContent(state) ? serializeDraft(state) : null);
  }, [mode, draftLoaded, state, result]);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    },
    [],
  );

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  useEffect(() => {
    if (fix) fixRef.current?.focus();
  }, [fix]);

  const update = (patch: Partial<TestimonyFormState>) => setState((current) => ({ ...current, ...patch }));
  const message = (error: FormError) => t(`testimonyForm.${error.key}`, error.values);
  const fieldProps = (name: string, describedBy?: string) => {
    const described = [describedBy, errors[name] ? id(`${name}-error`) : undefined].filter(Boolean).join(" ");
    return { "aria-invalid": errors[name] ? true : undefined, "aria-describedby": described || undefined };
  };

  const addPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const room = TESTIMONY_LIMITS.photosMax - kept.length - photos.length;
    const accepted: NewPhoto[] = [];
    let refusal: string | undefined;
    for (const file of picked) {
      const check = checkPickedFile(file, "photo");
      if (check) refusal = message(check);
      else if (accepted.length >= room) {
        refusal = message({ key: "fileErrors.photoCount", values: { max: TESTIMONY_LIMITS.photosMax } });
      } else accepted.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
    setPhotos((current) => [...current, ...accepted]);
    setErrors(({ photos: _, ...rest }) => (refusal ? { ...rest, photos: refusal } : rest));
  };

  const removePhoto = (photoId: string) => {
    setPhotos((current) => {
      const gone = current.find((photo) => photo.id === photoId);
      if (gone) URL.revokeObjectURL(gone.url);
      return current.filter((photo) => photo.id !== photoId);
    });
  };

  const pickProof = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const check = checkPickedFile(file, "proof");
    setProof(check ? null : file);
    setErrors(({ proof: _, ...rest }) => (check ? { ...rest, proof: message(check) } : rest));
  };

  const discardDraft = () => {
    writeDraft(null);
    setState(stateFromInitial(initial));
    setDraftRestored(false);
    setErrors({});
    setProblem(null);
  };

  const placeId = provider?.placeId ?? state.provider.placeId ?? initialPlaceId ?? "";

  const send = async (): Promise<Response> => {
    const body = new FormData();
    const submission = toSubmission(state, {
      placeId,
      ...(mode === "edit" ? { keepPhotoPaths: kept.map((photo) => photo.path) } : {}),
    });
    body.set(SUBMISSION_FIELDS.json, JSON.stringify(submission));
    for (const photo of photos) body.append(SUBMISSION_FIELDS.photos, photo.file);
    if (proof) body.set(SUBMISSION_FIELDS.proof, proof);
    const token = await getAppCheckToken(firebase);
    const url = mode === "edit" ? `/api/testimonies/${encodeURIComponent(testimonyId ?? "")}` : "/api/testimonies";
    return fetch(url, { method: "POST", body, headers: token ? { [APP_CHECK_HEADER]: token } : {} });
  };

  /** Google sign-in; false (with the problem shown) when it did not work. The draft stays. */
  const signIn = async (): Promise<boolean> => {
    if (!firebase.app) {
      setProblem({ message: t("testimonyForm.apiErrors.signInUnavailable") });
      return false;
    }
    setPhase("signingIn");
    try {
      await signInWithGoogle(firebase.app);
      setSignInFirst(false);
      return true;
    } catch {
      setSignInFirst(true);
      setProblem({ message: t("testimonyForm.apiErrors.signInFailed") });
      return false;
    } finally {
      setPhase("sending");
    }
  };

  const handleResponse = async (response: Response) => {
    if (response.ok) {
      const body = (await response.json()) as TestimonySubmitResponse;
      if (body.status === "needsAuthorFix") {
        // Nothing was stored: the form, photos and Proof of Visit stay for the next Kirim.
        setFix(body);
        return;
      }
      setFix(null);
      setResult({ response: body, proofSent: proof !== null });
      if (mode === "create") writeDraft(null);
      for (const photo of photos) URL.revokeObjectURL(photo.url);
      setPhotos([]);
      return;
    }
    const error = await readApiError(response);
    if (error?.fieldErrors && Object.keys(error.fieldErrors).length > 0) {
      setErrors(error.fieldErrors);
      setProblem({ message: error.message || t("testimonyForm.errorSummary") });
      return;
    }
    switch (error?.error) {
      case "already_posted":
        setProblem({ message: t("testimonyForm.apiErrors.alreadyPosted"), alreadyPosted: true });
        return;
      case "rate_limited":
        setProblem({ message: t("testimonyForm.apiErrors.rateLimited") });
        return;
      case "app_check_required":
        setProblem({ message: t("testimonyForm.apiErrors.appCheck") });
        return;
      case "sign_in_required":
        setSignInFirst(true);
        setProblem({ message: t("testimonyForm.apiErrors.signInFailed") });
        return;
      default:
        setProblem({ message: error?.message || t("testimonyForm.apiErrors.generic") });
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const found = validateForm(state, { mode, now: new Date() });
    if (Object.keys(found).length > 0) {
      setErrors(Object.fromEntries(Object.entries(found).map(([field, error]) => [field, message(error)])));
      setProblem({ message: t("testimonyForm.errorSummary") });
      return;
    }
    setErrors({});
    setProblem(null);
    setPhase("sending");
    try {
      if (signInFirst && !(await signIn())) return;
      let response = await send();
      if (response.status === 401) {
        const error = await readApiError(response.clone());
        if (error?.error === "sign_in_required") {
          if (!(await signIn())) return;
          response = await send();
        }
      }
      await handleResponse(response);
    } catch {
      setProblem({ message: t("testimonyForm.apiErrors.network") });
    } finally {
      setPhase("editing");
    }
  };

  if (result) return <Result {...result} mode={mode} placeId={placeId} />;

  const providerErrors = Object.fromEntries(
    Object.entries(errors).filter(([field]) => PROVIDER_ERROR_KEYS.includes(field)),
  );
  const photoCount = kept.length + photos.length;
  const years = visitYears(now);
  const fieldError = (name: string) =>
    errors[name] ? <FieldError id={id(`${name}-error`)}>{errors[name]}</FieldError> : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" aria-busy={busy}>
      {draftRestored && (
        <div
          className="flex flex-col gap-2 rounded-md border border-success-line bg-success-soft px-4 py-3 text-sm"
          role="status"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <p className="flex items-center gap-2 font-semibold">
              <Check aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-success" />
              <span>{t("testimonyForm.draftRestored")}</span>
            </p>
            <Button type="button" variant="link" size="sm" className="px-0" onClick={discardDraft}>
              {t("testimonyForm.discardDraft")}
            </Button>
          </div>
          <p>{t("testimonyForm.photosReattach")}</p>
        </div>
      )}

      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-6">
        <Card labelledBy={id("provider-title")} className="p-5 desktop:p-6">
          <h2 id={id("provider-title")} className={sectionTitle}>
            {t("testimonyForm.providerReadOnly")}
          </h2>
          {/* The edit page shows the Provider, which cannot change. */}
          {mode === "edit" ? (
            <p className="rounded-md bg-muted px-4 py-3 font-semibold">{provider?.name}</p>
          ) : (
            <ProviderFields
              value={state.provider}
              onChange={(value) => update({ provider: value })}
              errors={providerErrors}
              disabled={busy}
            />
          )}
        </Card>

        <Card labelledBy={id("ratings-title")} className="p-5 desktop:p-6">
          <div className="flex flex-col gap-1">
            <h2 id={id("ratings-title")} className={sectionTitle}>
              {t("testimonyForm.ratingsTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("testimonyForm.ratingsHint")}</p>
          </div>
          {ASPECTS.map((aspect) => (
            <RatingGroup
              key={aspect}
              aspect={aspect}
              name={id(`rating-${aspect}`)}
              value={state.ratings[aspect]}
              error={errors[`ratings.${aspect}`]}
              errorId={id(`ratings.${aspect}-error`)}
              onChange={(value) => update({ ratings: { ...state.ratings, [aspect]: value } })}
            />
          ))}
        </Card>

        {/* The card title is the textarea's visible label, so the card is not also named by it. */}
        <Card className="p-5 desktop:p-6">
          <h2 className={sectionTitle}>
            <label htmlFor={id("text")}>{t("testimonyForm.textLabel")}</label>
          </h2>
          <div className="flex flex-col gap-2">
            <Textarea
              id={id("text")}
              value={state.text}
              maxLength={TESTIMONY_LIMITS.textMaxChars}
              onChange={(event) => update({ text: event.currentTarget.value })}
              className="min-h-40"
              {...fieldProps("text", id("text-hint"))}
              {...(fix ? { "aria-invalid": true } : {})}
            />
            <div className="flex flex-col gap-1 desktop:flex-row desktop:items-start desktop:justify-between desktop:gap-4">
              <p id={id("text-hint")} className="text-sm text-muted-foreground">
                {t("testimonyForm.textHint")}
              </p>
              <p className="shrink-0 text-sm text-muted-foreground tabular-nums" aria-live="polite">
                {t("testimonyForm.textCounter", {
                  used: state.text.length.toLocaleString(language === "id" ? "id-ID" : "en-ID"),
                  max: TESTIMONY_LIMITS.textMaxChars.toLocaleString(language === "id" ? "id-ID" : "en-ID"),
                })}
              </p>
            </div>
            {fieldError("text")}
          </div>
          {fix && <AuthorFixPanel fix={fix} panelRef={fixRef} />}
        </Card>

        <Card labelledBy={id("details-title")} className="p-5 desktop:p-6">
          <h2 id={id("details-title")} className={sectionTitle}>
            {t("testimonyForm.detailsTitle")}
          </h2>

          <div className="grid gap-4 desktop:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor={id("procedure")} className={labelClass}>
                {t("testimonyForm.procedureLabel")}
              </label>
              <select
                id={id("procedure")}
                value={state.procedureCode}
                onChange={(event) => update({ procedureCode: event.currentTarget.value })}
                className={fieldClassName}
                {...fieldProps("procedureCode")}
              >
                <option value="">{t("testimonyForm.procedureNone")}</option>
                {procedureList.procedures.map((procedure) => (
                  <option key={procedure.code} value={procedure.code}>
                    {procedureLabel(procedure.code, language)}
                  </option>
                ))}
              </select>
              {fieldError("procedureCode")}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor={id("price")} className={labelClass}>
                {t("testimonyForm.priceLabel")}
              </label>
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
                >
                  Rp
                </span>
                <input
                  id={id("price")}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={formatPriceInput(state.price)}
                  onChange={(event) => update({ price: event.currentTarget.value.replace(/\D/g, "").slice(0, 10) })}
                  className={cn(fieldClassName, "pl-10 tabular-nums")}
                  {...fieldProps("pricePaidRupiah", id("price-hint"))}
                />
              </div>
              <p id={id("price-hint")} className="text-sm text-muted-foreground">
                {t("testimonyForm.priceHint")}
              </p>
              {fieldError("pricePaidRupiah")}
            </div>
          </div>

          <fieldset className="flex min-w-0 flex-col gap-2" {...fieldProps("visitMonth", id("visit-hint"))}>
            <legend className={cn(labelClass, "pb-2")}>{t("testimonyForm.visitLabel")}</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={id("visit-month")} className="text-sm text-muted-foreground">
                  {t("testimonyForm.visitMonth")}
                </label>
                <select
                  id={id("visit-month")}
                  value={state.visitMonth}
                  onChange={(event) => update({ visitMonth: event.currentTarget.value })}
                  className={fieldClassName}
                  aria-invalid={errors.visitMonth ? true : undefined}
                >
                  <option value="">{t("testimonyForm.visitMonthPlaceholder")}</option>
                  {MONTHS.map((month) => (
                    <option
                      key={month}
                      value={month}
                      disabled={Boolean(state.visitYear) && isFutureMonth(state.visitYear, month, now)}
                    >
                      {monthName(month, language)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={id("visit-year")} className="text-sm text-muted-foreground">
                  {t("testimonyForm.visitYear")}
                </label>
                <select
                  id={id("visit-year")}
                  value={state.visitYear}
                  onChange={(event) => update({ visitYear: event.currentTarget.value })}
                  className={fieldClassName}
                  aria-invalid={errors.visitMonth ? true : undefined}
                >
                  <option value="">{t("testimonyForm.visitYearPlaceholder")}</option>
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {fieldError("visitMonth")}
            <p id={id("visit-hint")} className="text-sm text-muted-foreground">
              {t("testimonyForm.visitHint")}
            </p>
          </fieldset>
        </Card>

        <Card labelledBy={id("files-title")} className="p-5 desktop:p-6">
          <h2 id={id("files-title")} className={sectionTitle}>
            {t("testimonyForm.filesTitle")}
          </h2>

          <div className="flex flex-col gap-2">
            <h3 className={labelClass}>{t("testimonyForm.photosLabel", { max: TESTIMONY_LIMITS.photosMax })}</h3>
            <ul className="grid grid-cols-2 gap-3 desktop:grid-cols-4">
              {[
                ...kept.map((photo) => ({ key: photo.path, url: photo.url, kept: true })),
                ...photos.map((photo) => ({ key: photo.id, url: photo.url, kept: false })),
              ].map((photo, index) => (
                <li key={photo.key} className="flex flex-col gap-2">
                  <img
                    src={photo.url}
                    alt={t("testimonyForm.photoAlt", { index: index + 1 })}
                    className="aspect-square w-full rounded-md border object-cover"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      photo.kept
                        ? setKept((current) => current.filter((k) => k.path !== photo.key))
                        : removePhoto(photo.key)
                    }
                  >
                    {t("testimonyForm.photoRemove", { index: index + 1 })}
                  </Button>
                </li>
              ))}
              {photoCount < TESTIMONY_LIMITS.photosMax && (
                <li>
                  <label
                    htmlFor={id("photos")}
                    className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border-strong bg-card px-2 text-center text-sm font-semibold hover:border-foreground has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
                  >
                    <Plus aria-hidden="true" strokeWidth={1.75} className="size-6 text-muted-foreground" />
                    {t("testimonyForm.photosAdd")}
                    <input
                      id={id("photos")}
                      type="file"
                      multiple
                      accept={PHOTO_MIME_TYPES.join(",")}
                      onChange={addPhotos}
                      className="sr-only"
                      {...fieldProps("photos", id("photos-hint"))}
                    />
                  </label>
                </li>
              )}
            </ul>
            <p id={id("photos-hint")} className="text-sm text-muted-foreground">
              {t("testimonyForm.photosGuidance")}
            </p>
            {fieldError("photos")}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className={labelClass}>{t("testimonyForm.proofLabel")}</h3>
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border-strong bg-card px-5 py-5 text-center">
              {proof ? (
                <>
                  <FileCheck aria-hidden="true" strokeWidth={1.75} className="size-6 text-success" />
                  <span className="max-w-full break-all font-semibold">{proof.name}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setProof(null)}>
                    {t("testimonyForm.proofRemove")}
                  </Button>
                </>
              ) : (
                <>
                  <Upload aria-hidden="true" strokeWidth={1.75} className="size-6 text-muted-foreground" />
                  <label
                    htmlFor={id("proof")}
                    className="inline-flex min-h-touch cursor-pointer items-center rounded-md border border-border-strong bg-card px-4 text-base font-semibold shadow-xs hover:border-foreground has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
                  >
                    {t("testimonyForm.proofAdd")}
                    <input
                      id={id("proof")}
                      type="file"
                      accept={PROOF_MIME_TYPES.join(",")}
                      onChange={pickProof}
                      className="sr-only"
                      {...fieldProps("proof", id("proof-hint"))}
                    />
                  </label>
                </>
              )}
              <p id={id("proof-hint")} className="text-sm text-muted-foreground">
                {t("testimonyForm.proofHint")}
              </p>
              <Link
                to={VERIFICATION_PATH}
                className="inline-flex min-h-touch items-center text-sm font-medium text-primary underline underline-offset-4"
              >
                {t("nav.verification")}
              </Link>
            </div>
            {fieldError("proof")}
          </div>
        </Card>

        <Card labelledBy={id("name-title")} className="p-5 desktop:p-6">
          <h2 id={id("name-title")} className="sr-only">
            {t("testimonyForm.nameTitle")}
          </h2>
          <div className="flex flex-col gap-2">
            <label htmlFor={id("display-name")} className={labelClass}>
              {t("testimonyForm.displayNameLabel")}
            </label>
            <input
              id={id("display-name")}
              type="text"
              autoComplete="off"
              maxLength={TESTIMONY_LIMITS.displayNameMaxChars}
              placeholder={t("testimonyForm.displayNamePlaceholder")}
              value={state.displayName}
              onChange={(event) => update({ displayName: event.currentTarget.value })}
              className={fieldClassName}
              {...fieldProps("displayName", id("display-name-hint"))}
            />
            <p id={id("display-name-hint")} className="text-sm text-muted-foreground">
              {t("testimonyForm.displayNameHint")}
            </p>
            {fieldError("displayName")}
          </div>

          <fieldset className="flex min-w-0 flex-col gap-1" {...fieldProps("consent")}>
            <legend className={cn(labelClass, "pb-1")}>{t("testimonyForm.consentTitle")}</legend>
            <label className="flex min-h-touch cursor-pointer items-start gap-3 py-2.5">
              <input
                type="checkbox"
                checked={state.consentHonest}
                onChange={(event) => update({ consentHonest: event.currentTarget.checked })}
                className="mt-0.5 size-5.5 shrink-0 accent-primary"
              />
              <span>{t("testimonyForm.consentHonest")}</span>
            </label>
            <label className="flex min-h-touch cursor-pointer items-start gap-3 py-2.5">
              <input
                type="checkbox"
                checked={state.consentNoOthers}
                onChange={(event) => update({ consentNoOthers: event.currentTarget.checked })}
                className="mt-0.5 size-5.5 shrink-0 accent-primary"
              />
              <span>{t("testimonyForm.consentNoOthers")}</span>
            </label>
            {fieldError("consent")}
          </fieldset>
        </Card>
      </fieldset>

      {problem && (
        <ErrorNotice ref={problemRef} tabIndex={-1} role="alert" className="px-4">
          <p>{problem.message}</p>
          {problem.alreadyPosted && (
            <Link to={MY_TESTIMONIES_PATH} className="font-medium underline underline-offset-4">
              {t("testimonyForm.myTestimonies")}
            </Link>
          )}
        </ErrorNotice>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          size="lg"
          disabled={busy || !hydrated}
          className="w-full desktop:w-auto desktop:self-start"
        >
          {phase === "signingIn"
            ? t("testimonyForm.signingIn")
            : phase === "sending"
              ? t("testimonyForm.submitting")
              : t("testimonyForm.submit")}
        </Button>
        {mode === "create" && <p className="text-sm text-muted-foreground">{t("testimonyForm.signInNote")}</p>}
      </div>
    </form>
  );
}

function RatingGroup(props: {
  aspect: Aspect;
  name: string;
  value: number | null;
  error?: string;
  errorId: string;
  onChange(value: number): void;
}) {
  const { aspect, name, value, error, errorId, onChange } = props;
  const { t } = useTranslation();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={error ? errorId : undefined}>
      <legend className="pb-2 text-sm leading-5 font-semibold">{t(`provider.aspects.${aspect}`)}</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((score) => (
          <label
            key={score}
            className="flex min-h-touch cursor-pointer items-center justify-center rounded-md border border-border-strong bg-card text-base font-semibold tabular-nums has-aria-invalid:border-destructive has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-50"
          >
            <input
              type="radio"
              name={name}
              value={score}
              checked={value === score}
              onChange={() => onChange(score)}
              className="sr-only"
              aria-invalid={error ? true : undefined}
            />
            <span aria-hidden="true">{score}</span>
            <span className="sr-only">{t("testimonyForm.ratingValue", { value: score })}</span>
          </label>
        ))}
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </fieldset>
  );
}

/**
 * Fix before submit (spec 03, user story 22): each flagged sentence with the flagged
 * part marked and the reason, then how many rounds are left before the team decides.
 */
function AuthorFixPanel({
  fix: response,
  panelRef,
}: {
  fix: TestimonyAuthorFixResponse;
  panelRef: React.Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const issues = issuesBySentence(response.text, response.flaggedSpans);
  const unspanned = rulesWithoutSpan(response.ruleCodes, response.flaggedSpans);
  const reason = (code: string) =>
    isAuthorFixable(code) ? t(`testimonyForm.fix.reasons.${code}`) : t("testimonyForm.fix.reasons.other");

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="alert"
      className="flex flex-col gap-3 rounded-md border border-warning-line bg-warning-soft px-4 py-3 text-sm text-foreground"
    >
      <p className="flex items-start gap-2 font-semibold">
        <TriangleAlert aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>{t("testimonyForm.fix.title")}</span>
      </p>
      <p>{t("testimonyForm.fix.intro")}</p>
      {response.message && <p>{response.message}</p>}
      {issues.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label={t("testimonyForm.fix.flagged")}>
          {issues.map((issue) => (
            <li key={`${issue.sentence}-${issue.marks[0]?.start}`} className="flex flex-col gap-1">
              <blockquote className="border-l-2 border-warning-line pl-3 break-words">
                <MarkedSentence issue={issue} />
              </blockquote>
              {issue.ruleCodes.map((code) => (
                <p key={code} className="text-muted-foreground">
                  {reason(code)}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
      {unspanned.map((code) => (
        <p key={code}>{reason(code)}</p>
      ))}
      <p className="text-muted-foreground">
        {response.roundsLeft > 0
          ? t("testimonyForm.fix.roundsLeft", { count: response.roundsLeft })
          : t("testimonyForm.fix.lastRound")}
      </p>
    </div>
  );
}

function MarkedSentence({ issue }: { issue: FixIssue }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const mark of issue.marks) {
    if (mark.start < at) continue;
    if (mark.start > at) parts.push(issue.sentence.slice(at, mark.start));
    parts.push(
      <mark key={mark.start} className="rounded-sm bg-highlight px-0.5 text-foreground">
        {issue.sentence.slice(mark.start, mark.end)}
      </mark>,
    );
    at = mark.end;
  }
  if (at < issue.sentence.length) parts.push(issue.sentence.slice(at));
  return <>{parts}</>;
}

/** What the Patient sees once the Testimony is stored (spec 03, user stories 21 and 23). */
function Result({
  response,
  proofSent,
  mode,
  placeId,
}: {
  response: TestimonyStoredResponse;
  proofSent: boolean;
  mode: "create" | "edit";
  placeId: string;
}) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const published = response.status === "published";
  const title = published ? t("testimonyForm.result.publishedTitle") : t("testimonyForm.result.reviewTitle");

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm desktop:p-6" aria-live="polite">
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold">
        {title}
      </h2>
      {/* On held, the server's message carries the reason and the 24-hour target. */}
      <p>{published ? t("testimonyForm.result.publishedBody") : response.message}</p>
      {!published && mode === "edit" && <p>{t("testimonyForm.result.editReviewNote")}</p>}
      {response.ownHealthDataWarning && (
        <p className="text-sm text-muted-foreground">{t("testimonyForm.result.ownHealthDataNote")}</p>
      )}
      {proofSent && (
        <p className="text-sm text-muted-foreground">
          {response.verifiedVisit
            ? t("testimonyForm.result.verifiedVisit")
            : t("testimonyForm.result.proofNotVerified")}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {published && placeId && (
          <Button asChild>
            <Link to={providerPath(placeId)}>{t("testimonyForm.result.viewProvider")}</Link>
          </Button>
        )}
        <Button asChild variant={published ? "outline" : "primary"}>
          <Link to={MY_TESTIMONIES_PATH}>{t("testimonyForm.myTestimonies")}</Link>
        </Button>
      </div>
    </section>
  );
}

/** Beside the form on desktop, under it on a phone: what helps other Patients, and what stays private. */
export function TestimonyTips() {
  const { t } = useTranslation();
  const headingId = useId();
  const tips = ["what", "price", "names"] as const;
  const privacy = ["account", "proof", "edit"] as const;
  return (
    <aside aria-labelledby={headingId} className="desktop:sticky desktop:top-6">
      <div className="flex flex-col gap-4 rounded-lg bg-secondary p-5 text-secondary-foreground desktop:p-6">
        <h2 id={headingId} className={sectionTitle}>
          {t("testimonyForm.tips.title")}
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {tips.map((key) => (
            <li key={key}>{t(`testimonyForm.tips.${key}`)}</li>
          ))}
        </ul>
        <hr className="border-border" />
        <h3 className="text-base leading-[22px] font-[650]">{t("testimonyForm.tips.privacyTitle")}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {privacy.map((key) => (
            <li key={key}>{t(`testimonyForm.tips.${key}`)}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
