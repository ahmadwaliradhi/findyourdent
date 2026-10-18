import procedureList from "@findyourdent/contracts/data/procedures.json";
import type { PriceListRow, ProcedureCode } from "@findyourdent/contracts/firestore";
import { Check, Circle, CircleDot, FileText, LogIn, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { data, Link } from "react-router";
import { OwnerPageHeader } from "~/components/owner-page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { FieldError, fieldClassName, fileInputClassName } from "~/components/ui/field";
import { Notice } from "~/components/ui/notice";
import { Textarea } from "~/components/ui/textarea";
import { getI18n, type Language } from "~/i18n/config";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { formatRupiahAmount } from "~/lib/format";
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
    <div className="flex flex-col gap-8">
      <OwnerPageHeader
        backTo={page.owner ? claimPath : providerPath(page.placeId)}
        backLabel={page.owner ? t("claim.manageTitle") : t("claim.back")}
        placeName={page.providerName}
        title={t("priceList.title")}
        lead={t("priceList.intro")}
      />
      <PriceListBody page={page} />
    </div>
  );
}

function PriceListBody({ page }: { page: PriceListPageData }) {
  const { t } = useTranslation();
  if (!page.signedIn) {
    const signIn = `/signin?redirectTo=${encodeURIComponent(`${providerPath(page.placeId)}/daftar-harga`)}`;
    return (
      <section className="flex max-w-xl flex-col items-start gap-4">
        <p>{t("priceList.signIn")}</p>
        <Button asChild>
          <a href={signIn}>
            <LogIn aria-hidden="true" strokeWidth={1.75} />
            {t("claim.signIn")}
          </a>
        </Button>
      </section>
    );
  }
  if (!page.owner) {
    return (
      <section className="flex max-w-xl flex-col items-start gap-4">
        <Notice tone="info" className="text-base leading-6">
          <p>{t("priceList.notOwner")}</p>
        </Notice>
        <Button asChild variant="outline">
          <Link to={`${providerPath(page.placeId)}/klaim`}>{t("priceList.toClaim")}</Link>
        </Button>
      </section>
    );
  }
  return <Uploader page={page} />;
}

/** A row being reviewed: prices as typed digits, so a half-typed number is not lost. */
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

type RowProblem = "rowMissing" | "rowRange" | "rowTooHigh";

/** What the owner still has to fix in a row, or null when it can be stored. */
function rowProblem(row: DraftRow): RowProblem | null {
  const min = digits(row.minRupiah);
  if (!row.procedureText.trim() || !min) return "rowMissing";
  const minRupiah = Number(min);
  const maxRupiah = Number(digits(row.maxRupiah) || min);
  if (minRupiah > maxRupiah) return "rowRange";
  if (maxRupiah > PRICE_LIST_LIMITS.rupiahMax) return "rowTooHigh";
  return null;
}

