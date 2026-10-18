import procedureList from "@findyourdent/contracts/data/procedures.json";
import type { PriceListRow, ProcedureCode } from "@findyourdent/contracts/firestore";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { FieldError, fieldClassName } from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import { getI18n, type Language } from "~/i18n/config";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { sendOwnerRequest } from "~/lib/owner-request";
import { providerPath } from "~/lib/paths";
import {
  LOW_CONFIDENCE,
  PRICE_LIST_FIELDS,
  PRICE_LIST_IMAGE_TYPES,
  PRICE_LIST_LIMITS,
  PRICE_LIST_PDF_TYPE,
  PRICE_UNITS,
  type PriceListConfirmResponse,
  type PriceListUploadResponse,
} from "~/lib/price-lists";
import { SITE_NAME } from "~/lib/seo";
import { loadPriceListPage, type PriceListPageData } from "~/server/price-lists.server";
import { isPlaceId } from "~/server/provider.server";
import type { Route } from "./+types/tempat.$placeId.daftar-harga";

/**
 * The approved claimant's Price List (spec 05): upload one PDF or up to five photos,
 * check the rows Gemini read beside the document (low-confidence rows marked), edit,
 * add or delete rows, then confirm. Only confirmed rows are ever stored or shown.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isPlaceId(params.placeId)) throw data(null, { status: 404 });
  return loadPriceListPage(context, request, params.placeId);
}

export function meta({ matches }: Route.MetaArgs) {
  const language: Language = matches[0]?.loaderData?.language ?? "id";
  const t = getI18n(language).getFixedT(language);
  return [{ title: `${t("priceList.metaTitle")} | ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export default function PriceListPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const page = loaderData;
  const claimPath = `${providerPath(page.placeId)}/klaim`;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link to={page.owner ? claimPath : providerPath(page.placeId)} className="text-sm underline">
          {t("claim.back")}
        </Link>
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{t("priceList.title")}</h1>
        {page.providerName && <p className="text-muted-foreground">{page.providerName}</p>}
      </header>
      <PriceListBody page={page} />
    </div>
  );
}

function PriceListBody({ page }: { page: PriceListPageData }) {
  const { t } = useTranslation();
  if (!page.signedIn) {
    const signIn = `/signin?redirectTo=${encodeURIComponent(`${providerPath(page.placeId)}/daftar-harga`)}`;
    return (
      <section className="flex flex-col items-start gap-3">
        <p>{t("priceList.signIn")}</p>
        <Button asChild>
          <a href={signIn}>{t("claim.signIn")}</a>
        </Button>
      </section>
    );
  }
  if (!page.owner) {
    return (
      <section className="flex flex-col items-start gap-3">
        <p className="rounded-md border bg-muted p-4">{t("priceList.notOwner")}</p>
        <Button asChild variant="outline">
          <Link to={`${providerPath(page.placeId)}/klaim`}>{t("priceList.toClaim")}</Link>
        </Button>
      </section>
    );
  }
  return <Uploader page={page} />;
}

/** A row being reviewed: prices as typed text, so a half-typed number is not lost. */
interface DraftRow {
  key: number;
  procedureCode: ProcedureCode | "";
  procedureText: string;
  minRupiah: string;
  maxRupiah: string;
  unit: PriceListRow["unit"];
  notes: string;
  /** Present on rows Gemini read; absent on rows the owner added. */
  confidence?: number;
}

type Step =
  | { phase: "pick"; error: string | null }
  | { phase: "reading" }
  | { phase: "review"; priceListId: string; error: string | null; saving: boolean }
  | { phase: "done"; message: string };

let rowKeys = 0;
const nextKey = () => {
  rowKeys += 1;
  return rowKeys;
};

const digits = (text: string) => text.replace(/\D/g, "");

/** The stored row, or null while the owner still has something to fix. */
function toRow(row: DraftRow): PriceListRow | null {
  const procedureText = row.procedureText.trim();
  const min = digits(row.minRupiah);
  const max = digits(row.maxRupiah) || min;
  if (!procedureText || !min) return null;
  const minRupiah = Number(min);
  const maxRupiah = Number(max);
  if (minRupiah > maxRupiah || maxRupiah > PRICE_LIST_LIMITS.rupiahMax) return null;
  const notes = row.notes.trim();
  return {
    ...(row.procedureCode ? { procedureCode: row.procedureCode } : {}),
    procedureText,
    minRupiah,
    maxRupiah,
    unit: row.unit,
    ...(notes ? { notes } : {}),
  };
}