/** The stored row; call only on a row with no problem. */
function toRow(row: DraftRow): PriceListRow {
  const min = digits(row.minRupiah);
  const notes = row.notes.trim();
  return {
    ...(row.procedureCode ? { procedureCode: row.procedureCode } : {}),
    procedureText: row.procedureText.trim(),
    minRupiah: Number(min),
    maxRupiah: Number(digits(row.maxRupiah) || min),
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
  /** The row the last confirm stopped at, marked invalid until the owner confirms again. */
  const [invalidKey, setInvalidKey] = useState<number | null>(null);

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
    setInvalidKey(null);
    setStep({ phase: "review", priceListId: body.priceListId, error: null, saving: false });
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (step.phase !== "review") return;
    if (rows.length === 0) {
      setStep({ ...step, error: t("priceList.noRows") });
      return;
    }
    const index = rows.findIndex((row) => rowProblem(row) !== null);
    const broken = rows[index];
    if (broken) {
      setInvalidKey(broken.key);
      setStep({ ...step, error: t(`priceList.${rowProblem(broken) as RowProblem}`, { row: index + 1 }) });
      return;
    }
    setInvalidKey(null);
    setStep({ ...step, error: null, saving: true });
    const result = await sendOwnerRequest(firebase, `/api/providers/${page.placeId}/price-lists/${step.priceListId}`, {
      rows: rows.map(toRow),
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
    setInvalidKey(null);
    setStep({ phase: "pick", error: null });
  }

  const progress = <Progress current={step.phase === "done" ? 3 : step.phase === "review" ? 2 : 1} />;

  if (step.phase === "done") {
    return (
      <section className="flex max-w-xl flex-col items-start gap-4">
        {progress}
        <Notice tone="success" role="status" className="text-base leading-6">
          <p>{step.message}</p>
        </Notice>
        <Button asChild>
          <Link to={providerPath(page.placeId)}>{t("priceList.viewPage")}</Link>
        </Button>
      </section>
    );
  }

  if (step.phase === "review") {
    return (
      <form onSubmit={confirm} className="flex flex-col gap-6" noValidate>
        {progress}
        <div className="grid grid-cols-1 gap-6 desktop:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] desktop:items-start desktop:gap-10">
          <Originals previews={previews} />
          <section aria-labelledby="rows-title" className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 id="rows-title" className="text-[22px] leading-7 font-bold tracking-[-.01em]">
                {t("priceList.reviewTitle")}
              </h2>
              <Notice tone="warning" icon={TriangleAlert}>
                <p>{t("priceList.reviewHint")}</p>
              </Notice>
            </div>
            <ol className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <li key={row.key}>
                  <RowEditor
                    row={row}
                    number={index + 1}
                    invalid={row.key === invalidKey}
                    onChange={(next) => setRows((all) => all.map((r) => (r.key === row.key ? next : r)))}
                    onDelete={() => setRows((all) => all.filter((r) => r.key !== row.key))}
                  />
                </li>
              ))}
            </ol>
            {step.error && <FieldError role="alert">{step.error}</FieldError>}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              icon={<Plus aria-hidden="true" strokeWidth={1.75} />}
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
            <hr className="border-border" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" loading={step.saving}>
                {step.saving ? t("priceList.confirming") : t("priceList.confirm")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={startOver}
                disabled={step.saving}
                icon={<RotateCcw aria-hidden="true" strokeWidth={1.75} />}
              >
                {t("priceList.startOver")}
              </Button>
            </div>
          </section>
        </div>
      </form>
    );
  }

  const accept = [PRICE_LIST_PDF_TYPE, ...PRICE_LIST_IMAGE_TYPES].join(",");
  const reading = step.phase === "reading";
  return (
    <div className="flex flex-col gap-6">
      {progress}
      <Card className="max-w-2xl gap-5 p-6">
        <form onSubmit={read} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm leading-5 font-semibold">
              {t("priceList.pickFiles")}
            </label>
            <input
              id={inputId}
              type="file"
              accept={accept}
              multiple
              disabled={reading}
              onChange={(event) => setFiles(Array.from(event.currentTarget.files ?? []))}
              aria-describedby={`${inputId}-hint`}
              className={`${fileInputClassName} rounded-md bg-muted p-3`}
            />
            <p id={`${inputId}-hint`} className="text-sm text-muted-foreground">
              {t("priceList.privacy")}
            </p>
          </div>
          {page.currentConfirmedAt && (
            <Notice tone="neutral">
              <p>{t("priceList.current", { date: page.currentConfirmedAt })}</p>
            </Notice>
          )}
          {step.phase === "pick" && step.error && <FieldError role="alert">{step.error}</FieldError>}
          <Button type="submit" size="lg" className="self-start" loading={reading} disabled={files.length === 0}>
            {reading ? t("priceList.reading") : t("priceList.read")}
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** Upload, check, publish: each step shows an icon and its name, never color alone. */
function Progress({ current }: { current: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  const steps = [t("priceList.steps.upload"), t("priceList.steps.review"), t("priceList.steps.publish")];
  return (
    <ol aria-label={t("priceList.steps.label")} className="flex flex-wrap gap-2">
      {steps.map((name, index) => {
        const number = index + 1;
        // The last step is done once it is reached: the rows are live.
        const done = number < current || (number === 3 && current === 3);
        const here = number === current && !done;
        return (
          <li key={name} aria-current={here ? "step" : undefined}>
            <Badge
              variant={done ? "success" : here ? "brand" : "neutral"}
              icon={done ? Check : here ? CircleDot : Circle}
              className={`px-3 py-1.5 text-sm leading-5 ${here ? "border-primary" : ""}`}
            >
              {number}. {name}
              {done && <span className="sr-only"> ({t("priceList.steps.done")})</span>}
            </Badge>
          </li>
        );
      })}
    </ol>
  );
}

function Originals({ previews }: { previews: Array<{ url: string; pdf: boolean; name: string }> }) {
  const { t } = useTranslation();
  return (
    <aside aria-labelledby="original-title" className="flex min-w-0 flex-col gap-3 desktop:sticky desktop:top-4">
      <h2 id="original-title" className="text-base leading-[22px] font-[650]">
        {t("priceList.original")}
      </h2>
      {previews.map((preview) =>
        preview.pdf ? (
          <object
            key={preview.url}
            data={preview.url}
            type={PRICE_LIST_PDF_TYPE}
            className="h-[70vh] w-full rounded-md border bg-card"
            aria-label={preview.name}
          >
            <a href={preview.url} target="_blank" rel="noreferrer" className="underline">
              {preview.name}
            </a>
          </object>
        ) : (
          <a key={preview.url} href={preview.url} target="_blank" rel="noreferrer">
            <img src={preview.url} alt={preview.name} className="w-full rounded-md border bg-card" />
          </a>
        ),
      )}
      <ul className="flex flex-col gap-1">
        {previews.map((preview) => (
          <li key={preview.url} className="flex items-center gap-2 rounded-md bg-muted px-4 py-3 text-sm break-all">
            <FileText aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
            {preview.name}
          </li>
        ))}
      </ul>
      <p className="text-xs leading-4 font-medium text-muted-foreground">{t("priceList.privacy")}</p>
    </aside>
  );
}

const labelClass = "flex flex-col gap-1.5 text-sm leading-5 font-semibold";

function RowEditor({
  row,
  number,
  invalid,
  onChange,
  onDelete,
}: {
  row: DraftRow;
  number: number;
  invalid: boolean;
  onChange: (row: DraftRow) => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language as Language;
  const id = useId();
  const low = row.confidence !== undefined && row.confidence < LOW_CONFIDENCE;
  const set = (patch: Partial<DraftRow>) => onChange({ ...row, ...patch });
  const price = (value: string) => (value ? formatRupiahAmount(Number(value), language) : "");
  const invalidField = invalid ? true : undefined;
  return (
    <fieldset
      className={`flex flex-col gap-3 rounded-lg border bg-card p-4 ${low ? "border-warning-line bg-warning-soft" : ""} ${invalid ? "border-2 border-destructive" : ""}`}
      data-low-confidence={low || undefined}
      aria-invalid={invalidField}
    >
      <legend className="sr-only">
        {number}. {row.procedureText || t("priceList.procedureText")}
      </legend>
      {low && (
        <Badge variant="warning" icon={TriangleAlert}>
          {t("priceList.lowConfidence")}
        </Badge>
      )}
      <div className="grid gap-3 desktop:grid-cols-2">
        <label className={labelClass} htmlFor={`${id}-text`}>
          {t("priceList.procedureText")}
          <input
            id={`${id}-text`}
            className={`${fieldClassName} font-normal`}
            value={row.procedureText}
            maxLength={PRICE_LIST_LIMITS.procedureTextMax}
            onChange={(e) => set({ procedureText: e.currentTarget.value })}
            aria-invalid={invalidField}
          />
        </label>
        <label className={labelClass} htmlFor={`${id}-code`}>
          {t("priceList.procedureCode")}
          <select
            id={`${id}-code`}
            className={`${fieldClassName} font-normal`}
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
      </div>
      <div className="grid grid-cols-2 gap-3 desktop:grid-cols-3">
        <label className={labelClass} htmlFor={`${id}-min`}>
          {t("priceList.minRupiah")}
          <input
            id={`${id}-min`}
            className={`${fieldClassName} font-normal tabular-nums`}
            inputMode="numeric"
            value={price(row.minRupiah)}
            onChange={(e) => set({ minRupiah: digits(e.currentTarget.value) })}
            aria-invalid={invalidField}
          />
        </label>
        <label className={labelClass} htmlFor={`${id}-max`}>
          {t("priceList.maxRupiah")}
          <input
            id={`${id}-max`}
            className={`${fieldClassName} font-normal tabular-nums`}
            inputMode="numeric"
            value={price(row.maxRupiah)}
            onChange={(e) => set({ maxRupiah: digits(e.currentTarget.value) })}
            aria-invalid={invalidField}
          />
        </label>
        <label className={`${labelClass} col-span-2 desktop:col-span-1`} htmlFor={`${id}-unit`}>
          {t("priceList.unit")}
          <select
            id={`${id}-unit`}
            className={`${fieldClassName} font-normal`}
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
      </div>
      <label className={labelClass} htmlFor={`${id}-notes`}>
        {t("priceList.notes")}
        <Textarea
          id={`${id}-notes`}
          rows={1}
          value={row.notes}
          maxLength={PRICE_LIST_LIMITS.notesMax}
          onChange={(e) => set({ notes: e.currentTarget.value })}
          className="min-h-touch font-normal"
        />
      </label>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={onDelete}
        icon={<Trash2 aria-hidden="true" strokeWidth={1.75} />}
      >
        {t("priceList.deleteRow")}
      </Button>
    </fieldset>
  );
}