function Uploader({ page }: { page: PriceListPageData }) {
  const { t } = useTranslation();
  const firebase = useFirebaseConfig();
  const inputId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Array<{ url: string; pdf: boolean; name: string }>>([]);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [step, setStep] = useState<Step>({ phase: "pick", error: null });

  // Object URLs show the owner's own files beside the rows; nothing is fetched back.
  useEffect(() => {
    const next = files.map((file) => ({
      url: URL.createObjectURL(file),
      pdf: file.type === PRICE_LIST_PDF_TYPE,
      name: file.name,
    }));
    setPreviews(next);
    return () => {
      for (const preview of next) URL.revokeObjectURL(preview.url);
    };
  }, [files]);

  async function read(event: FormEvent) {
    event.preventDefault();
    if (files.length === 0) return;
    setStep({ phase: "reading" });
    const form = new FormData();
    for (const file of files) form.append(PRICE_LIST_FIELDS.files, file);
    const result = await sendOwnerRequest(firebase, `/api/providers/${page.placeId}/price-lists`, form);
    if (!result.ok) {
      setStep({ phase: "pick", error: result.message ?? t("priceList.error") });
      return;
    }
    const body = result.body as PriceListUploadResponse;
    if (body.kind === "failed") {
      setStep({ phase: "pick", error: body.message });
      return;
    }
    setRows(
      body.rows.map((row) => ({
        key: nextKey(),
        procedureCode: (row.procedureCode as ProcedureCode | undefined) ?? "",
        procedureText: row.procedureText,
        minRupiah: String(row.minRupiah),
        maxRupiah: String(row.maxRupiah),
        unit: row.unit,
        notes: row.notes ?? "",
        confidence: row.confidence,
      })),
    );
    setStep({ phase: "review", priceListId: body.priceListId, error: null, saving: false });
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (step.phase !== "review") return;
    const checked = rows.map(toRow);
    if (rows.length === 0 || checked.some((row) => row === null)) {
      setStep({ ...step, error: rows.length === 0 ? t("priceList.noRows") : t("priceList.rowInvalid") });
      return;
    }
    setStep({ ...step, error: null, saving: true });
    const result = await sendOwnerRequest(firebase, `/api/providers/${page.placeId}/price-lists/${step.priceListId}`, {
      rows: checked,
    });
    if (!result.ok) {
      setStep({ ...step, error: result.message ?? t("priceList.error"), saving: false });
      return;
    }
    setStep({ phase: "done", message: (result.body as PriceListConfirmResponse).message });
  }

  function startOver() {
    setFiles([]);
    setRows([]);
    setStep({ phase: "pick", error: null });
  }

  if (step.phase === "done") {
    return (
      <section className="flex flex-col items-start gap-3">
        <p role="status" className="rounded-md border bg-muted p-4">
          {step.message}
        </p>
        <Button asChild>
          <Link to={providerPath(page.placeId)}>{t("priceList.viewPage")}</Link>
        </Button>
      </section>
    );
  }

  if (step.phase === "review") {
    return (
      <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Originals previews={previews} />
          <section aria-labelledby="rows-title" className="flex min-w-0 flex-col gap-3">
            <h2 id="rows-title" className="text-lg font-semibold">
              {t("priceList.reviewTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("priceList.reviewHint")}</p>
            <ol className="flex flex-col gap-3">
              {rows.map((row) => (
                <li key={row.key}>
                  <RowEditor
                    row={row}
                    onChange={(next) => setRows((all) => all.map((r) => (r.key === row.key ? next : r)))}
                    onDelete={() => setRows((all) => all.filter((r) => r.key !== row.key))}
                  />
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() =>
                setRows((all) => [
                  ...all,
                  {
                    key: nextKey(),
                    procedureCode: "",
                    procedureText: "",
                    minRupiah: "",
                    maxRupiah: "",
                    unit: "per_visit",
                    notes: "",
                  },
                ])
              }
            >
              {t("priceList.addRow")}
            </Button>
          </section>
        </div>
        {step.error && <FieldError role="alert">{step.error}</FieldError>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={step.saving}>
            {step.saving ? t("priceList.confirming") : t("priceList.confirm")}
          </Button>
          <Button type="button" variant="ghost" onClick={startOver} disabled={step.saving}>
            {t("priceList.startOver")}
          </Button>
        </div>
      </form>
    );
  }

  const accept = [PRICE_LIST_PDF_TYPE, ...PRICE_LIST_IMAGE_TYPES].join(",");
  return (
    <form onSubmit={read} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-sm">
        <p>{t("priceList.intro")}</p>
        <p className="text-muted-foreground">{t("priceList.privacy")}</p>
        {page.currentConfirmedAt && <p>{t("priceList.current", { date: page.currentConfirmedAt })}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t("priceList.pickFiles")}
        </label>
        <input
          id={inputId}
          type="file"
          accept={accept}
          multiple
          disabled={step.phase === "reading"}
          onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))}
          className="text-sm"
        />
      </div>
      {step.phase === "pick" && step.error && <FieldError role="alert">{step.error}</FieldError>}
      <Button type="submit" className="self-start" disabled={files.length === 0 || step.phase === "reading"}>
        {step.phase === "reading" ? t("priceList.reading") : t("priceList.read")}
      </Button>
    </form>
  );
}

function Originals({ previews }: { previews: Array<{ url: string; pdf: boolean; name: string }> }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="original-title" className="flex min-w-0 flex-col gap-2 md:sticky md:top-4 md:self-start">
      <h2 id="original-title" className="text-lg font-semibold">
        {t("priceList.original")}
      </h2>
      {previews.map((preview) =>
        preview.pdf ? (
          <object
            key={preview.url}
            data={preview.url}
            type={PRICE_LIST_PDF_TYPE}
            className="h-[70vh] w-full rounded-md border"
            aria-label={preview.name}
          >
            <a href={preview.url} target="_blank" rel="noreferrer" className="underline">
              {preview.name}
            </a>
          </object>
        ) : (
          <a key={preview.url} href={preview.url} target="_blank" rel="noreferrer">
            <img src={preview.url} alt={preview.name} className="w-full rounded-md border" />
          </a>
        ),
      )}
    </section>
  );
}

function RowEditor({
  row,
  onChange,
  onDelete,
}: {
  row: DraftRow;
  onChange: (row: DraftRow) => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language as Language;
  const id = useId();
  const low = row.confidence !== undefined && row.confidence < LOW_CONFIDENCE;
  const set = (patch: Partial<DraftRow>) => onChange({ ...row, ...patch });
  return (
    <fieldset
      className={`flex flex-col gap-2 rounded-md border p-3 ${low ? "border-warning-line bg-warning-soft" : ""}`}
      data-low-confidence={low || undefined}
    >
      <legend className="sr-only">{row.procedureText || t("priceList.procedureText")}</legend>
      {low && (
        <Badge variant="warning" className="self-start">
          {t("priceList.lowConfidence")}
        </Badge>
      )}
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-text`}>
        {t("priceList.procedureText")}
        <input
          id={`${id}-text`}
          className={fieldClassName}
          value={row.procedureText}
          maxLength={PRICE_LIST_LIMITS.procedureTextMax}
          onChange={(e) => set({ procedureText: e.currentTarget.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-code`}>
        {t("priceList.procedureCode")}
        <select
          id={`${id}-code`}
          className={fieldClassName}
          value={row.procedureCode}
          onChange={(e) => set({ procedureCode: e.currentTarget.value as ProcedureCode | "" })}
        >
          <option value="">{t("priceList.noCode")}</option>
          {procedureList.procedures.map((procedure) => (
            <option key={procedure.code} value={procedure.code}>
              {procedure.label[language]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-min`}>
          {t("priceList.minRupiah")}
          <input
            id={`${id}-min`}
            className={fieldClassName}
            inputMode="numeric"
            value={row.minRupiah}
            onChange={(e) => set({ minRupiah: digits(e.currentTarget.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-max`}>
          {t("priceList.maxRupiah")}
          <input
            id={`${id}-max`}
            className={fieldClassName}
            inputMode="numeric"
            value={row.maxRupiah}
            onChange={(e) => set({ maxRupiah: digits(e.currentTarget.value) })}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-unit`}>
        {t("priceList.unit")}
        <select
          id={`${id}-unit`}
          className={fieldClassName}
          value={row.unit}
          onChange={(e) => set({ unit: e.currentTarget.value as PriceListRow["unit"] })}
        >
          {PRICE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`priceList.units.${unit}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-notes`}>
        {t("priceList.notes")}
        <Textarea
          id={`${id}-notes`}
          rows={2}
          value={row.notes}
          maxLength={PRICE_LIST_LIMITS.notesMax}
          onChange={(e) => set({ notes: e.currentTarget.value })}
        />
      </label>
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onDelete}>
        {t("priceList.deleteRow")}
      </Button>
    </fieldset>
  );
}
